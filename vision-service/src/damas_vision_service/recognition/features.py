"""Per-square measurements (`square-features.ts`), vectorized with NumPy.

Images are RGB `uint8` arrays (height, width, 3). Luminance is Rec. 601 luma in 0..1;
chromaticity is (R, G) / (R + G + B), independent of brightness.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

from ..geometry.regions import Rect, SquareRegions, pixel_bounds
from .config import ColorThresholds

#: The occupancy ring is the outer part of the central disk, from this fraction of its radius.
OCCUPANCY_RING_INNER_FRACTION = 0.7
#: Maximum RGB distance (black ↔ white), to normalize color distances to 0..1.
RGB_DIAGONAL = math.sqrt(3 * 255 * 255)

Rgb = tuple[float, float, float]

#: Diagnostic mask values (foreground mask image, G3.1).
MASK_FOREGROUND = 255
MASK_SHADOW = 128


def window_planes(image: np.ndarray, y0: int, y1: int, x0: int, x1: int):  # type: ignore[no-untyped-def]
    """Float R, G, B and luma of an image window (only the windows the stages read are
    converted: about half the board)."""
    patch = image[y0:y1, x0:x1].astype(np.float64)
    r, g, b = patch[..., 0], patch[..., 1], patch[..., 2]
    return patch, r, g, b, (0.299 * r + 0.587 * g + 0.114 * b) / 255


def pixel_chromaticity(r: np.ndarray, g: np.ndarray, b: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Chromaticity of some pixels (1-D arrays); (1/3, 1/3) for black."""
    total = r + g + b
    safe = np.where(total == 0, 1, total)
    return np.where(total == 0, 1 / 3, r / safe), np.where(total == 0, 1 / 3, g / safe)


OffsetArrays = tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]
_OFFSET_CACHE: dict[tuple[float, float, int, int], OffsetArrays] = {}


def luminance(r: float, g: float, b: float) -> float:
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255


def chromaticity(color: Rgb) -> tuple[float, float]:
    total = color[0] + color[1] + color[2]
    return (1 / 3, 1 / 3) if total == 0 else (color[0] / total, color[1] / total)


def chroma_distance(a: Rgb, b: Rgb) -> float:
    ar, ag = chromaticity(a)
    br, bg = chromaticity(b)
    return math.hypot(ar - br, ag - bg)


def _histogram_median(values: np.ndarray) -> int:
    """The browser's 256-bin histogram median: the lower median for an even count."""
    count = values.size
    if count == 0:
        return 0
    k = math.ceil(count / 2) - 1
    return int(np.partition(values, k)[k])


def _median_rgb(pixels: np.ndarray) -> Rgb:
    """Per-channel histogram median of an (n, 3) uint8 array; (0, 0, 0) when empty."""
    if pixels.shape[0] == 0:
        return (0.0, 0.0, 0.0)
    return (
        float(_histogram_median(pixels[:, 0])),
        float(_histogram_median(pixels[:, 1])),
        float(_histogram_median(pixels[:, 2])),
    )


def median_color(image: np.ndarray, rect: Rect) -> Rgb:
    height, width = image.shape[:2]
    b = pixel_bounds(width, height, rect)
    if b.x1 <= b.x0 or b.y1 <= b.y0:
        return (0.0, 0.0, 0.0)
    return _median_rgb(image[b.y0 : b.y1, b.x0 : b.x1].reshape(-1, 3))


@dataclass(frozen=True)
class CornerSample:
    color: Rgb
    pixels: int


def _offsets(
    regions: SquareRegions, image: np.ndarray
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, tuple[int, int, int, int]]:
    """Pixel offsets from the square center (dx, dy, d², distance) over the square's area.
    The squares of one board share them, so they are cached by relative geometry."""
    height, width = image.shape[:2]
    b = pixel_bounds(width, height, regions.area)
    x1, y1 = max(b.x0, b.x1), max(b.y0, b.y1)
    key = (b.x0 + 0.5 - regions.center[0], b.y0 + 0.5 - regions.center[1], x1 - b.x0, y1 - b.y0)
    cached = _OFFSET_CACHE.get(key)
    if cached is None:
        xs = np.arange(b.x0, x1) + 0.5 - regions.center[0]
        ys = np.arange(b.y0, y1) + 0.5 - regions.center[1]
        dx, dy = np.meshgrid(xs, ys)
        d2 = dx * dx + dy * dy
        cached = (dx, dy, d2, np.sqrt(d2))
        if len(_OFFSET_CACHE) > 256:
            _OFFSET_CACHE.clear()
        _OFFSET_CACHE[key] = cached
    return (*cached, (b.x0, b.y0, x1, y1))


def measure_corners(image: np.ndarray, regions: SquareRegions) -> list[CornerSample]:
    """Median color of each corner quadrant (TL, TR, BR, BL), outside the background radius."""
    dx, dy, d2, _, (x0, y0, x1, y1) = _offsets(regions, image)
    patch = image[y0:y1, x0:x1]
    outside = d2 >= regions.background_radius * regions.background_radius
    quadrant = np.where(dy < 0, np.where(dx < 0, 0, 1), np.where(dx < 0, 3, 2))
    samples = []
    for q in range(4):
        pixels = patch[outside & (quadrant == q)]
        samples.append(CornerSample(_median_rgb(pixels), int(pixels.shape[0])))
    return samples


@dataclass(frozen=True)
class SquareFeatures:
    index: int
    background_color: Rgb
    background_luminance: float
    piece_color: Rgb
    piece_luminance: float
    piece_luminance_std: float
    color_distance: float
    foreground_ratio: float
    shadow_ratio: float
    ring_foreground_ratio: float
    mark_luminance: float
    body_luminance: float
    mark_color: Rgb
    body_color: Rgb


def _mean_rgb(pixels: np.ndarray) -> Rgb:
    if pixels.shape[0] == 0:
        return (0.0, 0.0, 0.0)
    total = pixels.sum(axis=0)
    n = pixels.shape[0]
    return (float(total[0]) / n, float(total[1]) / n, float(total[2]) / n)


def extract_square_features(
    image: np.ndarray,
    index: int,
    regions: SquareRegions,
    background: Rgb,
    distance: float,
    color: ColorThresholds,
    mask: np.ndarray | None = None,
) -> SquareFeatures:
    """Features of one square against `background`. A disk pixel is foreground when it
    differs from the background by more than `distance` (fraction of the RGB diagonal),
    unless it keeps the background's chromaticity with a shadow/glare-like luminance
    change. When `mask` is given, foreground and shadow pixels are drawn into it."""
    _, _, d2, distance_px, (x0, y0, x1, y1) = _offsets(regions, image)
    patch, r, g, b, luma = window_planes(image, y0, y1, x0, x1)
    piece_r2 = regions.piece_radius * regions.piece_radius
    disk = d2 <= piece_r2
    ring = disk & (d2 >= (OCCUPANCY_RING_INNER_FRACTION * regions.piece_radius) ** 2)

    threshold2 = (distance * RGB_DIAGONAL) ** 2
    bg_luma = luminance(*background)
    differs = disk & ((r - background[0]) ** 2 + (g - background[1]) ** 2 + (b - background[2]) ** 2 > threshold2)

    shadow = np.zeros_like(differs)
    if bg_luma >= color.chromaMinLuminance:
        ratio = luma / bg_luma  # bg_luma >= chromaMinLuminance > 0
        bcr, bcg = chromaticity(background)
        shadow = (
            differs
            & (luma >= color.chromaMinLuminance * color.shadowMinRatio)
            & (ratio >= color.shadowMinRatio)
            & (ratio <= color.glareMaxRatio)
        )
        # Chromaticity only for the pixels that can still be shadow or glare.
        cr, cg = pixel_chromaticity(r[shadow], g[shadow], b[shadow])
        shadow[shadow] = np.hypot(cr - bcr, cg - bcg) <= color.shadowChromaTolerance
    foreground = differs & ~shadow
    mark = foreground & (distance_px <= regions.mark_radius)
    body = foreground & ~mark & (distance_px >= regions.body_inner_radius)

    if mask is not None:
        window = mask[y0:y1, x0:x1]
        window[shadow] = MASK_SHADOW
        window[foreground] = MASK_FOREGROUND

    disk_count = int(disk.sum())
    ring_count = int(ring.sum())
    disk_luma = luma[disk]
    piece_luminance = float(disk_luma.mean()) if disk_count else 0.0
    variance = (
        max(0.0, float((disk_luma * disk_luma).sum()) / disk_count - piece_luminance**2)
        if disk_count
        else 0.0
    )
    pixels = patch.reshape(-1, 3)
    piece_color = _mean_rgb(pixels[disk.reshape(-1)])
    body_pixels = pixels[body.reshape(-1)]
    mark_pixels = pixels[mark.reshape(-1)]
    body_count = body_pixels.shape[0]
    body_luminance = float(luma[body].mean()) if body_count else 0.0
    body_color = _mean_rgb(body_pixels)
    mark_count = mark_pixels.shape[0]
    return SquareFeatures(
        index=index,
        background_color=background,
        background_luminance=bg_luma,
        piece_color=piece_color,
        piece_luminance=piece_luminance,
        piece_luminance_std=math.sqrt(variance),
        color_distance=math.hypot(
            piece_color[0] - background[0],
            piece_color[1] - background[1],
            piece_color[2] - background[2],
        )
        / RGB_DIAGONAL,
        foreground_ratio=int(foreground.sum()) / disk_count if disk_count else 0.0,
        shadow_ratio=int(shadow.sum()) / disk_count if disk_count else 0.0,
        ring_foreground_ratio=int((foreground & ring).sum()) / ring_count if ring_count else 0.0,
        body_luminance=body_luminance,
        body_color=body_color,
        mark_luminance=float(luma[mark].mean()) if mark_count else body_luminance,
        mark_color=_mean_rgb(mark_pixels) if mark_count else body_color,
    )
