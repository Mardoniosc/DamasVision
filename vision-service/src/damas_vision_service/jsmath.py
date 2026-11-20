"""Numeric helpers that reproduce JavaScript semantics, so the service and the browser
recognizer produce the same rounded values and the same pt-BR texts (parity, G3.1)."""

from __future__ import annotations

import math
from collections.abc import Sequence
from decimal import ROUND_HALF_UP, Decimal


def js_round(value: float) -> int:
    """`Math.round`: halves round towards +infinity."""
    return math.floor(value + 0.5)


def round3(value: float) -> float:
    """`Math.round(value * 1000) / 1000` (the browser pipeline's `round`)."""
    return math.floor(value * 1000 + 0.5) / 1000


def to_fixed(value: float, digits: int) -> str:
    """`Number.prototype.toFixed` for non-negative values (exact binary value, ties up)."""
    quantum = Decimal(1).scaleb(-digits)
    return str(Decimal(value).quantize(quantum, rounding=ROUND_HALF_UP))


def median(values: Sequence[float]) -> float:
    """Median with the mean of the two middle values (the browser `median`)."""
    if not values:
        return 0.0
    ordered = sorted(values)
    middle = len(ordered) // 2
    if len(ordered) % 2 == 1:
        return float(ordered[middle])
    return (ordered[middle - 1] + ordered[middle]) / 2
