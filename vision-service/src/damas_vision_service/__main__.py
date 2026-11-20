"""`python -m damas_vision_service`: serves the API on the loopback interface only."""

from __future__ import annotations

import logging

import uvicorn

from .api.app import create_app
from .settings import load_settings


def main() -> None:
    settings = load_settings()
    logging.basicConfig(
        level=settings.log_level,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    uvicorn.run(
        create_app(settings),
        host=settings.host,
        port=settings.port,
        log_level=settings.log_level.lower(),
        access_log=False,  # the app logs one line per request itself
    )


if __name__ == "__main__":
    main()
