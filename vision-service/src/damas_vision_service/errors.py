"""Service errors. Codes are the app protocol's `VisionWorkerErrorCode`s plus transport codes."""

from __future__ import annotations

from typing import Literal

ErrorCode = Literal[
    # Protocol codes (src/app/core/workers/vision-worker.protocol.ts)
    "INVALID_REQUEST",
    "INIT_FAILED",
    "NOT_INITIALIZED",
    "NOT_CALIBRATED",
    "CALIBRATION_FAILED",
    "RECTIFY_FAILED",
    "RECOGNITION_FAILED",
    "REFINE_FAILED",
    # Transport codes (service only)
    "BUSY",
    "PAYLOAD_TOO_LARGE",
    "UNSUPPORTED_MEDIA",
    "TIMEOUT",
    "SESSION_LIMIT",
]

STATUS_BY_CODE: dict[str, int] = {
    "INVALID_REQUEST": 422,
    "INIT_FAILED": 500,
    "NOT_INITIALIZED": 404,
    "NOT_CALIBRATED": 409,
    "CALIBRATION_FAILED": 500,
    "RECTIFY_FAILED": 500,
    "RECOGNITION_FAILED": 500,
    "REFINE_FAILED": 500,
    "BUSY": 409,
    "PAYLOAD_TOO_LARGE": 413,
    "UNSUPPORTED_MEDIA": 415,
    "TIMEOUT": 504,
    "SESSION_LIMIT": 503,
}


class ServiceError(Exception):
    """An error reported to the client as `{code, message}` with the code's HTTP status."""

    def __init__(self, code: ErrorCode, message: str) -> None:
        super().__init__(message)
        self.code: ErrorCode = code
        self.message = message

    @property
    def status(self) -> int:
        return STATUS_BY_CODE[self.code]
