"""Sessions: one per app vision client (`INIT` … `DISPOSE`).

A session holds the classifier configuration and the active calibration; frames are
stateless otherwise (temporal stabilization stays in the app, ADR-042). One frame per
session is processed at a time: a second concurrent request is refused as `BUSY`, which
the app treats as a dropped frame, so nothing ever queues.
"""

from __future__ import annotations

import threading
import time
import uuid
from dataclasses import dataclass, field

import numpy as np

from .errors import ServiceError
from .recognition.config import ClassifierConfig


@dataclass
class ActiveCalibration:
    transform: np.ndarray
    #: Normalized board size (width, height).
    size: tuple[int, int]
    #: Source frame size the corners refer to (width, height).
    source_size: tuple[int, int]
    away_from_camera: tuple[float, float] | None


@dataclass
class Session:
    id: str
    classifier: ClassifierConfig
    calibration: ActiveCalibration | None = None
    last_used: float = field(default_factory=time.monotonic)
    lock: threading.Lock = field(default_factory=threading.Lock)

    def touch(self) -> None:
        self.last_used = time.monotonic()


class SessionRegistry:
    def __init__(self, max_sessions: int, ttl_seconds: float) -> None:
        self._sessions: dict[str, Session] = {}
        self._guard = threading.Lock()
        self._max = max_sessions
        self._ttl = ttl_seconds

    def create(self, classifier: ClassifierConfig) -> Session:
        with self._guard:
            self._expire()
            if len(self._sessions) >= self._max:
                self._evict_least_recently_used()
            session = Session(uuid.uuid4().hex, classifier)
            self._sessions[session.id] = session
            return session

    def get(self, session_id: str) -> Session:
        with self._guard:
            self._expire()
            session = self._sessions.get(session_id)
        if session is None:
            raise ServiceError("NOT_INITIALIZED", "unknown or expired session; create a new one")
        session.touch()
        return session

    def delete(self, session_id: str) -> None:
        with self._guard:
            self._sessions.pop(session_id, None)

    def __len__(self) -> int:
        return len(self._sessions)

    def _evict_least_recently_used(self) -> None:
        """A browser tab that closes terminates its worker before the DELETE can leave, so
        sessions are not always closed. At the limit, the idle session unused for longest
        makes room; its client, if still alive, gets NOT_INITIALIZED and recreates one."""
        idle = [s for s in self._sessions.values() if not s.lock.locked()]
        if not idle:
            raise ServiceError("SESSION_LIMIT", f"all {self._max} sessions are processing a frame")
        oldest = min(idle, key=lambda s: s.last_used)
        del self._sessions[oldest.id]

    def _expire(self) -> None:
        now = time.monotonic()
        for key, session in list(self._sessions.items()):
            if now - session.last_used > self._ttl and not session.lock.locked():
                del self._sessions[key]
