"""Homographies and perspective warp (spec §7 steps 2–4).

`perspective_transform` / `warp` use OpenCV exactly as the browser worker does
(`getPerspectiveTransform` on float32 points, `warpPerspective` with bilinear
interpolation and a black constant border). `unit_homography` mirrors the app's own
`computeHomography` (domain/board/homography.ts), used by the corner refinement.
"""

from __future__ import annotations

import cv2
import numpy as np

from .calibration import Corners

Homography = np.ndarray  # (3, 3) float64, row-major


def perspective_transform(corners: Corners, width: int, height: int) -> Homography:
    source = np.array(corners.as_list(), dtype=np.float32)
    destination = np.array(
        [[0, 0], [width, 0], [width, height], [0, height]], dtype=np.float32
    )
    transform = cv2.getPerspectiveTransform(source, destination)
    if transform.shape != (3, 3) or not np.all(np.isfinite(transform)):
        raise ValueError("OpenCV returned an invalid perspective transform")
    return transform.astype(np.float64)


def warp(image: np.ndarray, transform: Homography, width: int, height: int) -> np.ndarray:
    return cv2.warpPerspective(
        image,
        transform,
        (width, height),
        flags=cv2.INTER_LINEAR,
        borderMode=cv2.BORDER_CONSTANT,
        borderValue=(0, 0, 0),
    )


UNIT_SQUARE = ((0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0))


def unit_homography(corners: Corners) -> Homography | None:
    """Homography from the unit square to the corners (h22 = 1); None when degenerate."""
    matrix = []
    rhs = []
    for (x, y), (u, v) in zip(UNIT_SQUARE, corners.as_list(), strict=True):
        matrix.append([x, y, 1, 0, 0, 0, -u * x, -u * y])
        rhs.append(u)
        matrix.append([0, 0, 0, x, y, 1, -v * x, -v * y])
        rhs.append(v)
    try:
        solution = np.linalg.solve(np.array(matrix, dtype=np.float64), np.array(rhs))
    except np.linalg.LinAlgError:
        return None
    if not np.all(np.isfinite(solution)):
        return None
    return np.append(solution, 1.0).reshape(3, 3)


def apply_homography(h: Homography, x: np.ndarray, y: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Vectorized point mapping."""
    w = h[2, 0] * x + h[2, 1] * y + h[2, 2]
    return (h[0, 0] * x + h[0, 1] * y + h[0, 2]) / w, (h[1, 0] * x + h[1, 1] * y + h[1, 2]) / w
