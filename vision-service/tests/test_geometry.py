"""Geometry: board conventions, corner validation, viewing direction, grid and ROIs."""

from __future__ import annotations

import math

import numpy as np
import pytest

from damas_vision_service.geometry.board import PLAYABLE_SQUARES, is_playable, square_index, square_name
from damas_vision_service.geometry.calibration import Corners, away_from_camera, validate_corners
from damas_vision_service.geometry.perspective import (
    apply_homography,
    perspective_transform,
    unit_homography,
    warp,
)
from damas_vision_service.geometry.regions import board_grid, pixel_bounds, square_regions, square_roi, Rect

SQUARE = Corners((100, 100), (500, 100), (500, 500), (100, 500))


def codes(issues) -> list[str]:  # type: ignore[no-untyped-def]
    return [issue.code for issue in issues]


def test_board_conventions() -> None:
    assert len(PLAYABLE_SQUARES) == 32
    assert is_playable(square_index(7, 0))  # bottom-left is playable (Brazilian placement)
    assert not is_playable(square_index(7, 1))
    assert square_name(square_index(7, 0)) == "a1"
    assert square_name(square_index(0, 7)) == "h8"


def test_valid_corners_have_no_issue() -> None:
    assert validate_corners(SQUARE, 640, 640) == []


@pytest.mark.parametrize(
    ("corners", "expected"),
    [
        (Corners((100, 100), (100, 500), (500, 500), (500, 100)), "WRONG_ORDER"),
        (Corners((100, 100), (500, 100), (200, 200), (100, 500)), "NOT_CONVEX"),
        (Corners((100, 100), (700, 100), (500, 500), (100, 500)), "OUT_OF_BOUNDS"),
        (Corners((100, 100), (110, 100), (110, 110), (100, 110)), "CORNERS_TOO_CLOSE"),
        (Corners((100, 100), (180, 100), (180, 180), (100, 180)), "AREA_TOO_SMALL"),
        (Corners((math.nan, 100), (500, 100), (500, 500), (100, 500)), "INVALID_POINT"),
    ],
)
def test_invalid_corners_are_reported(corners: Corners, expected: str) -> None:
    assert expected in codes(validate_corners(corners, 640, 640))


def test_invalid_source_size() -> None:
    assert codes(validate_corners(SQUARE, 0, 640)) == ["INVALID_SOURCE_SIZE"]


def test_away_from_camera() -> None:
    assert away_from_camera(SQUARE, 0.05) is None  # seen from above
    oblique = Corners((200, 100), (440, 100), (600, 500), (40, 500))  # far edge (top) shorter
    direction = away_from_camera(oblique, 0.05)
    assert direction is not None
    assert direction[1] < -0.99 and abs(direction[0]) < 1e-9


def test_perspective_maps_corners_to_the_normalized_board() -> None:
    corners = Corners((120, 80), (520, 95), (560, 470), (90, 450))
    h = perspective_transform(corners, 800, 800)
    xs, ys = apply_homography(h, np.array([120.0, 560.0]), np.array([80.0, 470.0]))
    assert np.allclose([xs[0], ys[0]], [0, 0], atol=1e-3)
    assert np.allclose([xs[1], ys[1]], [800, 800], atol=1e-3)


def test_unit_homography_and_degenerate_corners() -> None:
    h = unit_homography(SQUARE)
    assert h is not None
    x, y = apply_homography(h, np.array([0.5]), np.array([0.5]))
    assert np.allclose([x[0], y[0]], [300, 300])
    assert unit_homography(Corners((1, 1), (1, 1), (1, 1), (1, 1))) is None


def test_warp_output_size_and_border() -> None:
    image = np.full((480, 640, 3), 200, dtype=np.uint8)
    out = warp(image, perspective_transform(Corners((0, 0), (640, 0), (640, 480), (0, 480)), 400, 400), 400, 400)
    assert out.shape == (400, 400, 3)
    assert int(out[200, 200, 0]) == 200


def test_grid_and_regions_derive_from_the_square_size() -> None:
    grid = board_grid(800, 800)
    assert len(grid) == 64
    square = grid[square_index(7, 0)]
    assert square.center == (50, 750)
    regions = square_regions(
        square,
        edge_margin_ratio=0.03,
        piece_radius_ratio=0.3,
        king_mark_radius_ratio=0.1,
        background_min_radius_ratio=0.47,
    )
    assert regions.size == 100
    assert regions.piece_radius == pytest.approx(30)
    assert regions.area.x == pytest.approx(3) and regions.area.width == pytest.approx(94)
    roi = square_roi(square, 0.15)
    assert roi.x == pytest.approx(15) and roi.width == pytest.approx(70)
    with pytest.raises(ValueError):
        square_roi(square, 0.5)


def test_pixel_bounds_are_clipped() -> None:
    bounds = pixel_bounds(100, 100, Rect(-5.5, 10.2, 200, 50.5))
    assert (bounds.x0, bounds.y0, bounds.x1, bounds.y1) == (0, 11, 100, 60)
