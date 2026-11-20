"""Classifier configuration received from the app (`VisionConfig`, spec §14).

The thresholds' values live in the app (`classifier.config.ts`), which sends the complete
set at session creation. The service only knows their names and validates them with the
same rules as `resolveClassifierConfig`; it requires every key, so a missing or unknown key
is an error rather than a silent default.
"""

from __future__ import annotations

import math
from collections.abc import Mapping
from dataclasses import dataclass, fields

from ..errors import ServiceError


@dataclass(frozen=True)
class ColorThresholds:
    pixelForegroundDistance: float  # noqa: N815 — names mirror the TypeScript contract
    shadowMinRatio: float  # noqa: N815
    glareMaxRatio: float  # noqa: N815
    shadowChromaTolerance: float  # noqa: N815
    chromaMinLuminance: float  # noqa: N815
    whiteMinContrastRatio: float  # noqa: N815
    blackMaxContrastRatio: float  # noqa: N815
    contrastSoftness: float  # noqa: N815
    kingMarkMinChroma: float  # noqa: N815
    kingMarkMinLuminance: float  # noqa: N815
    kingMarkBlendTolerance: float  # noqa: N815
    kingMarkMinCoverage: float  # noqa: N815
    kingMarkCoverageSoftness: float  # noqa: N815
    darkSquareMinRelativeLuminance: float  # noqa: N815
    backgroundChromaTolerance: float  # noqa: N815
    backgroundRatioTolerance: float  # noqa: N815
    pieceChromaTolerance: float  # noqa: N815
    lightSquareChromaTolerance: float  # noqa: N815
    underexposedMaxLuminance: float  # noqa: N815
    overexposedMinLuminance: float  # noqa: N815


@dataclass(frozen=True)
class ShapeThresholds:
    presenceMinRatio: float  # noqa: N815
    emptyMaxRatio: float  # noqa: N815
    pieceRadiusRatio: float  # noqa: N815
    backgroundMinRadiusRatio: float  # noqa: N815
    kingMarkRadiusRatio: float  # noqa: N815
    occupancyRingMinRatio: float  # noqa: N815
    topFaceMaxShiftRatio: float  # noqa: N815
    markSearchRadiusRatio: float  # noqa: N815
    minViewObliquity: float  # noqa: N815
    edgeMarginRatio: float  # noqa: N815
    minSharpness: float  # noqa: N815
    denoiseKernelSize: float  # noqa: N815
    minAlignmentQuality: float  # noqa: N815


@dataclass(frozen=True)
class ConfidenceBands:
    high: float
    acceptable: float
    uncertain: float


@dataclass(frozen=True)
class ClassifierConfig:
    color: ColorThresholds
    shape: ShapeThresholds
    roi_inset_ratio: float
    confidence: ConfidenceBands
    normalized_width: int
    normalized_height: int


def _section(cls: type, values: Mapping[str, object], name: str) -> object:
    expected = {f.name for f in fields(cls)}
    unknown = sorted(set(values) - expected)
    missing = sorted(expected - set(values))
    if unknown:
        raise ServiceError("INVALID_REQUEST", f"unknown {name} key(s): {', '.join(unknown)}")
    if missing:
        raise ServiceError("INVALID_REQUEST", f"missing {name} key(s): {', '.join(missing)}")
    parsed: dict[str, float] = {}
    for key in expected:
        value = values[key]
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
            raise ServiceError("INVALID_REQUEST", f"{name}.{key} must be a finite number")
        parsed[key] = float(value)
    return cls(**parsed)


def resolve_classifier_config(
    *,
    color_thresholds: Mapping[str, object],
    shape_thresholds: Mapping[str, object],
    roi_inset_ratio: float,
    confidence: ConfidenceBands,
    normalized_width: int,
    normalized_height: int,
) -> ClassifierConfig:
    color = _section(ColorThresholds, color_thresholds, "colorThresholds")
    shape = _section(ShapeThresholds, shape_thresholds, "shapeThresholds")
    assert isinstance(color, ColorThresholds) and isinstance(shape, ShapeThresholds)

    def fail(message: str) -> None:
        raise ServiceError("INVALID_REQUEST", message)

    unit = [
        "pixelForegroundDistance", "shadowMinRatio", "shadowChromaTolerance",
        "chromaMinLuminance", "darkSquareMinRelativeLuminance", "kingMarkMinLuminance",
        "backgroundChromaTolerance", "lightSquareChromaTolerance", "pieceChromaTolerance",
    ]  # fmt: skip
    shape_unit = [
        "presenceMinRatio", "emptyMaxRatio", "pieceRadiusRatio", "backgroundMinRadiusRatio",
        "kingMarkRadiusRatio", "edgeMarginRatio", "minAlignmentQuality",
        "occupancyRingMinRatio", "topFaceMaxShiftRatio", "markSearchRadiusRatio",
        "minViewObliquity",
    ]  # fmt: skip
    for key in unit:
        value = getattr(color, key)
        if not 0 < value < 1:
            fail(f"{key} must be in (0, 1), got {value}")
    for key in shape_unit:
        value = getattr(shape, key)
        if not 0 < value < 1:
            fail(f"{key} must be in (0, 1), got {value}")
    for key, value in [
        ("contrastSoftness", color.contrastSoftness),
        ("kingMarkMinChroma", color.kingMarkMinChroma),
        ("kingMarkBlendTolerance", color.kingMarkBlendTolerance),
        ("kingMarkMinCoverage", color.kingMarkMinCoverage),
        ("kingMarkCoverageSoftness", color.kingMarkCoverageSoftness),
        ("backgroundRatioTolerance", color.backgroundRatioTolerance),
        ("minSharpness", shape.minSharpness),
    ]:
        if not value > 0:
            fail(f"{key} must be positive, got {value}")
    if not color.glareMaxRatio > 1:
        fail("glareMaxRatio must be greater than 1")
    kernel = shape.denoiseKernelSize
    if not (kernel.is_integer() and kernel >= 1 and int(kernel) % 2 == 1):
        fail("denoiseKernelSize must be an odd integer >= 1")
    if shape.emptyMaxRatio >= shape.presenceMinRatio:
        fail("emptyMaxRatio must be lower than presenceMinRatio")
    if not (0 < color.blackMaxContrastRatio < 1 < color.whiteMinContrastRatio):
        fail("expected 0 < blackMaxContrastRatio < 1 < whiteMinContrastRatio")
    if (
        shape.kingMarkRadiusRatio >= shape.pieceRadiusRatio
        or shape.pieceRadiusRatio >= shape.backgroundMinRadiusRatio
        or shape.backgroundMinRadiusRatio >= math.sqrt(0.5) - shape.edgeMarginRatio
    ):
        fail("expected kingMarkRadiusRatio < pieceRadiusRatio < backgroundMinRadiusRatio < corner reach")
    if not (0 < confidence.uncertain <= confidence.acceptable <= confidence.high <= 1):
        fail("confidence thresholds must satisfy 0 < uncertain <= acceptable <= high <= 1")
    if not 0 <= roi_inset_ratio < 0.5:
        fail("roiInsetRatio must be in [0, 0.5)")
    return ClassifierConfig(
        color, shape, roi_inset_ratio, confidence, normalized_width, normalized_height
    )
