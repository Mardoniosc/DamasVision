"""Image bytes: validation (type, size, dimensions) before decoding, decoding and encoding.

Images are RGB `uint8` arrays of shape (height, width, 3) everywhere in the service, the
same channel order as the browser pipeline's RGBA buffers.
"""

from __future__ import annotations

import base64
import struct
from typing import Literal

import cv2
import numpy as np

from .errors import ServiceError
from .settings import ServiceSettings

ImageType = Literal["image/jpeg", "image/png"]

_PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
_JPEG_SIGNATURE = b"\xff\xd8\xff"
# JPEG start-of-frame markers (baseline, extended, progressive, lossless...), not DHT/JPG/DAC.
_SOF_MARKERS = {0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF}


def sniff_type(data: bytes) -> ImageType | None:
    if data.startswith(_PNG_SIGNATURE):
        return "image/png"
    if data.startswith(_JPEG_SIGNATURE):
        return "image/jpeg"
    return None


def declared_size(data: bytes, kind: ImageType) -> tuple[int, int] | None:
    """(width, height) read from the header, without decoding (guards decompression bombs)."""
    if kind == "image/png":
        if len(data) < 24 or data[12:16] != b"IHDR":
            return None
        width, height = struct.unpack(">II", data[16:24])
        return width, height
    offset = 2
    while offset + 4 <= len(data):
        if data[offset] != 0xFF:
            return None
        marker = data[offset + 1]
        if marker == 0xFF:  # fill byte
            offset += 1
            continue
        if marker in (0xD8, 0x01) or 0xD0 <= marker <= 0xD7:  # markers without length
            offset += 2
            continue
        length = struct.unpack(">H", data[offset + 2 : offset + 4])[0]
        if marker in _SOF_MARKERS:
            if offset + 9 > len(data):
                return None
            height, width = struct.unpack(">HH", data[offset + 5 : offset + 9])
            return width, height
        offset += 2 + length
    return None


def decode_image(data: bytes, content_type: str | None, settings: ServiceSettings) -> np.ndarray:
    """Validates and decodes JPEG/PNG bytes into an RGB array."""
    kind = sniff_type(data)
    declared = (content_type or "").split(";")[0].strip().lower()
    if kind is None or (declared and declared != kind):
        raise ServiceError("UNSUPPORTED_MEDIA", "expected a JPEG or PNG image")
    size = declared_size(data, kind)
    if size is None:
        raise ServiceError("INVALID_REQUEST", "unreadable image header")
    check_dimensions(*size, settings)
    decoded = cv2.imdecode(np.frombuffer(data, dtype=np.uint8), cv2.IMREAD_COLOR)
    if decoded is None:
        raise ServiceError("INVALID_REQUEST", "the image could not be decoded")
    return cv2.cvtColor(decoded, cv2.COLOR_BGR2RGB)


def decode_base64_image(value: str, settings: ServiceSettings) -> np.ndarray:
    """Decodes a base64 image (optionally a `data:` URL)."""
    payload = value.split(",", 1)[1] if value.startswith("data:") else value
    try:
        data = base64.b64decode(payload, validate=True)
    except ValueError as error:
        raise ServiceError("INVALID_REQUEST", "image is not valid base64") from error
    return decode_image(data, None, settings)


def check_dimensions(width: int, height: int, settings: ServiceSettings) -> None:
    low, high = settings.min_image_side, settings.max_image_side
    if not (low <= width <= high and low <= height <= high):
        raise ServiceError(
            "INVALID_REQUEST", f"image is {width}x{height}; each side must be {low}-{high} px"
        )


def encode_jpeg(image: np.ndarray, quality: int) -> bytes:
    ok, buffer = cv2.imencode(
        ".jpg", cv2.cvtColor(image, cv2.COLOR_RGB2BGR), [cv2.IMWRITE_JPEG_QUALITY, quality]
    )
    if not ok:
        raise ServiceError("RECOGNITION_FAILED", "JPEG encoding failed")
    return buffer.tobytes()


def encode_png_gray(mask: np.ndarray) -> bytes:
    ok, buffer = cv2.imencode(".png", mask)
    if not ok:
        raise ServiceError("RECOGNITION_FAILED", "PNG encoding failed")
    return buffer.tobytes()


def to_base64(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")
