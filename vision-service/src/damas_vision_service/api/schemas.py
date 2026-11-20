"""Contract v1 between the service and the Angular app (OpenAPI source).

Field names are the TypeScript names (camelCase) on purpose: these models describe the
app's own types — `VisionConfig`, `CalibrationCorners`, `CalibrationResult`,
`BoardRecognitionResult`, `SquareTrace`, `FrameAssessment` — and the contract tests check
both sides against the same JSON fixtures. Unknown fields are rejected.
"""
# ruff: noqa: N815

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid")


# --------------------------------------------------------------------------- requests


class ConfidenceThresholds(Contract):
    high: float = Field(gt=0, le=1)
    acceptable: float = Field(gt=0, le=1)
    uncertain: float = Field(gt=0, le=1)


class ClassifierThresholds(Contract):
    colorThresholds: dict[str, float]
    shapeThresholds: dict[str, float]


class VisionConfig(Contract):
    """`src/app/vision/vision.config.ts` `VisionConfig` (spec §14)."""

    normalizedBoardWidth: int = Field(ge=80, le=2000)
    normalizedBoardHeight: int = Field(ge=80, le=2000)
    analysisIntervalMs: float = Field(gt=0)
    stabilityWindowSize: int = Field(gt=0)
    stableObservationCount: int = Field(gt=0)
    confidenceThresholds: ConfidenceThresholds
    roiInsetRatio: float = Field(ge=0, lt=0.5)
    classifier: ClassifierThresholds


class CreateSessionRequest(Contract):
    config: VisionConfig


class Point(Contract):
    x: float = Field(allow_inf_nan=False)
    y: float = Field(allow_inf_nan=False)


class CalibrationCorners(Contract):
    """Canonical corners (orientation applied), in source pixels."""

    topLeft: Point
    topRight: Point
    bottomRight: Point
    bottomLeft: Point


class CalibrateRequest(Contract):
    corners: CalibrationCorners
    width: float = Field(gt=0, le=10000)
    height: float = Field(gt=0, le=10000)


class RefineRequest(Contract):
    corners: CalibrationCorners
    #: Camera frame, base64 PNG or JPEG (optionally a data: URL).
    image: str = Field(min_length=16)


# -------------------------------------------------------------------------- responses


class HealthResponse(Contract):
    status: Literal["ok"]
    serviceVersion: str
    contractVersion: int
    opencvVersion: str


class CreateSessionResponse(Contract):
    sessionId: str
    contractVersion: int


class ErrorResponse(Contract):
    code: str
    message: str


class CalibrationIssue(Contract):
    code: Literal[
        "INVALID_SOURCE_SIZE",
        "INVALID_POINT",
        "OUT_OF_BOUNDS",
        "CORNERS_TOO_CLOSE",
        "WRONG_ORDER",
        "NOT_CONVEX",
        "AREA_TOO_SMALL",
    ]
    corners: list[Literal["topLeft", "topRight", "bottomRight", "bottomLeft"]]


class CalibrationResult(Contract):
    valid: bool
    issues: list[CalibrationIssue]
    #: Image → normalized board transform, row-major 3×3; present when valid.
    transform: list[float] | None = Field(default=None, min_length=9, max_length=9)
    normalizedWidth: int
    normalizedHeight: int


class RefineResponse(Contract):
    corners: CalibrationCorners
    scoreBefore: float
    scoreAfter: float
    maxShiftPx: float


ObservedPiece = Literal["EMPTY", "WHITE", "BLACK", "WHITE_KING", "BLACK_KING", "UNKNOWN"]


class BoardObservation(Contract):
    cells: list[ObservedPiece] = Field(min_length=64, max_length=64)
    confidenceBySquare: list[float] = Field(min_length=64, max_length=64)
    timestamp: float
    sourceFrameId: str | None = None


class SquareRecognition(Contract):
    squareIndex: int = Field(ge=0, lt=64)
    piece: ObservedPiece
    confidence: float = Field(ge=0, le=1)


class RecognitionWarning(Contract):
    code: str
    message: str
    affectedSquares: list[int] | None = None


class BoardRecognitionResult(Contract):
    board: BoardObservation
    squares: list[SquareRecognition] = Field(min_length=32, max_length=32)
    status: Literal["SUCCESS", "UNCERTAIN", "ERROR"]
    overallConfidence: float = Field(ge=0, le=1)
    warnings: list[RecognitionWarning]
    timestamp: float


class StageOutcome(Contract):
    decision: str
    confidence: float
    reason: str


class MarkSearchRegion(Contract):
    endX: float
    endY: float
    radius: float


class TraceRegions(Contract):
    centerX: float
    centerY: float
    size: float
    pieceRadius: float
    markRadius: float
    backgroundRadius: float
    markSearch: MarkSearchRegion


class TraceRoi(Contract):
    cornerMatches: list[bool] = Field(min_length=4, max_length=4)
    visibleCorners: int = Field(ge=0, le=4)
    quality: float


class Offset(Contract):
    x: float
    y: float


class TraceFeatures(Contract):
    foregroundRatio: float
    shadowRatio: float
    ringForegroundRatio: float
    backgroundLuminance: float
    backgroundRelative: float
    lightReference: float
    pieceLuminance: float
    pieceLuminanceStd: float
    bodyLuminance: float
    markLuminance: float
    contrastRatio: float
    markCoverage: float
    markOffset: Offset | None
    backgroundColor: list[int]
    bodyColor: list[int]


class SquareTrace(Contract):
    squareIndex: int
    piece: ObservedPiece
    confidence: float
    decision: Literal["ACCEPT", "WARN", "RETRY"]
    reason: str
    limitingStage: Literal["OCCUPANCY", "COLOR", "PIECE_TYPE"]
    explanation: str
    regions: TraceRegions
    roi: TraceRoi
    occupancy: StageOutcome
    color: StageOutcome | None
    pieceType: StageOutcome | None
    features: TraceFeatures


class FrameAssessment(Contract):
    sharpness: float | None
    meanLuminance: float | None
    alignmentQuality: float
    issues: list[Literal["LOW_SHARPNESS", "UNDEREXPOSED", "OVEREXPOSED", "CALIBRATION_MISALIGNED"]]


class Timings(Contract):
    decodeMs: float
    warpMs: float
    recognizeMs: float
    totalMs: float
    #: Size of the frame received (JPEG/PNG bytes).
    requestBytes: int


class RecognitionResponse(Contract):
    frameId: str
    result: BoardRecognitionResult
    traces: list[SquareTrace] = Field(min_length=32, max_length=32)
    frame: FrameAssessment
    timings: Timings
    #: Debug only: rectified, smoothed board (base64 JPEG).
    debugImage: str | None = None
    #: Debug only: per-pixel foreground (255) and shadow/glare (128) mask (base64 PNG).
    foregroundMask: str | None = None
