"""Stage A inputs: sharpness and exposure (OpenCV), smoothing, grid alignment.

Same operations as `frame-quality.ts`, `denoise.ts` and `grid-alignment.ts`.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import cv2
import numpy as np

from ..geometry.board import BOARD_SIZE


@dataclass(frozen=True)
class FrameQuality:
    #: Variance of the Laplacian of the grayscale image (higher = sharper).
    sharpness: float
    #: Mean luminance 0..1.
    mean_luminance: float


def measure_frame_quality(image: np.ndarray) -> FrameQuality:
    gray = cv2.cvtColor(image, cv2.COLOR_RGB2GRAY)
    laplacian = cv2.Laplacian(gray, cv2.CV_64F)
    _, deviation = cv2.meanStdDev(laplacian)
    std = float(deviation[0][0])
    return FrameQuality(std * std, float(cv2.mean(gray)[0]) / 255)


def denoise(image: np.ndarray, kernel_size: int) -> np.ndarray:
    """Gaussian smoothing before feature extraction; a kernel ≤ 1 disables it."""
    if kernel_size <= 1:
        return image
    return cv2.GaussianBlur(image, (kernel_size, kernel_size), 0, 0, borderType=cv2.BORDER_REPLICATE)


MAX_OFFSET = 0.4
OFFSET_STEP = 0.05
DERIVATIVE_PX = 2
SAMPLES_PER_SEGMENT = 24
QUANTILE = 0.25


def _offsets() -> list[float]:
    # Same floating-point accumulation as the browser loop (offset += 0.05).
    offsets = []
    offset = -MAX_OFFSET
    while offset <= MAX_OFFSET + 1e-9:
        offsets.append(offset)
        offset += OFFSET_STEP
    return offsets


_OFFSETS = _offsets()


def grid_alignment_quality(image: np.ndarray) -> float:
    """For each internal grid line (far and near half), the edge contrast on the line
    relative to the best contrast within ±0.4 square: 1 when the borders sit on the grid.

    Vectorized over lines, halves, offsets and samples (same values as the browser loop)."""
    height, width = image.shape[:2]
    square = width / BOARD_SIZE
    k = np.arange(1, BOARD_SIZE, dtype=np.float64)[:, None, None, None]
    half = np.array([0.0, 1.0])[None, :, None, None]
    offsets = np.array([0.0, *_OFFSETS])[None, None, :, None]
    i = np.arange(SAMPLES_PER_SEGMENT, dtype=np.float64)[None, None, None, :]
    shape = (BOARD_SIZE - 1, 2, offsets.shape[2], SAMPLES_PER_SEGMENT)
    along = np.broadcast_to((half * 0.5 + ((i + 0.5) / SAMPLES_PER_SEGMENT) * 0.5) * width, shape)
    across = np.broadcast_to(k * square + offsets * square, shape)

    def luma_at(x: np.ndarray, y: np.ndarray) -> np.ndarray:
        px = np.floor(x + 0.5).astype(np.int64)
        py = np.floor(y + 0.5).astype(np.int64)
        inside = (px >= 0) & (py >= 0) & (px < width) & (py < height)
        # Luma of the sampled pixels only (about 24 000 of the 640 000).
        rgb = image[np.clip(py, 0, height - 1), np.clip(px, 0, width - 1)].astype(np.float64)
        values = (0.299 * rgb[..., 0] + 0.587 * rgb[..., 1] + 0.114 * rgb[..., 2]) / 255
        return np.where(inside, values, np.nan)

    qualities: list[np.ndarray] = []
    for vertical in (True, False):
        if vertical:
            a = luma_at(across - DERIVATIVE_PX, along)
            b = luma_at(across + DERIVATIVE_PX, along)
        else:
            a = luma_at(along, across - DERIVATIVE_PX)
            b = luma_at(along, across + DERIVATIVE_PX)
        difference = np.abs(a - b)
        valid = ~np.isnan(difference)
        count = valid.sum(axis=-1)
        total = np.where(valid, difference, 0.0).sum(axis=-1)
        contrast = np.where(count > 0, total / np.maximum(count, 1), 0.0)
        on_line = contrast[..., 0]
        best = contrast.max(axis=-1)
        qualities.append((on_line / np.where(best > 0, best, 1))[best > 0])
    values = np.concatenate(qualities)
    if values.size == 0:
        return 0.0
    ordered = np.sort(values)
    return float(ordered[math.floor((len(ordered) - 1) * QUANTILE)])
