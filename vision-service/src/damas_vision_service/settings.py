"""Service limits and transport settings (centralized; overridable by environment variables).

Recognition thresholds are *not* here: the app sends them at session creation
(`VisionConfig.classifier`), so `classifier.config.ts` stays their single source.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field

DEFAULT_ORIGINS = (
    "http://localhost:4200",  # ng serve
    "http://localhost:4300",  # Playwright E2E
    "http://localhost:4400",  # scripts/serve-dist.mjs
    "http://127.0.0.1:4200",
    "http://127.0.0.1:4300",
    "http://127.0.0.1:4400",
)


@dataclass(frozen=True)
class ServiceSettings:
    #: Loopback only: the service must never listen on the network.
    host: str = "127.0.0.1"
    port: int = 8765
    allowed_origins: tuple[str, ...] = DEFAULT_ORIGINS
    #: Largest request body accepted (frames, refine payloads).
    max_body_bytes: int = 8 * 1024 * 1024
    #: Accepted image sides, in pixels.
    min_image_side: int = 320
    max_image_side: int = 4096
    max_sessions: int = 4
    session_ttl_seconds: float = 600.0
    #: Images processed at the same time, all sessions together.
    worker_threads: int = 2
    frame_timeout_seconds: float = 2.0
    refine_timeout_seconds: float = 10.0
    #: JPEG quality of returned images (rectified frame, debug image), 0..100.
    output_jpeg_quality: int = 90
    log_level: str = "INFO"
    extra_origins: tuple[str, ...] = field(default=())

    @property
    def origins(self) -> list[str]:
        return [*self.allowed_origins, *self.extra_origins]


def _int(name: str, default: int) -> int:
    value = os.environ.get(name)
    return int(value) if value else default


def _float(name: str, default: float) -> float:
    value = os.environ.get(name)
    return float(value) if value else default


def load_settings() -> ServiceSettings:
    """Reads `DAMAS_VISION_*` overrides. The host is fixed to the loopback interface."""
    base = ServiceSettings()
    extra = os.environ.get("DAMAS_VISION_ORIGINS", "")
    return ServiceSettings(
        port=_int("DAMAS_VISION_PORT", base.port),
        max_body_bytes=_int("DAMAS_VISION_MAX_BODY_BYTES", base.max_body_bytes),
        max_sessions=_int("DAMAS_VISION_MAX_SESSIONS", base.max_sessions),
        session_ttl_seconds=_float("DAMAS_VISION_SESSION_TTL", base.session_ttl_seconds),
        worker_threads=_int("DAMAS_VISION_WORKER_THREADS", base.worker_threads),
        frame_timeout_seconds=_float("DAMAS_VISION_FRAME_TIMEOUT", base.frame_timeout_seconds),
        refine_timeout_seconds=_float("DAMAS_VISION_REFINE_TIMEOUT", base.refine_timeout_seconds),
        log_level=os.environ.get("DAMAS_VISION_LOG_LEVEL", base.log_level),
        extra_origins=tuple(o.strip() for o in extra.split(",") if o.strip()),
    )
