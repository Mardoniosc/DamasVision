"""HTTP API: contract, validation, limits, concurrency, errors, CORS."""

from __future__ import annotations

import base64
import json
from dataclasses import replace
from typing import Any

import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient

from damas_vision_service import CONTRACT_VERSION
from damas_vision_service.api.app import create_app
from damas_vision_service.settings import ServiceSettings

from .conftest import CONTRACT

SAMPLE = "blue-board-start-a"


def encode(image: np.ndarray, ext: str, *params: int) -> bytes:
    ok, buffer = cv2.imencode(ext, cv2.cvtColor(image, cv2.COLOR_RGB2BGR), list(params))
    assert ok
    return buffer.tobytes()


@pytest.fixture()
def client() -> TestClient:
    return TestClient(create_app(ServiceSettings()))


def new_session(client: TestClient, config: dict[str, Any]) -> str:
    response = client.post("/v1/sessions", json={"config": config})
    assert response.status_code == 201, response.text
    assert response.json()["contractVersion"] == CONTRACT_VERSION
    return response.json()["sessionId"]


def calibrated(client: TestClient, config: dict[str, Any], sample: dict[str, Any]) -> str:
    session = new_session(client, config)
    height, width = sample["image"].shape[:2]
    response = client.put(
        f"/v1/sessions/{session}/calibration",
        json={"corners": sample["corners"], "width": width, "height": height},
    )
    assert response.status_code == 200 and response.json()["valid"], response.text
    return session


def post_frame(client: TestClient, session: str, body: bytes, media: str = "image/png", **params: Any):  # type: ignore[no-untyped-def]
    return client.post(
        f"/v1/sessions/{session}/frames",
        content=body,
        headers={"Content-Type": media, "X-Frame-Id": "frame-1"},
        params=params,
    )


def test_health_and_openapi(client: TestClient) -> None:
    health = client.get("/v1/health").json()
    assert health["status"] == "ok" and health["contractVersion"] == CONTRACT_VERSION
    assert health["opencvVersion"].startswith("5.0")
    spec = client.get("/openapi.json").json()
    assert "/v1/sessions/{session_id}/frames" in spec["paths"]
    assert "image/jpeg" in spec["paths"]["/v1/sessions/{session_id}/frames"]["post"]["requestBody"]["content"]
    assert client.get("/docs").status_code == 404  # no CDN-backed documentation pages


def test_session_config_is_validated(client: TestClient, vision_config: dict[str, Any]) -> None:
    broken = json.loads(json.dumps(vision_config))
    broken["classifier"]["colorThresholds"]["glareMaxRatio"] = 0.5
    response = client.post("/v1/sessions", json={"config": broken})
    assert response.status_code == 422 and response.json()["code"] == "INVALID_REQUEST"
    extra = {**vision_config, "unexpected": 1}
    assert client.post("/v1/sessions", json={"config": extra}).status_code == 422
    assert client.post("/v1/sessions", content=b"not json").status_code == 422


def test_invalid_calibration_is_reported_not_used(client: TestClient, vision_config, samples) -> None:  # type: ignore[no-untyped-def]
    session = new_session(client, vision_config)
    corners = samples[SAMPLE]["corners"]
    swapped = {**corners, "topRight": corners["bottomLeft"], "bottomLeft": corners["topRight"]}
    response = client.put(
        f"/v1/sessions/{session}/calibration", json={"corners": swapped, "width": 1280, "height": 720}
    )
    body = response.json()
    assert response.status_code == 200 and body["valid"] is False and body["issues"]
    assert "transform" not in body
    frame = encode(samples[SAMPLE]["image"], ".png")
    refused = post_frame(client, session, frame)
    assert refused.status_code == 409 and refused.json()["code"] == "NOT_CALIBRATED"


def test_recognizes_a_real_sample(client: TestClient, vision_config, samples) -> None:  # type: ignore[no-untyped-def]
    sample = samples[SAMPLE]
    session = calibrated(client, vision_config, sample)
    response = post_frame(client, session, encode(sample["image"], ".png"))
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["result"]["board"]["cells"] == sample["labels"]
    assert len(body["traces"]) == 32 and body["frameId"] == "frame-1"
    assert body["timings"]["totalMs"] > 0
    assert body["timings"]["requestBytes"] > 100_000  # a 1280 × 720 PNG
    assert "debugImage" not in body and "foregroundMask" not in body
    # The app's protocol validators check this file (tests/integration/vision-service-contract.spec.ts).
    (CONTRACT / "service-response.json").write_text(json.dumps(body) + "\n", encoding="utf-8")


def test_debug_returns_the_rectified_image_and_the_mask(client: TestClient, vision_config, samples) -> None:  # type: ignore[no-untyped-def]
    session = calibrated(client, vision_config, samples[SAMPLE])
    body = post_frame(client, session, encode(samples[SAMPLE]["image"], ".png"), debug="true").json()
    image = cv2.imdecode(np.frombuffer(base64.b64decode(body["debugImage"]), np.uint8), cv2.IMREAD_COLOR)
    mask = cv2.imdecode(np.frombuffer(base64.b64decode(body["foregroundMask"]), np.uint8), cv2.IMREAD_GRAYSCALE)
    assert image.shape == (800, 800, 3)
    assert mask.shape == (800, 800) and set(np.unique(mask)) <= {0, 128, 255} and mask.max() == 255


def test_jpeg_frames_are_accepted(client: TestClient, vision_config, samples) -> None:  # type: ignore[no-untyped-def]
    sample = samples[SAMPLE]
    session = calibrated(client, vision_config, sample)
    response = post_frame(client, session, encode(sample["image"], ".jpg", cv2.IMWRITE_JPEG_QUALITY, 90), "image/jpeg")
    assert response.status_code == 200
    cells = response.json()["result"]["board"]["cells"]
    wrong = [i for i, (c, label) in enumerate(zip(cells, sample["labels"], strict=True)) if c not in ("UNKNOWN", label)]
    assert wrong == []  # never a confident error; JPEG accuracy is measured in Phase 8


def test_rectify_returns_a_jpeg_board(client: TestClient, vision_config, samples) -> None:  # type: ignore[no-untyped-def]
    session = calibrated(client, vision_config, samples[SAMPLE])
    response = client.post(
        f"/v1/sessions/{session}/rectify",
        content=encode(samples[SAMPLE]["image"], ".png"),
        headers={"Content-Type": "image/png"},
    )
    assert response.status_code == 200 and response.headers["content-type"] == "image/jpeg"
    board = cv2.imdecode(np.frombuffer(response.content, np.uint8), cv2.IMREAD_COLOR)
    assert board.shape == (800, 800, 3)


def test_refine_endpoint(client: TestClient, vision_config, samples) -> None:  # type: ignore[no-untyped-def]
    sample = samples[SAMPLE]
    session = new_session(client, vision_config)
    image = base64.b64encode(encode(sample["image"], ".png")).decode()
    response = client.post(
        f"/v1/sessions/{session}/calibration/refine", json={"corners": sample["corners"], "image": image}
    )
    assert response.status_code == 200, response.text
    body = response.json()
    expected = sample["browser"]["refinement"]
    assert body["scoreAfter"] >= body["scoreBefore"]
    for name, point in expected["corners"].items():
        assert abs(body["corners"][name]["x"] - point["x"]) <= 0.5
        assert abs(body["corners"][name]["y"] - point["y"]) <= 0.5


def test_frame_validation(client: TestClient, vision_config, samples) -> None:  # type: ignore[no-untyped-def]
    sample = samples[SAMPLE]
    session = calibrated(client, vision_config, sample)
    png = encode(sample["image"], ".png")
    assert post_frame(client, session, b"hello world", "text/plain").json()["code"] == "UNSUPPORTED_MEDIA"
    assert post_frame(client, session, png, "image/jpeg").status_code == 415  # declared ≠ actual
    assert post_frame(client, session, b"").json()["code"] == "INVALID_REQUEST"
    tiny = encode(np.zeros((100, 100, 3), np.uint8), ".png")
    assert post_frame(client, session, tiny).status_code == 422
    other_size = encode(cv2.resize(sample["image"], (960, 540)), ".png")
    mismatch = post_frame(client, session, other_size)
    assert mismatch.status_code == 409 and "calibrate again" in mismatch.json()["message"]
    missing_id = client.post(
        f"/v1/sessions/{session}/frames", content=png, headers={"Content-Type": "image/png"}
    )
    assert missing_id.status_code == 422


def test_body_limit(vision_config, samples) -> None:  # type: ignore[no-untyped-def]
    client = TestClient(create_app(replace(ServiceSettings(), max_body_bytes=1000)))
    session = calibrated(client, vision_config, samples[SAMPLE])
    response = post_frame(client, session, encode(samples[SAMPLE]["image"], ".png"))
    assert response.status_code == 413 and response.json()["code"] == "PAYLOAD_TOO_LARGE"


def test_sessions_lifecycle_and_limit(vision_config) -> None:  # type: ignore[no-untyped-def]
    client = TestClient(create_app(replace(ServiceSettings(), max_sessions=2)))
    registry = client.app.state.registry  # type: ignore[attr-defined]
    first = new_session(client, vision_config)
    second = new_session(client, vision_config)
    # At the limit the least recently used idle session makes room (closed tabs never DELETE).
    third = new_session(client, vision_config)
    unknown = client.delete(f"/v1/sessions/{first}/calibration")
    assert unknown.status_code == 404 and unknown.json()["code"] == "NOT_INITIALIZED"
    # When every session is busy, a new one is refused.
    held = [registry.get(second).lock, registry.get(third).lock]
    for lock in held:
        assert lock.acquire(blocking=False)
    try:
        full = client.post("/v1/sessions", json={"config": vision_config})
        assert full.status_code == 503 and full.json()["code"] == "SESSION_LIMIT"
    finally:
        for lock in held:
            lock.release()
    assert client.delete(f"/v1/sessions/{second}").status_code == 204
    assert len(registry) == 1


def test_reset_calibration(client: TestClient, vision_config, samples) -> None:  # type: ignore[no-untyped-def]
    session = calibrated(client, vision_config, samples[SAMPLE])
    assert client.delete(f"/v1/sessions/{session}/calibration").status_code == 204
    assert post_frame(client, session, encode(samples[SAMPLE]["image"], ".png")).status_code == 409


def test_a_busy_session_drops_the_frame(client: TestClient, vision_config, samples) -> None:  # type: ignore[no-untyped-def]
    session_id = calibrated(client, vision_config, samples[SAMPLE])
    session = client.app.state.registry.get(session_id)  # type: ignore[attr-defined]
    assert session.lock.acquire(blocking=False)
    try:
        response = post_frame(client, session_id, encode(samples[SAMPLE]["image"], ".png"))
        assert response.status_code == 409 and response.json()["code"] == "BUSY"
    finally:
        session.lock.release()


def test_timeout_then_busy_until_the_slow_frame_ends(vision_config, samples, monkeypatch) -> None:  # type: ignore[no-untyped-def]
    import threading

    from damas_vision_service import pipeline

    release = threading.Event()
    original = pipeline.process

    def slow(*args, **kwargs):  # type: ignore[no-untyped-def]
        release.wait(5)
        return original(*args, **kwargs)

    monkeypatch.setattr(pipeline, "process", slow)
    client = TestClient(create_app(replace(ServiceSettings(), frame_timeout_seconds=0.2)))
    session = calibrated(client, vision_config, samples[SAMPLE])
    frame = encode(samples[SAMPLE]["image"], ".png")
    timed_out = post_frame(client, session, frame)
    assert timed_out.status_code == 504 and timed_out.json()["code"] == "TIMEOUT"
    # The slow frame still runs: the next one is dropped, never queued behind it.
    assert post_frame(client, session, frame).json()["code"] == "BUSY"
    release.set()
    monkeypatch.setattr(pipeline, "process", original)
    registry = client.app.state.registry  # type: ignore[attr-defined]
    for _ in range(100):
        if not registry.get(session).lock.locked():
            break
        threading.Event().wait(0.05)
    assert post_frame(client, session, frame).status_code == 200


def test_cors(client: TestClient) -> None:
    allowed = client.options(
        "/v1/health",
        headers={
            "Origin": "http://localhost:4200",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Private-Network": "true",
        },
    )
    assert allowed.headers["access-control-allow-origin"] == "http://localhost:4200"
    assert allowed.headers["access-control-allow-private-network"] == "true"
    other = client.options(
        "/v1/health",
        headers={"Origin": "https://example.org", "Access-Control-Request-Method": "POST"},
    )
    assert "access-control-allow-origin" not in other.headers
