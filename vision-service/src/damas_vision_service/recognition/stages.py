"""Recognition stages B–E (`stages/*.ts`): occupancy, color, piece type, consolidation.

Confidence (docs/vision/recognition.md, stage E): each stage gives 0.5 on its threshold,
rising linearly to 1 at its soft margin (`margin_confidence`); undetermined evidence gives
0.3. These are heuristic values, not probabilities. A square's confidence is its weakest
needed stage; below `uncertain` it is UNKNOWN (RETRY), below `acceptable` a warning (WARN).
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Literal

from ..jsmath import median
from .config import ClassifierConfig
from .features import Rgb, SquareFeatures, chroma_distance
from .top_face import MarkSearch

UNDETERMINED_CONFIDENCE = 0.3
MIN_PIECES_FOR_CONSISTENCY = 3

StageName = Literal["OCCUPANCY", "COLOR", "PIECE_TYPE"]


@dataclass(frozen=True)
class StageOutcome:
    decision: str
    confidence: float
    reason: str

    def to_json(self, round_fn) -> dict[str, object]:  # type: ignore[no-untyped-def]
        return {"decision": self.decision, "confidence": round_fn(self.confidence), "reason": self.reason}


def margin_confidence(distance_past_threshold: float, softness: float) -> float:
    return min(1.0, max(0.0, 0.5 + (0.5 * distance_past_threshold) / softness))


def _undetermined(reason: str) -> StageOutcome:
    return StageOutcome("UNDETERMINED", UNDETERMINED_CONFIDENCE, reason)


def occupancy_stage(
    features: SquareFeatures, visible_corners: int, background_relative: float, config: ClassifierConfig
) -> StageOutcome:
    """Empty, occupied or undetermined, decided before and independently of color and type."""
    shape, color = config.shape, config.color
    if visible_corners == 0:
        return _undetermined("ROI_OBSTRUCTED")
    occupancy = features.foreground_ratio
    if occupancy <= shape.emptyMaxRatio:
        if background_relative < color.darkSquareMinRelativeLuminance:
            # A black piece on a near-black square would also show no foreground.
            return _undetermined("LOW_BOARD_CONTRAST")
        return StageOutcome(
            "EMPTY",
            margin_confidence(shape.emptyMaxRatio - occupancy, shape.emptyMaxRatio),
            "EMPTY_BACKGROUND",
        )
    if occupancy < shape.presenceMinRatio:
        return _undetermined("PARTIAL_OCCUPANCY")
    if features.ring_foreground_ratio < shape.occupancyRingMinRatio:
        # Foreground that does not reach the disk edge all around: glare, a fingertip, an object.
        return _undetermined("NOT_PIECE_SHAPED")
    return StageOutcome(
        "OCCUPIED",
        margin_confidence(occupancy - shape.presenceMinRatio, 1 - shape.presenceMinRatio),
        "OCCUPIED_FOREGROUND",
    )


def contrast_log_ratio(features: SquareFeatures) -> float:
    return math.log(max(features.body_luminance, 1e-3) / max(features.background_luminance, 1e-3))


def color_stage(features: SquareFeatures, config: ClassifierConfig) -> StageOutcome:
    """White or black from the piece body / square background luminance ratio."""
    color = config.color
    log_ratio = contrast_log_ratio(features)
    white = math.log(color.whiteMinContrastRatio)
    black = math.log(color.blackMaxContrastRatio)
    if log_ratio >= white:
        return StageOutcome(
            "WHITE", margin_confidence(log_ratio - white, color.contrastSoftness), "WHITE_CONTRAST"
        )
    if log_ratio <= black:
        return StageOutcome(
            "BLACK", margin_confidence(black - log_ratio, color.contrastSoftness), "BLACK_CONTRAST"
        )
    return _undetermined("AMBIGUOUS_COLOR")


def enforce_color_consistency(
    outcomes: list[StageOutcome | None],
    body_colors: list[Rgb],
    body_luminances: list[float],
    config: ClassifierConfig,
) -> list[StageOutcome | None]:
    """Light pieces share their chromaticity: a "white piece" with a clearly different body
    color is something else (hand, object) and becomes undetermined."""

    def reliable(i: int) -> bool:
        return body_luminances[i] >= config.color.chromaMinLuminance

    whites = [i for i, o in enumerate(outcomes) if o is not None and o.decision == "WHITE" and reliable(i)]
    if len(whites) < MIN_PIECES_FOR_CONSISTENCY:
        return list(outcomes)
    chroma = []
    for i in whites:
        c = body_colors[i]
        total = (c[0] + c[1] + c[2]) or 1
        chroma.append((c[0] / total, c[1] / total))
    m0 = median([c[0] for c in chroma])
    m1 = median([c[1] for c in chroma])
    reference: Rgb = (m0, m1, 1 - m0 - m1)
    result: list[StageOutcome | None] = []
    for i, outcome in enumerate(outcomes):
        if outcome is None or outcome.decision != "WHITE" or not reliable(i):
            result.append(outcome)
        elif chroma_distance(body_colors[i], reference) > config.color.pieceChromaTolerance:
            result.append(_undetermined("INCONSISTENT_PIECE_COLOR"))
        else:
            result.append(outcome)
    return result


def piece_type_stage(mark: MarkSearch, config: ClassifierConfig) -> StageOutcome:
    """Man or king, independent of color: kings carry a colored mark on the top face."""
    minimum = config.color.kingMarkMinCoverage
    confidence = margin_confidence(abs(mark.coverage - minimum), config.color.kingMarkCoverageSoftness)
    if confidence < config.confidence.uncertain:
        return StageOutcome("UNDETERMINED", confidence, "AMBIGUOUS_MARK")
    if mark.coverage >= minimum:
        return StageOutcome("KING", confidence, "COLORED_MARK")
    return StageOutcome("MAN", confidence, "NO_MARK")


@dataclass(frozen=True)
class Consolidated:
    piece: str
    confidence: float
    decision: Literal["ACCEPT", "WARN", "RETRY"]
    reason: str
    limiting_stage: StageName


def consolidate(
    occupancy: StageOutcome,
    color: StageOutcome | None,
    piece_type: StageOutcome | None,
    config: ClassifierConfig,
) -> Consolidated:
    stages: list[tuple[StageName, StageOutcome]] = [("OCCUPANCY", occupancy)]
    if occupancy.decision == "OCCUPIED":
        if color is not None:
            stages.append(("COLOR", color))
        if piece_type is not None:
            stages.append(("PIECE_TYPE", piece_type))
    limiting, weakest = stages[0]
    for entry in stages[1:]:
        if entry[1].confidence < weakest.confidence:
            limiting, weakest = entry
    undetermined = next((s for s in stages if s[1].decision == "UNDETERMINED"), None)
    confidence = weakest.confidence
    if undetermined is not None or confidence < config.confidence.uncertain:
        stage, outcome = undetermined if undetermined is not None else (limiting, weakest)
        return Consolidated("UNKNOWN", confidence, "RETRY", outcome.reason, stage)
    piece = _piece_of(
        occupancy.decision,
        color.decision if color else None,
        piece_type.decision if piece_type else None,
    )
    decision: Literal["ACCEPT", "WARN"] = "ACCEPT" if confidence >= config.confidence.acceptable else "WARN"
    return Consolidated(piece, confidence, decision, weakest.reason, limiting)


def _piece_of(occupancy: str, color: str | None, piece_type: str | None) -> str:
    if occupancy == "EMPTY":
        return "EMPTY"
    if color == "WHITE":
        return "WHITE_KING" if piece_type == "KING" else "WHITE"
    if color == "BLACK":
        return "BLACK_KING" if piece_type == "KING" else "BLACK"
    return "UNKNOWN"
