"""Protocol operations on a session (the service side of `vision-worker.handler.ts`).

Each function is synchronous (it runs in a worker thread) and maps failures to the
protocol's error codes. No function keeps images after returning.
"""

from __future__ import annotations

import time
from typing import Any

import numpy as np

from .errors import ServiceError
from .geometry.calibration import Corners, away_from_camera, validate_corners
from .geometry.perspective import perspective_transform, warp
from .geometry.refine import refine_corners, to_gray
from .imaging import encode_jpeg, encode_png_gray, to_base64
from .recognition.quality import denoise, measure_frame_quality
from .recognition.recognize import recognize_board
from .sessions import ActiveCalibration, Session


def calibrate(session: Session, corners: Corners, width: float, height: float) -> dict[str, Any]:
    config = session.classifier
    size = (config.normalized_width, config.normalized_height)
    issues = validate_corners(corners, width, height)
    if issues:
        session.calibration = None
        return {
            "valid": False,
            "issues": [issue.to_json() for issue in issues],
            "normalizedWidth": size[0],
            "normalizedHeight": size[1],
        }
    try:
        transform = perspective_transform(corners, *size)
    except Exception as error:  # OpenCV failure: report, never keep a broken calibration
        session.calibration = None
        raise ServiceError("CALIBRATION_FAILED", f"perspective transform failed: {error}") from error
    session.calibration = ActiveCalibration(
        transform=transform,
        size=size,
        source_size=(round(width), round(height)),
        away_from_camera=away_from_camera(corners, config.shape.minViewObliquity),
    )
    return {
        "valid": True,
        "issues": [],
        "transform": [float(v) for v in transform.reshape(-1)],
        "normalizedWidth": size[0],
        "normalizedHeight": size[1],
    }


def _rectified(session: Session, image: np.ndarray) -> np.ndarray:
    calibration = session.calibration
    if calibration is None:
        raise ServiceError("NOT_CALIBRATED", "calibrate before sending frames")
    height, width = image.shape[:2]
    if (width, height) != calibration.source_size:
        # A frame of another size would be warped with corners that do not belong to it.
        raise ServiceError(
            "NOT_CALIBRATED",
            f"frame is {width}x{height} but the calibration is for "
            f"{calibration.source_size[0]}x{calibration.source_size[1]}; calibrate again",
        )
    return warp(image, calibration.transform, *calibration.size)


def rectify(session: Session, image: np.ndarray, jpeg_quality: int) -> bytes:
    rectified = _rectified(session, image)
    try:
        return encode_jpeg(rectified, jpeg_quality)
    except ServiceError as error:
        raise ServiceError("RECTIFY_FAILED", error.message) from error


def process(
    session: Session,
    image: np.ndarray,
    frame_id: str,
    *,
    debug: bool,
    jpeg_quality: int,
    decode_ms: float,
    request_bytes: int = 0,
) -> dict[str, Any]:
    started = time.perf_counter()
    rectified = _rectified(session, image)
    warped = time.perf_counter()
    try:
        config = session.classifier
        # Sharpness is measured on the raw rectified image, before smoothing.
        quality = measure_frame_quality(rectified)
        smoothed = denoise(rectified, int(config.shape.denoiseKernelSize))
        mask = np.zeros(smoothed.shape[:2], dtype=np.uint8) if debug else None
        recognition = recognize_board(
            smoothed,
            config,
            timestamp=time.time() * 1000,
            frame_id=frame_id,
            quality=quality,
            away_from_camera=session.calibration.away_from_camera if session.calibration else None,
            mask=mask,
        )
    except ServiceError:
        raise
    except Exception as error:
        raise ServiceError("RECOGNITION_FAILED", f"recognition failed: {error}") from error
    recognized = time.perf_counter()
    response: dict[str, Any] = {
        "frameId": frame_id,
        "result": recognition.result,
        "traces": recognition.traces,
        "frame": recognition.frame,
    }
    if debug:
        assert mask is not None
        response["debugImage"] = to_base64(encode_jpeg(smoothed, jpeg_quality))
        response["foregroundMask"] = to_base64(encode_png_gray(mask))
    finished = time.perf_counter()
    response["timings"] = {
        "decodeMs": round(decode_ms, 2),
        "warpMs": round((warped - started) * 1000, 2),
        "recognizeMs": round((recognized - warped) * 1000, 2),
        "totalMs": round(decode_ms + (finished - started) * 1000, 2),
        "requestBytes": request_bytes,
    }
    return response


def refine(session: Session, corners: Corners, image: np.ndarray) -> dict[str, Any]:
    # Like the browser worker, the starting corners are not required to be valid (the user
    # may still be placing them); every candidate the search keeps is validated.
    del session  # the refinement needs no calibration, only the session's existence
    try:
        result = refine_corners(to_gray(image), corners)
    except Exception as error:
        raise ServiceError("REFINE_FAILED", f"calibration refinement failed: {error}") from error
    return {
        "corners": result.corners.to_json(),
        "scoreBefore": result.score_before,
        "scoreAfter": result.score_after,
        "maxShiftPx": result.max_shift_px,
    }
