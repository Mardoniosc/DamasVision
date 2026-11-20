"""FastAPI application: the vision-worker protocol over HTTP (contract v1).

| Endpoint                                  | Protocol             |
| ----------------------------------------- | -------------------- |
| GET    /v1/health                         | (before INIT)        |
| POST   /v1/sessions                       | INIT                 |
| DELETE /v1/sessions/{id}                  | DISPOSE              |
| PUT    /v1/sessions/{id}/calibration      | CALIBRATE            |
| DELETE /v1/sessions/{id}/calibration      | RESET                |
| POST   /v1/sessions/{id}/calibration/refine | REFINE_CALIBRATION |
| POST   /v1/sessions/{id}/rectify          | RECTIFY_FRAME        |
| POST   /v1/sessions/{id}/frames           | PROCESS_FRAME        |

Image processing runs in worker threads (at most `worker_threads` at once), under a
per-request timeout. Responses are validated against the contract models before leaving.
"""

from __future__ import annotations

import logging
import threading
import time
from collections.abc import Callable
from typing import Any, TypeVar

import anyio
import cv2
from fastapi import FastAPI, Header, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel

from .. import CONTRACT_VERSION, SERVICE_VERSION, pipeline
from ..errors import ServiceError
from ..geometry.calibration import Corners
from ..imaging import decode_base64_image, decode_image
from ..recognition.config import ConfidenceBands, resolve_classifier_config
from ..sessions import Session, SessionRegistry
from ..settings import ServiceSettings, load_settings
from . import schemas

logger = logging.getLogger("damas_vision_service")

T = TypeVar("T")

ERROR_RESPONSES: dict[int | str, dict[str, Any]] = {
    status: {"model": schemas.ErrorResponse} for status in (404, 409, 413, 415, 422, 500, 503, 504)
}

FRAME_BODY = {
    "requestBody": {
        "required": True,
        "content": {
            "image/jpeg": {"schema": {"type": "string", "format": "binary"}},
            "image/png": {"schema": {"type": "string", "format": "binary"}},
        },
    }
}


def _corners(model: schemas.CalibrationCorners) -> Corners:
    return Corners(
        (model.topLeft.x, model.topLeft.y),
        (model.topRight.x, model.topRight.y),
        (model.bottomRight.x, model.bottomRight.y),
        (model.bottomLeft.x, model.bottomLeft.y),
    )


def _validated(model: type[BaseModel], payload: dict[str, Any]) -> JSONResponse:
    """Checks an outgoing payload against the contract, then sends it as built."""
    try:
        model.model_validate(payload)
    except Exception as error:  # a contract bug must never reach the app silently
        logger.exception("response violates the contract")
        raise ServiceError("RECOGNITION_FAILED", "internal contract error") from error
    return JSONResponse(payload)


def create_app(settings: ServiceSettings | None = None) -> FastAPI:
    settings = settings or load_settings()
    registry = SessionRegistry(settings.max_sessions, settings.session_ttl_seconds)
    compute = threading.BoundedSemaphore(settings.worker_threads)

    app = FastAPI(
        title="Damas Vision — local vision service",
        version=SERVICE_VERSION,
        summary="Optional local recognizer (ADR-042). Observes the board; never decides moves.",
        # Swagger/ReDoc pages load assets from a CDN; the service uses no external service.
        docs_url=None,
        redoc_url=None,
    )
    app.state.registry = registry
    app.state.settings = settings
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.origins,
        allow_methods=["GET", "POST", "PUT", "DELETE"],
        allow_headers=["Content-Type", "X-Frame-Id"],
        max_age=600,
    )

    @app.middleware("http")
    async def log_and_allow_private_network(request: Request, call_next):  # type: ignore[no-untyped-def]
        started = time.perf_counter()
        response = await call_next(request)
        if (
            request.headers.get("access-control-request-private-network") == "true"
            and request.headers.get("origin") in settings.origins
        ):
            # Chromium Private Network Access preflight (an HTTPS page calling 127.0.0.1).
            response.headers["Access-Control-Allow-Private-Network"] = "true"
        logger.info(
            "%s %s %d %.1fms",
            request.method,
            request.url.path,
            response.status_code,
            (time.perf_counter() - started) * 1000,
        )
        return response

    @app.exception_handler(ServiceError)
    async def service_error(_: Request, error: ServiceError) -> JSONResponse:
        if error.status >= 500:
            logger.warning("%s: %s", error.code, error.message)
        return JSONResponse({"code": error.code, "message": error.message}, status_code=error.status)

    @app.exception_handler(RequestValidationError)
    async def validation_error(_: Request, error: RequestValidationError) -> JSONResponse:
        first = error.errors()[0] if error.errors() else {}
        where = ".".join(str(p) for p in first.get("loc", ()))
        message = f"{where}: {first.get('msg', 'invalid request')}" if where else "invalid request"
        return JSONResponse({"code": "INVALID_REQUEST", "message": message}, status_code=422)

    async def run(fn: Callable[[], T], timeout: float, session: Session | None = None) -> T:
        """Runs `fn` in a worker thread under the compute limit and a timeout. With a
        session, the session's lock is taken first (a busy session refuses with BUSY)."""
        if session is not None and not session.lock.acquire(blocking=False):
            raise ServiceError("BUSY", "the session is processing another request; frame dropped")

        def work() -> T:
            try:
                with compute:
                    return fn()
            finally:
                if session is not None:
                    session.lock.release()

        try:
            with anyio.fail_after(timeout):
                return await anyio.to_thread.run_sync(work, abandon_on_cancel=True)
        except TimeoutError as error:
            # The thread finishes on its own and releases the session lock; meanwhile the
            # session answers BUSY, so no request queues behind a slow one.
            raise ServiceError("TIMEOUT", f"processing took longer than {timeout:.1f}s") from error

    async def read_body(request: Request) -> bytes:
        declared = request.headers.get("content-length")
        if declared and declared.isdigit() and int(declared) > settings.max_body_bytes:
            raise ServiceError("PAYLOAD_TOO_LARGE", f"body larger than {settings.max_body_bytes} bytes")
        chunks: list[bytes] = []
        size = 0
        async for chunk in request.stream():
            size += len(chunk)
            if size > settings.max_body_bytes:
                raise ServiceError("PAYLOAD_TOO_LARGE", f"body larger than {settings.max_body_bytes} bytes")
            chunks.append(chunk)
        if size == 0:
            raise ServiceError("INVALID_REQUEST", "empty body: send a JPEG or PNG image")
        return b"".join(chunks)

    # ------------------------------------------------------------------ endpoints

    @app.get("/v1/health", response_model=schemas.HealthResponse, tags=["service"])
    async def health() -> dict[str, Any]:
        return {
            "status": "ok",
            "serviceVersion": SERVICE_VERSION,
            "contractVersion": CONTRACT_VERSION,
            "opencvVersion": cv2.__version__,
        }

    @app.post(
        "/v1/sessions",
        status_code=201,
        response_model=schemas.CreateSessionResponse,
        responses=ERROR_RESPONSES,
        tags=["sessions"],
    )
    async def create_session(body: schemas.CreateSessionRequest) -> dict[str, Any]:
        config = body.config
        bands = config.confidenceThresholds
        classifier = resolve_classifier_config(
            color_thresholds=config.classifier.colorThresholds,
            shape_thresholds=config.classifier.shapeThresholds,
            roi_inset_ratio=config.roiInsetRatio,
            confidence=ConfidenceBands(bands.high, bands.acceptable, bands.uncertain),
            normalized_width=config.normalizedBoardWidth,
            normalized_height=config.normalizedBoardHeight,
        )
        session = registry.create(classifier)
        return {"sessionId": session.id, "contractVersion": CONTRACT_VERSION}

    @app.delete("/v1/sessions/{session_id}", status_code=204, tags=["sessions"])
    async def delete_session(session_id: str) -> Response:
        registry.delete(session_id)
        return Response(status_code=204)

    @app.put(
        "/v1/sessions/{session_id}/calibration",
        response_model=schemas.CalibrationResult,
        responses=ERROR_RESPONSES,
        tags=["calibration"],
    )
    async def put_calibration(session_id: str, body: schemas.CalibrateRequest) -> JSONResponse:
        session = registry.get(session_id)
        corners = _corners(body.corners)
        result = await run(
            lambda: pipeline.calibrate(session, corners, body.width, body.height),
            settings.frame_timeout_seconds,
            session,
        )
        return _validated(schemas.CalibrationResult, result)

    @app.delete("/v1/sessions/{session_id}/calibration", status_code=204, tags=["calibration"])
    async def delete_calibration(session_id: str) -> Response:
        registry.get(session_id).calibration = None
        return Response(status_code=204)

    @app.post(
        "/v1/sessions/{session_id}/calibration/refine",
        response_model=schemas.RefineResponse,
        responses=ERROR_RESPONSES,
        tags=["calibration"],
    )
    async def refine_calibration(session_id: str, request: Request) -> JSONResponse:
        session = registry.get(session_id)
        try:
            body = schemas.RefineRequest.model_validate_json(await read_body(request))
        except ValueError as error:
            raise ServiceError("INVALID_REQUEST", f"invalid refine request: {error}") from error
        corners = _corners(body.corners)

        def work() -> dict[str, Any]:
            return pipeline.refine(session, corners, decode_base64_image(body.image, settings))

        result = await run(work, settings.refine_timeout_seconds, session)
        return _validated(schemas.RefineResponse, result)

    @app.post(
        "/v1/sessions/{session_id}/rectify",
        responses={**ERROR_RESPONSES, 200: {"content": {"image/jpeg": {}}}},
        response_class=Response,
        openapi_extra=FRAME_BODY,
        tags=["frames"],
    )
    async def rectify(session_id: str, request: Request) -> Response:
        session = registry.get(session_id)
        data = await read_body(request)
        content_type = request.headers.get("content-type")
        jpeg = await run(
            lambda: pipeline.rectify(
                session, decode_image(data, content_type, settings), settings.output_jpeg_quality
            ),
            settings.frame_timeout_seconds,
            session,
        )
        return Response(jpeg, media_type="image/jpeg")

    @app.post(
        "/v1/sessions/{session_id}/frames",
        response_model=schemas.RecognitionResponse,
        responses=ERROR_RESPONSES,
        openapi_extra=FRAME_BODY,
        tags=["frames"],
    )
    async def process_frame(
        session_id: str,
        request: Request,
        x_frame_id: str = Header(min_length=1, max_length=128),
        debug: bool = Query(default=False, description="Also return the rectified image and the foreground mask."),
    ) -> JSONResponse:
        session = registry.get(session_id)
        data = await read_body(request)
        content_type = request.headers.get("content-type")

        def work() -> dict[str, Any]:
            started = time.perf_counter()
            image = decode_image(data, content_type, settings)
            decode_ms = (time.perf_counter() - started) * 1000
            return pipeline.process(
                session,
                image,
                x_frame_id,
                debug=debug,
                jpeg_quality=settings.output_jpeg_quality,
                decode_ms=decode_ms,
                request_bytes=len(data),
            )

        result = await run(work, settings.frame_timeout_seconds, session)
        return _validated(schemas.RecognitionResponse, result)

    return app
