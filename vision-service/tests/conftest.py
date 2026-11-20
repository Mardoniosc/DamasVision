"""Shared fixtures: the app's default config and the real labeled samples (same files the
Angular tests use), so both recognizers are checked on the same evidence."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from damas_vision_service.imaging import decode_base64_image
from damas_vision_service.recognition.config import ConfidenceBands, resolve_classifier_config
from damas_vision_service.settings import ServiceSettings

REPO = Path(__file__).resolve().parents[2]
FIXTURES = REPO / "tests" / "fixtures"
CONTRACT = FIXTURES / "contract"
#: Every real sample the browser contract spec exported (tests/fixtures/real-samples/index.ts).
SAMPLE_NAMES = sorted(p.stem for p in (CONTRACT / "browser-results").glob("*.json"))
ORIENTATIONS = ["NORMAL", "ROTATED_90", "ROTATED_180", "ROTATED_270"]
CORNERS = ["topLeft", "topRight", "bottomRight", "bottomLeft"]


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


@pytest.fixture(scope="session")
def vision_config() -> dict[str, Any]:
    """The config the app sends (`DEFAULT_VISION_CONFIG`, exported by the contract spec)."""
    return load_json(CONTRACT / "default-vision-config.json")


def classifier_from(config: dict[str, Any]):  # type: ignore[no-untyped-def]
    bands = config["confidenceThresholds"]
    return resolve_classifier_config(
        color_thresholds=config["classifier"]["colorThresholds"],
        shape_thresholds=config["classifier"]["shapeThresholds"],
        roi_inset_ratio=config["roiInsetRatio"],
        confidence=ConfidenceBands(bands["high"], bands["acceptable"], bands["uncertain"]),
        normalized_width=config["normalizedBoardWidth"],
        normalized_height=config["normalizedBoardHeight"],
    )


@pytest.fixture(scope="session")
def classifier(vision_config):  # type: ignore[no-untyped-def]
    return classifier_from(vision_config)


def canonical(sample: dict[str, Any]) -> dict[str, dict[str, float]]:
    """`canonicalCorners` (domain/board/calibration.ts): a cyclic shift per 90° step."""
    corners = sample["calibration"]["corners"]
    steps = ORIENTATIONS.index(sample["calibration"]["orientation"])
    points = [corners[name] for name in CORNERS]
    return {name: points[(i + steps) % 4] for i, name in enumerate(CORNERS)}


@pytest.fixture(scope="session")
def samples() -> dict[str, dict[str, Any]]:
    """Real samples: decoded RGB frame, canonical corners, labels and the browser results."""
    settings = ServiceSettings()
    loaded = {}
    for name in SAMPLE_NAMES:
        sample = load_json(FIXTURES / "real-samples" / f"{name}.json")
        loaded[name] = {
            "image": decode_base64_image(sample["frame"]["png"], settings),
            "corners": canonical(sample),
            "labels": sample["labels"],
            "browser": load_json(CONTRACT / "browser-results" / f"{name}.json"),
        }
    return loaded
