"""King-mark search on the displaced top face of tall pieces (`top-face.ts`, G3).

An oblique camera sees a tall piece's top face, where a king's colored mark is, projected
away from the camera. The mark is searched along that line; mark pixels must be bright
enough, differ in chromaticity from the body, and not be a blend of two of {body, square
background, light square, neutral gray}. Coverage is the most mark pixels in one disk of
1.5 mark radii slid along the line, relative to the expected mark area.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

from ..geometry.regions import Rect, SquareRegions, pixel_bounds
from .config import ClassifierConfig
from .features import Rgb, chromaticity, pixel_chromaticity, window_planes

NEUTRAL = (1 / 3, 1 / 3)
MARK_DISK_RADII = 1.5


@dataclass(frozen=True)
class MarkSearch:
    coverage: float
    offset: tuple[float, float] | None


@dataclass(frozen=True)
class MarkColors:
    body: Rgb
    background: Rgb
    light: Rgb
    light_luminance: float


def _distance_to_segment(
    pr: np.ndarray, pg: np.ndarray, a: tuple[float, float], b: tuple[float, float]
) -> np.ndarray:
    dx = b[0] - a[0]
    dy = b[1] - a[1]
    length2 = dx * dx + dy * dy
    if length2 == 0:
        t = np.zeros_like(pr)
    else:
        t = np.clip(((pr - a[0]) * dx + (pg - a[1]) * dy) / length2, 0, 1)
    return np.hypot(pr - a[0] - t * dx, pg - a[1] - t * dy)


def search_king_mark(
    image: np.ndarray,
    regions: SquareRegions,
    away: tuple[float, float] | None,
    colors: MarkColors,
    config: ClassifierConfig,
) -> MarkSearch:
    color, shape = config.color, config.shape
    cx, cy = regions.center
    size, mark_radius = regions.size, regions.mark_radius
    shift = shape.topFaceMaxShiftRatio * size if away else 0.0
    sx = (away[0] if away else 0.0) * shift
    sy = (away[1] if away else 0.0) * shift
    radius = shape.markSearchRadiusRatio * size
    height, width = image.shape[:2]
    b = pixel_bounds(
        width,
        height,
        Rect(
            cx + min(0.0, sx) - radius,
            cy + min(0.0, sy) - radius,
            abs(sx) + 2 * radius,
            abs(sy) + 2 * radius,
        ),
    )
    expected = math.pi * mark_radius * mark_radius
    if b.x1 <= b.x0 or b.y1 <= b.y0:
        return MarkSearch(0.0, None)
    px, py = np.meshgrid(np.arange(b.x0, b.x1) + 0.5 - cx, np.arange(b.y0, b.y1) + 0.5 - cy)
    segment2 = sx * sx + sy * sy
    t = np.zeros_like(px) if segment2 == 0 else np.clip((px * sx + py * sy) / segment2, 0, 1)
    ex = px - t * sx
    ey = py - t * sy
    near = ex * ex + ey * ey <= radius * radius

    _, r, g, bl, luma = window_planes(image, b.y0, b.y1, b.x0, b.x1)
    body_r, body_g = chromaticity(colors.body)

    # Cheap tests first; chromaticity and the blend test only run on the pixels left.
    candidate = near & (luma >= color.kingMarkMinLuminance * colors.light_luminance)
    pr, pg = pixel_chromaticity(r[candidate], g[candidate], bl[candidate])
    cand_x, cand_y = px[candidate], py[candidate]
    chromatic = np.hypot(pr - body_r, pg - body_g) >= color.kingMarkMinChroma
    pr, pg, cand_x, cand_y = pr[chromatic], pg[chromatic], cand_x[chromatic], cand_y[chromatic]
    anchors = [
        chromaticity(colors.body),
        chromaticity(colors.background),
        chromaticity(colors.light),
        NEUTRAL,
    ]
    keep = np.ones(pr.shape, dtype=bool)
    for i, a in enumerate(anchors):
        for bb in anchors[i + 1 :]:
            keep &= ~(_distance_to_segment(pr, pg, a, bb) < color.kingMarkBlendTolerance)
    cand_x, cand_y = cand_x[keep], cand_y[keep]
    disk_radius = MARK_DISK_RADII * mark_radius
    disk2 = disk_radius * disk_radius
    steps = max(1, math.ceil(math.sqrt(segment2) / (mark_radius / 2)))
    best = (0, 0.0, 0.0)
    for step in range(steps + 1):
        dcx = sx * step / steps
        dcy = sy * step / steps
        inside = (cand_x - dcx) ** 2 + (cand_y - dcy) ** 2 <= disk2
        count = int(inside.sum())
        if count > best[0]:
            best = (count, float(cand_x[inside].sum()), float(cand_y[inside].sum()))
    count, sum_x, sum_y = best
    return MarkSearch(
        coverage=count / expected if expected > 0 else 0.0,
        offset=None if count == 0 else (sum_x / count / size, sum_y / count / size),
    )
