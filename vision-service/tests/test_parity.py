"""Parity with the browser recognizer on the real samples (G3.1 design §13).

`tests/fixtures/contract/browser-results/*.json` is what the browser worker (OpenCV.js)
answers for each sample; the Angular contract spec keeps it current. The service must take
the same decisions on every square and report the same features (within rounding).
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

import pytest

from damas_vision_service.geometry.calibration import Corners
from damas_vision_service.imaging import decode_base64_image
from damas_vision_service.recognition.recognize import recognize_board
from damas_vision_service.settings import ServiceSettings
from damas_vision_service.pipeline import calibrate, process, refine
from damas_vision_service.sessions import Session

from .conftest import SAMPLE_NAMES

#: Features are rounded to 0.001 on both sides; float noise can flip the last digit.
FEATURE_TOLERANCE = 0.0021
EXACT_TRACE_FIELDS = ("squareIndex", "piece", "decision", "reason", "limitingStage", "explanation")


def corners_of(value: dict[str, dict[str, float]]) -> Corners:
    return Corners(*[(value[n]["x"], value[n]["y"]) for n in ("topLeft", "topRight", "bottomRight", "bottomLeft")])


def run_service(classifier, image, corners) -> dict[str, Any]:  # type: ignore[no-untyped-def]
    session = Session("parity", classifier)
    height, width = image.shape[:2]
    calibration = calibrate(session, corners, width, height)
    assert calibration["valid"], calibration
    return process(session, image, "parity", debug=False, jpeg_quality=90, decode_ms=0)


def assert_close(actual: Any, expected: Any, path: str) -> None:
    if isinstance(expected, dict):
        assert isinstance(actual, dict) and actual.keys() == expected.keys(), path
        for key in expected:
            assert_close(actual[key], expected[key], f"{path}.{key}")
    elif isinstance(expected, list):
        assert isinstance(actual, list) and len(actual) == len(expected), path
        for i, (a, e) in enumerate(zip(actual, expected, strict=True)):
            assert_close(a, e, f"{path}[{i}]")
    elif isinstance(expected, bool) or expected is None or isinstance(expected, str):
        assert actual == expected, f"{path}: {actual!r} != {expected!r}"
    else:
        assert math.isclose(actual, expected, abs_tol=FEATURE_TOLERANCE), f"{path}: {actual} != {expected}"


def compare(service: dict[str, Any], browser: dict[str, Any], label: str) -> None:
    assert service["result"]["board"]["cells"] == browser["result"]["board"]["cells"], label
    assert [w["code"] for w in service["result"]["warnings"]] == [w["code"] for w in browser["result"]["warnings"]]
    assert service["result"]["status"] == browser["result"]["status"]
    for ours, theirs in zip(service["traces"], browser["traces"], strict=True):
        for field in EXACT_TRACE_FIELDS:
            assert ours[field] == theirs[field], f"{label} square {theirs['squareIndex']} {field}"
        assert_close(ours["features"], theirs["features"], f"{label} square {theirs['squareIndex']} features")
        assert_close(ours["occupancy"], theirs["occupancy"], f"{label} {theirs['squareIndex']} occupancy")
        assert_close(ours["color"], theirs["color"], f"{label} {theirs['squareIndex']} color")
        assert_close(ours["pieceType"], theirs["pieceType"], f"{label} {theirs['squareIndex']} type")
        assert ours["confidence"] == pytest.approx(theirs["confidence"], abs=FEATURE_TOLERANCE)
        assert_close(ours["roi"], theirs["roi"], f"{label} {theirs['squareIndex']} roi")
        assert_close(ours["regions"], theirs["regions"], f"{label} {theirs['squareIndex']} regions")
    ours_frame, their_frame = dict(service["frame"]), dict(browser["frame"])
    # Laplacian variance is a large number (≈ 100) with an advisory threshold (15):
    # compared relatively; OpenCV native and WASM sum it in a different order.
    ours_sharpness, their_sharpness = ours_frame.pop("sharpness"), their_frame.pop("sharpness")
    if their_sharpness is None:
        assert ours_sharpness is None
    else:
        assert math.isclose(ours_sharpness, their_sharpness, rel_tol=1e-3)
    assert_close(ours_frame, their_frame, f"{label} frame")


@pytest.mark.parametrize("name", SAMPLE_NAMES)
def test_recognition_as_saved_matches_browser(name, samples, classifier):  # type: ignore[no-untyped-def]
    sample = samples[name]
    service = run_service(classifier, sample["image"], corners_of(sample["corners"]))
    compare(service, sample["browser"]["saved"], f"{name} as saved")


@pytest.mark.parametrize("name", SAMPLE_NAMES)
def test_recognition_after_browser_refinement_matches(name, samples, classifier):  # type: ignore[no-untyped-def]
    sample = samples[name]
    corners = corners_of(sample["browser"]["refinement"]["corners"])
    service = run_service(classifier, sample["image"], corners)
    compare(service, sample["browser"]["refined"], f"{name} refined")


@pytest.mark.parametrize("name", SAMPLE_NAMES)
def test_refinement_matches_browser(name, samples, classifier):  # type: ignore[no-untyped-def]
    sample = samples[name]
    ours = refine(Session("parity", classifier), corners_of(sample["corners"]), sample["image"])
    theirs = sample["browser"]["refinement"]
    assert math.isclose(ours["scoreBefore"], theirs["scoreBefore"], rel_tol=1e-6)
    assert math.isclose(ours["scoreAfter"], theirs["scoreAfter"], rel_tol=1e-3)
    for corner in theirs["corners"]:
        a, b = ours["corners"][corner], theirs["corners"][corner]
        assert math.dist((a["x"], a["y"]), (b["x"], b["y"])) <= 0.5, f"{name} {corner}: {a} vs {b}"


# ----------------------------------------------------------------- synthetic boards

GENERATED = Path(__file__).resolve().parents[2] / "tests" / "fixtures" / "contract" / ".generated"


def _synthetic_cases() -> list[str]:
    index = GENERATED / "index.json"
    return json.loads(index.read_text(encoding="utf-8")) if index.exists() else []


@pytest.mark.skipif(not _synthetic_cases(), reason="run `npm run vision:contract` to export the synthetic boards")
@pytest.mark.parametrize("case", _synthetic_cases())
def test_synthetic_board_matches_browser(case, classifier):  # type: ignore[no-untyped-def]
    """Synthetic regression boards (kings, dim light, glare, fingertip, hand, phone...):
    the real samples have no kings yet, so king and EMPTY edge cases are checked here."""
    data = json.loads((GENERATED / case).read_text(encoding="utf-8"))
    image = decode_base64_image(data["png"], ServiceSettings())
    away = data["awayFromCamera"]
    recognition = recognize_board(
        image, classifier, timestamp=0, away_from_camera=(away["x"], away["y"]) if away else None
    )
    service = {"result": recognition.result, "traces": recognition.traces, "frame": recognition.frame}
    browser = {"result": data["result"], "traces": data["traces"], "frame": data["frame"]}
    compare(service, browser, data["name"])
