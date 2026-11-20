"""Background model (`background-model.ts`): which corners of a square show the bare board."""

from __future__ import annotations

from dataclasses import dataclass

from ..jsmath import median
from .config import ColorThresholds
from .features import CornerSample, Rgb, chroma_distance, luminance


@dataclass(frozen=True)
class BoardBackground:
    color: Rgb
    #: Typical corner luminance divided by the local light reference.
    relative_luminance: float


@dataclass(frozen=True)
class SquareBackground:
    color: Rgb
    visible_corners: int
    corner_matches: list[bool]


def _median_rgb(colors: list[Rgb]) -> Rgb:
    return (
        median([c[0] for c in colors]),
        median([c[1] for c in colors]),
        median([c[2] for c in colors]),
    )


def board_background(
    corners_by_square: list[list[CornerSample]], light_references: list[float]
) -> BoardBackground:
    """Median over every corner of every playable square: most corners show the board."""
    colors: list[Rgb] = []
    ratios: list[float] = []
    for corners, reference in zip(corners_by_square, light_references, strict=True):
        for corner in corners:
            if corner.pixels == 0:
                continue
            colors.append(corner.color)
            if reference > 0:
                ratios.append(luminance(*corner.color) / reference)
    return BoardBackground(_median_rgb(colors), median(ratios))


def square_background(
    corners: list[CornerSample],
    light_reference: float,
    board: BoardBackground,
    color: ColorThresholds,
) -> SquareBackground:
    """Corners with the board's chromaticity and a similar luminance relative to the local
    light; corners covered by a piece or an object are ignored."""
    matches = []
    for corner in corners:
        if corner.pixels == 0 or light_reference <= 0:
            matches.append(False)
            continue
        ratio = luminance(*corner.color) / light_reference
        matches.append(
            chroma_distance(corner.color, board.color) <= color.backgroundChromaTolerance
            and abs(ratio - board.relative_luminance) <= color.backgroundRatioTolerance
        )
    visible = [c for c, m in zip(corners, matches, strict=True) if m]
    used = visible if visible else [c for c in corners if c.pixels > 0]
    return SquareBackground(_median_rgb([c.color for c in used]), len(visible), matches)
