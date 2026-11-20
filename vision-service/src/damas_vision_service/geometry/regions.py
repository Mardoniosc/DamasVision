"""Grid and analysis regions on the normalized board (`board-grid.ts`, `square-regions.ts`).

Every region derives from the calibrated square size; nothing is a fixed pixel position.
The diagnostic view draws these same regions from the traces ("the ROI shown is the ROI used").
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from .board import BOARD_SIZE, SQUARE_COUNT, is_playable


@dataclass(frozen=True)
class Rect:
    x: float
    y: float
    width: float
    height: float


@dataclass(frozen=True)
class SquareGeometry:
    index: int
    row: int
    column: int
    bounds: Rect
    center: tuple[float, float]
    is_playable: bool


def board_grid(width: int, height: int) -> list[SquareGeometry]:
    if not (width > 0 and height > 0):
        raise ValueError(f"invalid board size {width}x{height}")
    square_w = width / BOARD_SIZE
    square_h = height / BOARD_SIZE
    grid = []
    for index in range(SQUARE_COUNT):
        row, column = divmod(index, BOARD_SIZE)
        bounds = Rect(column * square_w, row * square_h, square_w, square_h)
        grid.append(
            SquareGeometry(
                index,
                row,
                column,
                bounds,
                (bounds.x + square_w / 2, bounds.y + square_h / 2),
                is_playable(index),
            )
        )
    return grid


def square_roi(square: SquareGeometry, inset_ratio: float) -> Rect:
    """Central region inset by `inset_ratio` of the square size on each edge."""
    if not 0 <= inset_ratio < 0.5:
        raise ValueError(f"inset_ratio must be in [0, 0.5), got {inset_ratio}")
    dx = square.bounds.width * inset_ratio
    dy = square.bounds.height * inset_ratio
    b = square.bounds
    return Rect(b.x + dx, b.y + dy, b.width - 2 * dx, b.height - 2 * dy)


#: The body ring starts this far outside the mark radius, to skip anti-aliased edges.
BODY_INNER_GAP = 1.6


@dataclass(frozen=True)
class SquareRegions:
    center: tuple[float, float]
    size: float
    area: Rect
    piece_radius: float
    mark_radius: float
    body_inner_radius: float
    background_radius: float


def square_regions(
    square: SquareGeometry,
    *,
    edge_margin_ratio: float,
    piece_radius_ratio: float,
    king_mark_radius_ratio: float,
    background_min_radius_ratio: float,
) -> SquareRegions:
    size = min(square.bounds.width, square.bounds.height)
    margin = size * edge_margin_ratio
    piece_radius = piece_radius_ratio * size
    mark_radius = king_mark_radius_ratio * size
    b = square.bounds
    return SquareRegions(
        center=square.center,
        size=size,
        area=Rect(b.x + margin, b.y + margin, b.width - 2 * margin, b.height - 2 * margin),
        piece_radius=piece_radius,
        mark_radius=mark_radius,
        body_inner_radius=min(mark_radius * BODY_INNER_GAP, piece_radius * 0.9),
        background_radius=background_min_radius_ratio * size,
    )


@dataclass(frozen=True)
class PixelBounds:
    x0: int
    y0: int
    x1: int
    y1: int


def pixel_bounds(width: int, height: int, rect: Rect) -> PixelBounds:
    """Integer pixel bounds of a rect, clipped to the image."""
    return PixelBounds(
        max(0, math.ceil(rect.x)),
        max(0, math.ceil(rect.y)),
        min(width, math.floor(rect.x + rect.width)),
        min(height, math.floor(rect.y + rect.height)),
    )
