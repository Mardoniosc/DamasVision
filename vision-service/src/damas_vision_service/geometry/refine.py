"""Automatic corner adjustment (`REFINE_CALIBRATION`, ADR-027), ported from
`src/app/vision/calibration-refinement.ts` with the same objective, search and constants.

Snaps manually placed corners to the board's square borders: maximizes the luminance
contrast across the 18 projected grid lines, staying within half a square of the user's
corners. `grid_score` is vectorized with NumPy; the search is the same deterministic
coordinate descent with basin hopping.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

from .board import BOARD_SIZE
from .calibration import Corners, Point, validate_corners
from .perspective import apply_homography, unit_homography

MAX_SHIFT_SQUARES = 0.5
SAMPLES_PER_LINE = 48
MIN_STEP_PX = 0.5
FINE_OFFSET_PX = 1.5
COARSE_OFFSET = 0.25
SEARCH_SAMPLE_DIVISOR = 2
SEARCH_MIN_STEP_PX = 1.0
POLISH_FIRST_STEP_PX = 2.0
DESCENT_START_SQUARES = 0.25
HOP_SQUARES = 0.3
HOP_ROUNDS = 2
HOP_DIRECTIONS = (
    (1, 0),
    (-1, 0),
    (0, 1),
    (0, -1),
    (0.7, 0.7),
    (0.7, -0.7),
    (-0.7, 0.7),
    (-0.7, -0.7),
)
TRIM = 0.25
COARSE_WEIGHT = 0.5
OUTER_LINE_WEIGHT = 0.5
MIN_RELATIVE_GAIN = 1e-4


@dataclass(frozen=True)
class RefinementResult:
    corners: Corners
    score_before: float
    score_after: float
    max_shift_px: float


def to_gray(image: np.ndarray) -> np.ndarray:
    """Rec. 601 luma rounded like the browser (`Math.round`), as float64 for sampling."""
    rgb = image.astype(np.float64)
    luma = 0.299 * rgb[..., 0] + 0.587 * rgb[..., 1] + 0.114 * rgb[..., 2]
    return np.floor(luma + 0.5)


def _sample(gray: np.ndarray, px: np.ndarray, py: np.ndarray) -> np.ndarray:
    """Bilinear samples; NaN outside the image."""
    height, width = gray.shape
    x = px - 0.5
    y = py - 0.5
    inside = (x >= 0) & (y >= 0) & (x < width - 1) & (y < height - 1)
    xs = np.where(inside, x, 0.0)
    ys = np.where(inside, y, 0.0)
    x0 = np.floor(xs).astype(np.int64)
    y0 = np.floor(ys).astype(np.int64)
    fx = xs - x0
    fy = ys - y0
    top = gray[y0, x0] * (1 - fx) + gray[y0, x0 + 1] * fx
    bottom = gray[y0 + 1, x0] * (1 - fx) + gray[y0 + 1, x0 + 1] * fx
    return np.where(inside, top * (1 - fy) + bottom * fy, np.nan)


def _trimmed_means(values: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Per-row mean after discarding `TRIM` of the valid (non-NaN) values at each end, as
    the browser's `trimmedMean` on each line's samples. Returns (means, valid counts)."""
    ordered = np.sort(values, axis=1)  # NaN sorts last
    valid = ~np.isnan(ordered)
    counts = valid.sum(axis=1)
    cuts = np.floor(counts * TRIM).astype(np.int64)
    cumulative = np.concatenate(
        [np.zeros((ordered.shape[0], 1)), np.cumsum(np.where(valid, ordered, 0.0), axis=1)], axis=1
    )
    rows = np.arange(ordered.shape[0])
    kept = counts - 2 * cuts
    sums = cumulative[rows, counts - cuts] - cumulative[rows, cuts]
    means = np.where(kept > 0, sums / np.maximum(kept, 1), 0.0)
    return means, counts


def _line_arrays(samples: int) -> tuple[np.ndarray, ...]:
    """u, v, du, dv and weights for the 9 horizontal + 9 vertical grid lines."""
    square = 1 / BOARD_SIZE
    s = (np.arange(samples) + 0.5) / samples
    us, vs, dus, dvs, weights = [], [], [], [], []
    for k in range(BOARD_SIZE + 1):
        t = k * square
        weight = OUTER_LINE_WEIGHT if k in (0, BOARD_SIZE) else 1.0
        for horizontal in (True, False):
            us.append(s if horizontal else np.full(samples, t))
            vs.append(np.full(samples, t) if horizontal else s)
            dus.append(0.0 if horizontal else 1.0)
            dvs.append(1.0 if horizontal else 0.0)
            weights.append(weight)
    return (
        np.array(us),
        np.array(vs),
        np.array(dus)[:, None],
        np.array(dvs)[:, None],
        np.array(weights),
    )


_LINES_CACHE: dict[int, tuple[np.ndarray, ...]] = {}


def grid_score(gray: np.ndarray, corners: Corners, samples_per_line: int = SAMPLES_PER_LINE) -> float:
    """Contrast across the projected grid lines (higher = better aligned). Vectorized over
    lines and samples; one bilinear sampling pass for the fine and the coarse offsets."""
    h = unit_homography(corners)
    if h is None:
        return 0.0
    if samples_per_line not in _LINES_CACHE:
        _LINES_CACHE[samples_per_line] = _line_arrays(samples_per_line)
    u, v, du, dv, weights = _LINES_CACHE[samples_per_line]
    square = 1 / BOARD_SIZE
    half = 0.5 / BOARD_SIZE

    ax, ay = apply_homography(h, u - du * half, v - dv * half)
    bx, by = apply_homography(h, u + du * half, v + dv * half)
    square_px = np.hypot(ax - bx, ay - by)
    with np.errstate(divide="ignore", invalid="ignore"):
        fine_offset = np.where(square_px > 0, (FINE_OFFSET_PX / square_px) * square, 0.0)
    offset_u = np.stack([du * fine_offset, np.broadcast_to(du * COARSE_OFFSET * square, u.shape)])
    offset_v = np.stack([dv * fine_offset, np.broadcast_to(dv * COARSE_OFFSET * square, u.shape)])
    x1, y1 = apply_homography(h, u - offset_u, v - offset_v)
    x2, y2 = apply_homography(h, u + offset_u, v + offset_v)
    samples = _sample(gray, np.stack([x1, x2]), np.stack([y1, y2]))
    contrast = np.abs(samples[0] - samples[1])  # (2: fine/coarse, lines, samples)

    fine, fine_n = _trimmed_means(contrast[0])
    coarse, coarse_n = _trimmed_means(contrast[1])
    used = (fine_n > 0) & (coarse_n > 0)
    weight = float((weights * used).sum() * (1 + COARSE_WEIGHT))
    total = float((weights * used * (fine + COARSE_WEIGHT * coarse)).sum())
    return 0.0 if weight == 0 else total / weight


def _local_square_sizes(corners: Corners) -> list[float]:
    tl, tr, br, bl = corners.as_list()

    def edge(a: Point, b: Point) -> float:
        return math.dist(a, b) / BOARD_SIZE

    return [
        min(edge(tl, tr), edge(tl, bl)),
        min(edge(tr, tl), edge(tr, br)),
        min(edge(br, tr), edge(br, bl)),
        min(edge(bl, br), edge(bl, tl)),
    ]


def refine_corners(gray: np.ndarray, canonical: Corners) -> RefinementResult:
    height, width = gray.shape
    initial = [list(p) for p in canonical.as_list()]
    square_px = _local_square_sizes(canonical)
    mean_square_px = sum(square_px) / len(square_px)
    score_before = grid_score(gray, canonical, SAMPLES_PER_LINE)
    search_samples = max(8, math.floor(SAMPLES_PER_LINE / SEARCH_SAMPLE_DIVISOR + 0.5))

    def allowed(corner: int, point: list[float]) -> bool:
        return math.dist(point, initial[corner]) <= MAX_SHIFT_SQUARES * square_px[corner]

    def score(points: list[list[float]], samples: int) -> float | None:
        corners = Corners.from_list([(p[0], p[1]) for p in points])
        if validate_corners(corners, width, height):
            return None
        return grid_score(gray, corners, samples)

    def descend(
        start: list[list[float]], start_score: float, samples: int, first: float, last: float
    ) -> tuple[list[list[float]], float]:
        best = [list(p) for p in start]
        best_score = start_score
        step = first
        while step >= last:
            improved = True
            while improved:
                improved = False
                for corner in range(4):
                    for axis in (0, 1):
                        for sign in (1, -1):
                            candidate = [list(p) for p in best]
                            candidate[corner][axis] += sign * step
                            if not allowed(corner, candidate[corner]):
                                continue
                            value = score(candidate, samples)
                            if value is not None and value > best_score * (1 + MIN_RELATIVE_GAIN):
                                best = candidate
                                best_score = value
                                improved = True
            step /= 2
        return best, best_score

    search_start = grid_score(gray, canonical, search_samples)
    search_last = max(MIN_STEP_PX, SEARCH_MIN_STEP_PX)
    best_points, best_value = descend(
        initial, search_start, search_samples, mean_square_px * DESCENT_START_SQUARES, search_last
    )
    for _ in range(HOP_ROUNDS):
        hopped = False
        for corner in range(4):
            hop = HOP_SQUARES * square_px[corner]
            for dx, dy in HOP_DIRECTIONS:
                candidate = [list(p) for p in best_points]
                candidate[corner][0] += dx * hop
                candidate[corner][1] += dy * hop
                if not allowed(corner, candidate[corner]):
                    continue
                start = score(candidate, search_samples)
                if start is None:
                    continue
                local_points, local_value = descend(
                    candidate, start, search_samples, hop / 2, search_last
                )
                if local_value > best_value * (1 + MIN_RELATIVE_GAIN):
                    best_points, best_value = local_points, local_value
                    hopped = True
        if not hopped:
            break

    polish_start = score(best_points, SAMPLES_PER_LINE)
    polished_points, polished_value = descend(
        best_points,
        score_before if polish_start is None else polish_start,
        SAMPLES_PER_LINE,
        POLISH_FIRST_STEP_PX,
        MIN_STEP_PX,
    )
    if polished_value >= score_before:
        final_points, final_value = polished_points, polished_value
    else:
        final_points, final_value = initial, score_before
    return RefinementResult(
        corners=Corners.from_list([(p[0], p[1]) for p in final_points]),
        score_before=score_before,
        score_after=final_value,
        max_shift_px=max(math.dist(p, initial[i]) for i, p in enumerate(final_points)),
    )
