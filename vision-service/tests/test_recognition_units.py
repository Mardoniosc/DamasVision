"""Config validation, features, stages and JS-compatible numerics."""

from __future__ import annotations

import copy

import numpy as np
import pytest

from damas_vision_service.errors import ServiceError
from damas_vision_service.geometry.regions import board_grid, square_regions
from damas_vision_service.jsmath import js_round, median, round3, to_fixed
from damas_vision_service.recognition.features import (
    chroma_distance,
    chromaticity,
    extract_square_features,
    measure_corners,
)
from damas_vision_service.recognition.quality import denoise, grid_alignment_quality, measure_frame_quality
from damas_vision_service.recognition.stages import (
    UNDETERMINED_CONFIDENCE,
    StageOutcome,
    consolidate,
    margin_confidence,
)

from .conftest import classifier_from


def test_js_numerics() -> None:
    assert js_round(2.5) == 3 and js_round(-2.5) == -2  # Math.round, not banker's rounding
    assert round3(0.0005) == 0.001
    assert to_fixed(0.125, 2) == "0.13"  # toFixed rounds the exact binary value, ties up
    assert to_fixed(1.005, 2) == "1.00"  # 1.005 is 1.00499999... in binary
    assert median([3, 1, 2]) == 2 and median([4, 1, 2, 3]) == 2.5 and median([]) == 0


def test_config_requires_every_key(vision_config) -> None:  # type: ignore[no-untyped-def]
    broken = copy.deepcopy(vision_config)
    del broken["classifier"]["colorThresholds"]["shadowMinRatio"]
    with pytest.raises(ServiceError, match="missing colorThresholds"):
        classifier_from(broken)
    unknown = copy.deepcopy(vision_config)
    unknown["classifier"]["shapeThresholds"]["mystery"] = 1
    with pytest.raises(ServiceError, match="unknown shapeThresholds"):
        classifier_from(unknown)


@pytest.mark.parametrize(
    ("section", "key", "value", "message"),
    [
        ("colorThresholds", "pixelForegroundDistance", 1.5, "must be in"),
        ("colorThresholds", "glareMaxRatio", 0.9, "glareMaxRatio"),
        ("shapeThresholds", "denoiseKernelSize", 4, "odd integer"),
        ("shapeThresholds", "emptyMaxRatio", 0.5, "emptyMaxRatio must be lower"),
        ("colorThresholds", "whiteMinContrastRatio", 0.9, "blackMaxContrastRatio"),
    ],
)
def test_config_rules(vision_config, section, key, value, message) -> None:  # type: ignore[no-untyped-def]
    config = copy.deepcopy(vision_config)
    config["classifier"][section][key] = value
    with pytest.raises(ServiceError, match=message):
        classifier_from(config)


def test_chromaticity_is_brightness_invariant() -> None:
    assert chromaticity((0, 0, 0)) == (1 / 3, 1 / 3)
    assert chroma_distance((100, 50, 25), (200, 100, 50)) == pytest.approx(0)


def _plain_board(dark=(60, 90, 140), light=(220, 210, 190)) -> np.ndarray:  # type: ignore[no-untyped-def]
    image = np.zeros((800, 800, 3), dtype=np.uint8)
    for square in board_grid(800, 800):
        b = square.bounds
        image[int(b.y) : int(b.y + b.height), int(b.x) : int(b.x + b.width)] = dark if square.is_playable else light
    return image


def _regions(classifier, index):  # type: ignore[no-untyped-def]
    s = classifier.shape
    return square_regions(
        board_grid(800, 800)[index],
        edge_margin_ratio=s.edgeMarginRatio,
        piece_radius_ratio=s.pieceRadiusRatio,
        king_mark_radius_ratio=s.kingMarkRadiusRatio,
        background_min_radius_ratio=s.backgroundMinRadiusRatio,
    )


def test_features_of_an_empty_and_an_occupied_square(classifier) -> None:  # type: ignore[no-untyped-def]
    image = _plain_board()
    regions = _regions(classifier, 1)
    corners = measure_corners(image, regions)
    assert [c.color for c in corners] == [(60, 90, 140)] * 4
    empty = extract_square_features(image, 1, regions, (60, 90, 140), 0.1, classifier.color)
    assert empty.foreground_ratio == 0 and empty.ring_foreground_ratio == 0

    cx, cy = regions.center
    yy, xx = np.mgrid[0:800, 0:800]
    piece = (xx + 0.5 - cx) ** 2 + (yy + 0.5 - cy) ** 2 <= (0.4 * regions.size) ** 2
    image[piece] = (235, 230, 220)
    mask = np.zeros((800, 800), dtype=np.uint8)
    occupied = extract_square_features(image, 1, regions, (60, 90, 140), 0.1, classifier.color, mask)
    assert occupied.foreground_ratio == pytest.approx(1)
    assert occupied.body_luminance > 0.85
    assert int(mask.max()) == 255  # the diagnostic mask marks the piece pixels


def test_frame_quality_and_alignment() -> None:
    image = _plain_board()
    quality = measure_frame_quality(image)
    assert quality.sharpness > 15 and 0 < quality.mean_luminance < 1
    assert grid_alignment_quality(image) == pytest.approx(1)
    shifted = np.roll(image, 40, axis=1)  # half a square off: borders no longer on the grid
    assert grid_alignment_quality(shifted) < 0.5
    assert denoise(image, 1) is image
    assert denoise(image, 5).shape == image.shape


def test_margin_confidence_and_consolidation(classifier) -> None:  # type: ignore[no-untyped-def]
    assert margin_confidence(0, 1) == 0.5
    assert margin_confidence(2, 1) == 1
    empty = StageOutcome("EMPTY", 0.9, "EMPTY_BACKGROUND")
    assert consolidate(empty, None, None, classifier).piece == "EMPTY"
    unsure = StageOutcome("UNDETERMINED", UNDETERMINED_CONFIDENCE, "PARTIAL_OCCUPANCY")
    result = consolidate(unsure, None, None, classifier)
    assert (result.piece, result.decision, result.reason) == ("UNKNOWN", "RETRY", "PARTIAL_OCCUPANCY")
    occupied = StageOutcome("OCCUPIED", 1, "OCCUPIED_FOREGROUND")
    weak_color = StageOutcome("WHITE", 0.7, "WHITE_CONTRAST")
    man = StageOutcome("MAN", 1, "NO_MARK")
    warned = consolidate(occupied, weak_color, man, classifier)
    assert (warned.piece, warned.decision, warned.limiting_stage) == ("WHITE", "WARN", "COLOR")
