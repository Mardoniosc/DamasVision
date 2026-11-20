"""Calibration corners: validation (spec §7 step 1) and viewing direction.

The app validates corners before sending them (`domain/board/calibration.ts`); the service
validates them again, because a request is untrusted, with the same rules and thresholds.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

Point = tuple[float, float]

CORNER_NAMES = ("topLeft", "topRight", "bottomRight", "bottomLeft")

#: Same initial values as `DEFAULT_CORNER_VALIDATION` (domain/board/calibration.ts).
MIN_CORNER_DISTANCE_RATIO = 0.05
MIN_AREA_RATIO = 0.04


@dataclass(frozen=True)
class Corners:
    """Canonical corners (orientation already applied), in source pixels."""

    top_left: Point
    top_right: Point
    bottom_right: Point
    bottom_left: Point

    def as_list(self) -> list[Point]:
        return [self.top_left, self.top_right, self.bottom_right, self.bottom_left]

    @staticmethod
    def from_list(points: list[Point]) -> Corners:
        return Corners(points[0], points[1], points[2], points[3])

    def to_json(self) -> dict[str, dict[str, float]]:
        return {
            name: {"x": point[0], "y": point[1]}
            for name, point in zip(CORNER_NAMES, self.as_list(), strict=True)
        }


@dataclass(frozen=True)
class CalibrationIssue:
    code: str
    corners: tuple[str, ...]

    def to_json(self) -> dict[str, object]:
        return {"code": self.code, "corners": list(self.corners)}


def _turn(a: Point, b: Point, c: Point) -> float:
    return (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])


def _area(points: list[Point]) -> float:
    twice = 0.0
    for i, current in enumerate(points):
        nxt = points[(i + 1) % len(points)]
        twice += current[0] * nxt[1] - nxt[0] * current[1]
    return abs(twice) / 2


def validate_corners(corners: Corners, width: float, height: float) -> list[CalibrationIssue]:
    """Ordering (clockwise on screen), bounds, distinctness, convexity and minimum area."""
    if not (math.isfinite(width) and math.isfinite(height) and width > 0 and height > 0):
        return [CalibrationIssue("INVALID_SOURCE_SIZE", ())]
    points = corners.as_list()
    non_finite = tuple(
        name
        for name, (x, y) in zip(CORNER_NAMES, points, strict=True)
        if not (math.isfinite(x) and math.isfinite(y))
    )
    if non_finite:
        return [CalibrationIssue("INVALID_POINT", non_finite)]

    issues: list[CalibrationIssue] = []
    outside = tuple(
        name
        for name, (x, y) in zip(CORNER_NAMES, points, strict=True)
        if x < 0 or y < 0 or x > width or y > height
    )
    if outside:
        issues.append(CalibrationIssue("OUT_OF_BOUNDS", outside))

    min_distance = math.hypot(width, height) * MIN_CORNER_DISTANCE_RATIO
    too_close: list[str] = []
    for i in range(4):
        for j in range(i + 1, 4):
            if math.dist(points[i], points[j]) < min_distance:
                for name in (CORNER_NAMES[i], CORNER_NAMES[j]):
                    if name not in too_close:
                        too_close.append(name)
    if too_close:
        issues.append(CalibrationIssue("CORNERS_TOO_CLOSE", tuple(too_close)))

    turns = [_turn(points[(i + 3) % 4], points[i], points[(i + 1) % 4]) for i in range(4)]
    if all(t < 0 for t in turns):
        issues.append(CalibrationIssue("WRONG_ORDER", CORNER_NAMES))
    elif not all(t > 0 for t in turns):
        offending = tuple(name for name, t in zip(CORNER_NAMES, turns, strict=True) if not t > 0)
        issues.append(CalibrationIssue("NOT_CONVEX", offending))

    if _area(points) < width * height * MIN_AREA_RATIO:
        issues.append(CalibrationIssue("AREA_TOO_SMALL", ()))
    return issues


def away_from_camera(corners: Corners, min_obliquity: float) -> Point | None:
    """Unit vector pointing away from the camera on the rectified board, or None when the
    board is seen (nearly) from above (`top-face.ts` `awayFromCamera`)."""
    tl, tr, br, bl = corners.as_list()
    top = math.dist(tl, tr)
    bottom = math.dist(bl, br)
    left = math.dist(tl, bl)
    right = math.dist(tr, br)
    x = (left - right) / (left + right) if left + right > 0 else 0.0
    y = (top - bottom) / (top + bottom) if top + bottom > 0 else 0.0
    magnitude = math.hypot(x, y)
    return None if magnitude < min_obliquity else (x / magnitude, y / magnitude)
