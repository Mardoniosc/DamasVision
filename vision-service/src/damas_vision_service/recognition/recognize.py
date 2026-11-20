"""Board recognition on a rectified board (`recognize-board.ts`), G3 staged pipeline:

A. frame assessment (sharpness, exposure, grid alignment); then per playable square the
background model, features, B. occupancy, C. color (+ board-level consistency), D. piece
type, E. consolidation, with a full trace. Light squares never hold pieces: they give the
local illumination reference. The output is the app's `BoardRecognitionResult` contract.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np

from ..geometry.board import SQUARE_COUNT, is_on_board, square_index
from ..geometry.regions import SquareGeometry, board_grid, square_regions, square_roi
from ..jsmath import js_round, median, round3
from .background import board_background, square_background
from .config import ClassifierConfig
from .features import (
    Rgb,
    SquareFeatures,
    chroma_distance,
    extract_square_features,
    luminance,
    measure_corners,
    median_color,
)
from .quality import FrameQuality, grid_alignment_quality
from .stages import (
    StageOutcome,
    color_stage,
    consolidate,
    contrast_log_ratio,
    enforce_color_consistency,
    occupancy_stage,
    piece_type_stage,
)
from .top_face import MarkColors, search_king_mark
from .trace import explain_square

MAX_PIECES_PER_SIDE = 12
LIGHT_SQUARE_MAX_FACTOR = 2

ISSUE_MESSAGES = {
    "LOW_SHARPNESS": "A imagem parece desfocada ou tremida.",
    "UNDEREXPOSED": "A imagem está escura demais; melhore a iluminação.",
    "OVEREXPOSED": "A imagem está clara demais (reflexo ou luz direta).",
    "CALIBRATION_MISALIGNED": (
        'As bordas das casas não coincidem com a grade: a calibração parece deslocada. Use "Reajustar cantos".'
    ),
}


@dataclass(frozen=True)
class Recognition:
    result: dict[str, Any]
    traces: list[dict[str, Any]]
    frame: dict[str, Any]
    features: list[SquareFeatures]


def assess_frame(image: np.ndarray, config: ClassifierConfig, quality: FrameQuality | None) -> dict[str, Any]:
    alignment = round3(grid_alignment_quality(image))
    issues: list[str] = []
    if quality is not None and quality.sharpness < config.shape.minSharpness:
        issues.append("LOW_SHARPNESS")
    if quality is not None and quality.mean_luminance < config.color.underexposedMaxLuminance:
        issues.append("UNDEREXPOSED")
    if quality is not None and quality.mean_luminance > config.color.overexposedMinLuminance:
        issues.append("OVEREXPOSED")
    if alignment < config.shape.minAlignmentQuality:
        issues.append("CALIBRATION_MISALIGNED")
    return {
        "sharpness": round3(quality.sharpness) if quality else None,
        "meanLuminance": round3(quality.mean_luminance) if quality else None,
        "alignmentQuality": alignment,
        "issues": issues,
    }


def _local_light_reference(
    square: SquareGeometry, light_luma: dict[int, float], excluded: set[int]
) -> float | None:
    neighbours = []
    for dr, dc in ((-1, 0), (1, 0), (0, -1), (0, 1)):
        row, column = square.row + dr, square.column + dc
        if not is_on_board(row, column):
            continue
        index = square_index(row, column)
        if index in light_luma and index not in excluded:
            neighbours.append(light_luma[index])
    return median(neighbours) if neighbours else None


def _outcome(outcome: StageOutcome | None) -> dict[str, Any] | None:
    return None if outcome is None else outcome.to_json(round3)


def recognize_board(
    image: np.ndarray,
    config: ClassifierConfig,
    *,
    timestamp: float,
    frame_id: str | None = None,
    quality: FrameQuality | None = None,
    away_from_camera: tuple[float, float] | None = None,
    mask: np.ndarray | None = None,
) -> Recognition:
    height, width = image.shape[:2]
    frame = assess_frame(image, config, quality)
    grid = board_grid(width, height)
    light_squares = [s for s in grid if not s.is_playable]
    playable = [s for s in grid if s.is_playable]
    color_cfg, shape = config.color, config.shape

    light_color = {s.index: median_color(image, square_roi(s, config.roi_inset_ratio)) for s in light_squares}
    light_luma = {i: luminance(*c) for i, c in light_color.items()}
    global_light = median(list(light_luma.values()))
    typical_light: Rgb = (
        median([c[0] for c in light_color.values()]),
        median([c[1] for c in light_color.values()]),
        median([c[2] for c in light_color.values()]),
    )
    suspicious: set[int] = set()
    for index, color in light_color.items():
        luma = light_luma[index]
        factor = (
            max(luma / global_light, global_light / luma) if global_light > 0 and luma > 0 else float("inf")
        )
        if factor > LIGHT_SQUARE_MAX_FACTOR or chroma_distance(color, typical_light) > color_cfg.lightSquareChromaTolerance:
            suspicious.add(index)

    regions = [
        square_regions(
            s,
            edge_margin_ratio=shape.edgeMarginRatio,
            piece_radius_ratio=shape.pieceRadiusRatio,
            king_mark_radius_ratio=shape.kingMarkRadiusRatio,
            background_min_radius_ratio=shape.backgroundMinRadiusRatio,
        )
        for s in playable
    ]
    references = []
    for s in playable:
        local = _local_light_reference(s, light_luma, suspicious)
        references.append(global_light if local is None else local)
    corners = [measure_corners(image, r) for r in regions]
    board = board_background(corners, references)

    measured = []
    for i, s in enumerate(playable):
        reference = references[i]
        background = square_background(corners[i], reference, board, color_cfg)
        features = extract_square_features(
            image,
            s.index,
            regions[i],
            background.color,
            color_cfg.pixelForegroundDistance * reference,
            color_cfg,
            mask,
        )
        relative = features.background_luminance / reference if reference > 0 else 0.0
        occupancy = occupancy_stage(features, background.visible_corners, relative, config)
        color = color_stage(features, config) if occupancy.decision == "OCCUPIED" else None
        measured.append((reference, background, features, relative, occupancy, color))

    consistent = enforce_color_consistency(
        [m[5] for m in measured],
        [m[2].body_color for m in measured],
        [m[2].body_luminance for m in measured],
        config,
    )

    cells = ["EMPTY"] * SQUARE_COUNT
    confidence_by_square: list[float] = [1] * SQUARE_COUNT
    squares: list[dict[str, Any]] = []
    traces: list[dict[str, Any]] = []
    all_features: list[SquareFeatures] = []
    away = away_from_camera
    for i, s in enumerate(playable):
        region = regions[i]
        reference, background, features, relative, occupancy, _ = measured[i]
        color = consistent[i]
        mark = (
            search_king_mark(
                image,
                region,
                away,
                MarkColors(features.body_color, background.color, typical_light, reference),
                config,
            )
            if occupancy.decision == "OCCUPIED"
            else None
        )
        piece_type = piece_type_stage(mark, config) if mark is not None else None
        search_length = shape.topFaceMaxShiftRatio * region.size if away else 0.0
        result = consolidate(occupancy, color, piece_type, config)
        confidence = round3(result.confidence)
        trace: dict[str, Any] = {
            "squareIndex": s.index,
            "piece": result.piece,
            "confidence": confidence,
            "decision": result.decision,
            "reason": result.reason,
            "limitingStage": result.limiting_stage,
            "regions": {
                "centerX": round3(region.center[0]),
                "centerY": round3(region.center[1]),
                "size": round3(region.size),
                "pieceRadius": round3(region.piece_radius),
                "markRadius": round3(region.mark_radius),
                "backgroundRadius": round3(region.background_radius),
                "markSearch": {
                    "endX": round3(region.center[0] + (away[0] if away else 0.0) * search_length),
                    "endY": round3(region.center[1] + (away[1] if away else 0.0) * search_length),
                    "radius": round3(shape.markSearchRadiusRatio * region.size),
                },
            },
            "roi": {
                "cornerMatches": list(background.corner_matches),
                "visibleCorners": background.visible_corners,
                "quality": background.visible_corners / 4,
            },
            "occupancy": _outcome(occupancy),
            "color": _outcome(color),
            "pieceType": _outcome(piece_type),
            "features": {
                "foregroundRatio": round3(features.foreground_ratio),
                "shadowRatio": round3(features.shadow_ratio),
                "ringForegroundRatio": round3(features.ring_foreground_ratio),
                "backgroundLuminance": round3(features.background_luminance),
                "backgroundRelative": round3(relative),
                "lightReference": round3(reference),
                "pieceLuminance": round3(features.piece_luminance),
                "pieceLuminanceStd": round3(features.piece_luminance_std),
                "bodyLuminance": round3(features.body_luminance),
                "markLuminance": round3(features.mark_luminance),
                "contrastRatio": round3(float(np.exp(contrast_log_ratio(features)))),
                "markCoverage": round3(mark.coverage) if mark else 0,
                "markOffset": (
                    {"x": round3(mark.offset[0]), "y": round3(mark.offset[1])}
                    if mark is not None and mark.offset is not None
                    else None
                ),
                "backgroundColor": [js_round(v) for v in features.background_color],
                "bodyColor": [js_round(v) for v in features.body_color],
            },
        }
        trace["explanation"] = explain_square(trace, config)
        cells[s.index] = result.piece
        confidence_by_square[s.index] = confidence
        squares.append({"squareIndex": s.index, "piece": result.piece, "confidence": confidence})
        traces.append(trace)
        all_features.append(features)

    obstructed = [t["squareIndex"] for t in traces if t["reason"] in ("ROI_OBSTRUCTED", "INCONSISTENT_PIECE_COLOR")]
    warnings = _warnings(squares, traces, frame, [*sorted(suspicious), *obstructed])
    overall = round3(sum(s["confidence"] for s in squares) / len(squares))
    status = "UNCERTAIN" if any(t["decision"] != "ACCEPT" for t in traces) else "SUCCESS"
    board_observation: dict[str, Any] = {
        "cells": cells,
        "confidenceBySquare": confidence_by_square,
        "timestamp": timestamp,
    }
    if frame_id:
        board_observation["sourceFrameId"] = frame_id
    return Recognition(
        result={
            "board": board_observation,
            "squares": squares,
            "status": status,
            "overallConfidence": overall,
            "warnings": warnings,
            "timestamp": timestamp,
        },
        traces=traces,
        frame=frame,
        features=all_features,
    )


def _warnings(
    squares: list[dict[str, Any]],
    traces: list[dict[str, Any]],
    frame: dict[str, Any],
    unexpected: list[int],
) -> list[dict[str, Any]]:
    warnings: list[dict[str, Any]] = []
    unknown = [s["squareIndex"] for s in squares if s["piece"] == "UNKNOWN"]
    if unknown:
        warnings.append(
            {
                "code": "UNKNOWN_SQUARES",
                "message": f"{len(unknown)} casa(s) não puderam ser identificadas com segurança.",
                "affectedSquares": unknown,
            }
        )
    low = [t["squareIndex"] for t in traces if t["decision"] == "WARN"]
    if low:
        warnings.append(
            {
                "code": "LOW_CONFIDENCE",
                "message": f"{len(low)} casa(s) foram identificadas com baixa confiança.",
                "affectedSquares": low,
            }
        )
    if unexpected:
        warnings.append(
            {
                "code": "UNEXPECTED_OBJECTS",
                "message": "Há algo sobre o tabuleiro (mão, objeto ou peça fora do lugar) ou a calibração se deslocou.",
                "affectedSquares": sorted(set(unexpected)),
            }
        )
    low_contrast = [t["squareIndex"] for t in traces if t["reason"] == "LOW_BOARD_CONTRAST"]
    if low_contrast:
        warnings.append(
            {
                "code": "LOW_BOARD_CONTRAST",
                "message": "As casas escuras estão escuras demais para distinguir peças pretas; confira essas casas.",
                "affectedSquares": low_contrast,
            }
        )
    for color, word in (("WHITE", "brancas"), ("BLACK", "pretas")):
        count = sum(1 for s in squares if s["piece"] in (color, f"{color}_KING"))
        if count > MAX_PIECES_PER_SIDE:
            warnings.append(
                {
                    "code": "TOO_MANY_PIECES",
                    "message": f"Foram vistas {count} peças {word}; o máximo é {MAX_PIECES_PER_SIDE}.",
                }
            )
    for issue in frame["issues"]:
        warnings.append({"code": issue, "message": ISSUE_MESSAGES[issue]})
    return warnings
