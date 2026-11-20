"""Recognition metrics of the local vision service (G3.1, Phase 8).

Replays the real labeled samples (tests/fixtures/real-samples) through the service
pipeline — as saved, after the automatic corner adjustment, and as JPEG at several
qualities (the transport the app uses) — and the synthetic regression boards when they
have been exported (`npm run vision:contract`). Writes docs/vision/service-metrics.md.

Usage (from the repository root): npm run vision:eval
"""

from __future__ import annotations

import json
import statistics
import sys
import time
from collections import Counter
from collections.abc import Iterable
from pathlib import Path
from typing import Any

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "vision-service" / "src"))

from damas_vision_service.geometry.board import PLAYABLE_SQUARES  # noqa: E402
from damas_vision_service.geometry.calibration import Corners  # noqa: E402
from damas_vision_service.imaging import decode_base64_image, decode_image  # noqa: E402
from damas_vision_service.pipeline import calibrate, process, refine  # noqa: E402
from damas_vision_service.recognition.config import ConfidenceBands, resolve_classifier_config  # noqa: E402
from damas_vision_service.recognition.recognize import recognize_board  # noqa: E402
from damas_vision_service.sessions import Session  # noqa: E402
from damas_vision_service.settings import ServiceSettings  # noqa: E402

FIXTURES = ROOT / "tests" / "fixtures"
REPORT = ROOT / "docs" / "vision" / "service-metrics.md"
CLASSES = ["EMPTY", "WHITE", "BLACK", "WHITE_KING", "BLACK_KING"]
READINGS = [*CLASSES, "UNKNOWN"]
JPEG_QUALITIES = [95, 90, 80, 70]
TIMING_RUNS = 10
ORIENTATIONS = ["NORMAL", "ROTATED_90", "ROTATED_180", "ROTATED_270"]
CORNER_NAMES = ["topLeft", "topRight", "bottomRight", "bottomLeft"]
SETTINGS = ServiceSettings()


def classifier():  # type: ignore[no-untyped-def]
    config = json.loads((FIXTURES / "contract" / "default-vision-config.json").read_text("utf-8"))
    bands = config["confidenceThresholds"]
    return resolve_classifier_config(
        color_thresholds=config["classifier"]["colorThresholds"],
        shape_thresholds=config["classifier"]["shapeThresholds"],
        roi_inset_ratio=config["roiInsetRatio"],
        confidence=ConfidenceBands(bands["high"], bands["acceptable"], bands["uncertain"]),
        normalized_width=config["normalizedBoardWidth"],
        normalized_height=config["normalizedBoardHeight"],
    )


def canonical(sample: dict[str, Any]) -> Corners:
    corners = sample["calibration"]["corners"]
    steps = ORIENTATIONS.index(sample["calibration"]["orientation"])
    points = [corners[n] for n in CORNER_NAMES]
    shifted = [points[(i + steps) % 4] for i in range(4)]
    return Corners(*[(p["x"], p["y"]) for p in shifted])


def recognize(config, image: np.ndarray, corners: Corners) -> dict[str, Any]:  # type: ignore[no-untyped-def]
    session = Session("eval", config)
    height, width = image.shape[:2]
    assert calibrate(session, corners, width, height)["valid"]
    return process(session, image, "eval", debug=False, jpeg_quality=90, decode_ms=0)


class Metrics:
    def __init__(self) -> None:
        self.confusion: Counter[tuple[str, str]] = Counter()
        self.images: list[tuple[str, int, int, list[str]]] = []

    def add(self, name: str, labels: list[str], cells: list[str]) -> None:
        errors = []
        correct = unknown = 0
        for index in PLAYABLE_SQUARES:
            label, reading = labels[index], cells[index]
            self.confusion[(label, reading)] += 1
            if reading == label:
                correct += 1
            elif reading == "UNKNOWN":
                unknown += 1
            else:
                errors.append(f"{index}: {label} → {reading}")
        self.images.append((name, correct, unknown, errors))

    def total(self) -> int:
        return sum(self.confusion.values())

    def correct(self) -> int:
        return sum(n for (label, reading), n in self.confusion.items() if label == reading)

    def unknown(self) -> int:
        return sum(n for (_, reading), n in self.confusion.items() if reading == "UNKNOWN")

    def confident_errors(self) -> int:
        return self.total() - self.correct() - self.unknown()

    def false_positives(self) -> int:  # empty read as a piece
        return sum(n for (l, r), n in self.confusion.items() if l == "EMPTY" and r not in ("EMPTY", "UNKNOWN"))

    def false_negatives(self) -> int:  # piece read as empty
        return sum(n for (l, r), n in self.confusion.items() if l != "EMPTY" and r == "EMPTY")

    def per_class(self) -> list[dict[str, Any]]:
        rows = []
        for cls in CLASSES:
            support = sum(n for (l, _), n in self.confusion.items() if l == cls)
            predicted = sum(n for (_, r), n in self.confusion.items() if r == cls)
            correct = self.confusion[(cls, cls)]
            unknown = self.confusion[(cls, "UNKNOWN")]
            precision = correct / predicted if predicted else None
            recall = correct / support if support else None
            f1 = (
                2 * precision * recall / (precision + recall)
                if precision is not None and recall is not None and precision + recall > 0
                else None
            )
            rows.append(
                {"cls": cls, "support": support, "predicted": predicted, "correct": correct,
                 "unknown": unknown, "precision": precision, "recall": recall, "f1": f1}
            )  # fmt: skip
        return rows


def pct(value: float | None) -> str:
    return "—" if value is None else f"{value * 100:.1f}%"


def summary(m: Metrics) -> list[str]:
    total = m.total()
    return [
        f"- Images: {len(m.images)} · playable squares: {total}",
        f"- Correct: {m.correct()} ({pct(m.correct() / total)}) · UNKNOWN: {m.unknown()} "
        f"({pct(m.unknown() / total)}) · **confident errors: {m.confident_errors()}**",
        f"- Occupancy: false positives (empty → piece) {m.false_positives()} · "
        f"false negatives (piece → empty) {m.false_negatives()}",
    ]


def class_table(m: Metrics) -> list[str]:
    lines = [
        "| Class | Support | Predicted | Correct | UNKNOWN | Precision | Recall | F1 |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for r in m.per_class():
        lines.append(
            f"| {r['cls']} | {r['support']} | {r['predicted']} | {r['correct']} | {r['unknown']} | "
            f"{pct(r['precision'])} | {pct(r['recall'])} | {pct(r['f1'])} |"
        )
    return lines


def confusion_table(m: Metrics) -> list[str]:
    lines = [
        "| Label \\ reading | " + " | ".join(READINGS) + " |",
        "| --- | " + " | ".join("---:" for _ in READINGS) + " |",
    ]
    for label in CLASSES:
        lines.append(f"| {label} | " + " | ".join(str(m.confusion[(label, r)]) for r in READINGS) + " |")
    return lines


def image_table(m: Metrics) -> list[str]:
    lines = ["| Image | Correct | UNKNOWN | Wrong | Errors |", "| --- | ---: | ---: | ---: | --- |"]
    for name, correct, unknown, errors in m.images:
        lines.append(f"| {name} | {correct}/32 | {unknown} | {len(errors)} | {', '.join(errors) or '—'} |")
    return lines


def section(title: str, m: Metrics, intro: str, images: bool = True) -> list[str]:
    out = [f"## {title}", "", intro, "", *summary(m), "", "### Per class", "", *class_table(m), ""]
    out += ["### Confusion matrix (rows: label, columns: reading)", "", *confusion_table(m), ""]
    if images:
        out += ["### Per image", "", *image_table(m), ""]
    return out


def percentile(values: Iterable[float], q: float) -> float:
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, round(q * (len(ordered) - 1)))]


def main() -> None:
    config = classifier()
    samples = []
    for path in sorted((FIXTURES / "real-samples").glob("*.json")):
        sample = json.loads(path.read_text("utf-8"))
        samples.append((path.stem, sample, decode_base64_image(sample["frame"]["png"], SETTINGS), canonical(sample)))

    saved, refined = Metrics(), Metrics()
    jpeg = {q: Metrics() for q in JPEG_QUALITIES}
    timings: dict[str, list[float]] = {"decodeMs": [], "warpMs": [], "recognizeMs": [], "totalMs": []}
    jpeg_sizes: dict[int, list[int]] = {q: [] for q in JPEG_QUALITIES}
    refine_ms: list[float] = []
    for name, sample, image, corners in samples:
        labels = sample["labels"]
        saved.add(name, labels, recognize(config, image, corners)["result"]["board"]["cells"])
        started = time.perf_counter()
        adjusted = refine(Session("eval", config), corners, image)
        refine_ms.append((time.perf_counter() - started) * 1000)
        c = adjusted["corners"]
        refined_corners = Corners(*[(c[n]["x"], c[n]["y"]) for n in CORNER_NAMES])
        refined.add(name, labels, recognize(config, image, refined_corners)["result"]["board"]["cells"])
        bgr = cv2.cvtColor(image, cv2.COLOR_RGB2BGR)
        for q in JPEG_QUALITIES:
            data = cv2.imencode(".jpg", bgr, [cv2.IMWRITE_JPEG_QUALITY, q])[1].tobytes()
            jpeg_sizes[q].append(len(data))
            decoded = decode_image(data, "image/jpeg", SETTINGS)
            jpeg[q].add(name, labels, recognize(config, decoded, corners)["result"]["board"]["cells"])
        # Processing time as the API sees it: JPEG 90 decode + warp + recognition.
        data = cv2.imencode(".jpg", bgr, [cv2.IMWRITE_JPEG_QUALITY, 90])[1].tobytes()
        session = Session("timing", config)
        height, width = image.shape[:2]
        calibrate(session, corners, width, height)
        for _ in range(TIMING_RUNS):
            started = time.perf_counter()
            decoded = decode_image(data, "image/jpeg", SETTINGS)
            decode_ms = (time.perf_counter() - started) * 1000
            t = process(session, decoded, "t", debug=False, jpeg_quality=90, decode_ms=decode_ms)["timings"]
            for key in timings:
                timings[key].append(t[key])

    synthetic = Metrics()
    generated = FIXTURES / "contract" / ".generated"
    index = generated / "index.json"
    if index.exists():
        for file in json.loads(index.read_text("utf-8")):
            data = json.loads((generated / file).read_text("utf-8"))
            image = decode_base64_image(data["png"], SETTINGS)
            away = data["awayFromCamera"]
            result = recognize_board(image, config, timestamp=0, away_from_camera=(away["x"], away["y"]) if away else None)
            synthetic.add(f"{data['name']} ({data['suite']})", data["labels"], result.result["board"]["cells"])

    lines = [
        "# Recognition metrics — local vision service (G3.1)",
        "",
        "<!-- Generated by `npm run vision:eval` (vision-service/scripts/evaluate.py). Do not edit by hand. -->",
        "",
        "Same targets as the browser recognizer (`recognition-metrics.md`): EMPTY precision ≥ 98 %, "
        "WHITE/BLACK recall ≥ 95 %, zero confident errors. UNKNOWN is an abstention: it lowers recall, "
        "never precision. The service is checked for parity with the browser recognizer square by square "
        "(`vision-service/tests/test_parity.py`), so on lossless frames these numbers are the browser's.",
        "",
        *section(
            "Real samples — PNG, calibration as saved",
            saved,
            "Evidence. The labeled frames exported from the app, replayed through the service pipeline "
            "(single frame, no temporal stabilization).",
        ),
        *section(
            "Real samples — PNG, after the automatic corner adjustment",
            refined,
            "Same frames, corners adjusted by the service's port of REFINE_CALIBRATION.",
            images=False,
        ),
        "## Real samples — JPEG transport",
        "",
        "The app sends frames to the service as JPEG (quality 0.9 by default, encoded in the remote "
        "worker). Here each PNG frame is re-encoded with OpenCV's libjpeg at the given quality before "
        "recognition (Chromium's encoder is also libjpeg-turbo; quality scales match approximately).",
        "",
        "| JPEG quality | Mean size | Correct | UNKNOWN | Confident errors | EMPTY precision | EMPTY recall |",
        "| ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for q in JPEG_QUALITIES:
        m = jpeg[q]
        empty = m.per_class()[0]
        lines.append(
            f"| {q} | {statistics.mean(jpeg_sizes[q]) / 1024:.0f} kB | {m.correct()}/{m.total()} | {m.unknown()} | "
            f"{m.confident_errors()} | {pct(empty['precision'])} | {pct(empty['recall'])} |"
        )
    lines += ["", "### JPEG 90 per image", "", *image_table(jpeg[90]), ""]
    if synthetic.images:
        lines += section(
            "Synthetic regression boards (not evidence)",
            synthetic,
            "Rendered boards of the browser suites (metrics scenarios and the EMPTY suite with shadows, "
            "glare, a fingertip, a hand, a phone), exported by `npm run vision:contract`. They guard known "
            "failure modes, kings included; they do not measure field accuracy. Adversarial EMPTY scenarios "
            "are expected to produce UNKNOWN, never a piece.",
        )
    lines += [
        "## Processing time (service, in process)",
        "",
        f"Real 1280 × 720 frames as JPEG 90, {TIMING_RUNS} runs per sample ({len(timings['totalMs'])} frames), "
        "this machine. HTTP transport is measured separately (`docs/testing/service-performance.md`).",
        "",
        "| Stage | Median | p90 |",
        "| --- | ---: | ---: |",
    ]
    for key, label in [("decodeMs", "JPEG decode"), ("warpMs", "Warp"), ("recognizeMs", "Quality + denoise + recognition"), ("totalMs", "Total")]:
        lines.append(f"| {label} | {statistics.median(timings[key]):.1f} ms | {percentile(timings[key], 0.9):.1f} ms |")
    lines += [
        "",
        f"Automatic corner adjustment: median {statistics.median(refine_ms):.0f} ms over {len(refine_ms)} samples.",
        "",
    ]
    REPORT.write_text("\n".join(lines), encoding="utf-8")
    print(f"wrote {REPORT.relative_to(ROOT)}")
    sys.stdout.buffer.write(("\n".join(summary(saved)) + "\n").encode("utf-8"))


if __name__ == "__main__":
    main()
