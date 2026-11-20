# Local vision service image (G3.1, ADR-042). Used by docker-compose.yml: its port is not
# published; the web proxy reaches it on the compose network.
FROM python:3.11.9-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONPATH=/app/src

WORKDIR /app

# Runtime packages only, every version (transitive included) pinned by the lock file.
COPY requirements.txt requirements.lock ./
RUN pip install -r requirements.txt -c requirements.lock

COPY src ./src

RUN useradd --system --uid 10001 --no-create-home vision
USER vision

# Inside the container only; docker-compose.yml does not publish this port.
ENV DAMAS_VISION_HOST=0.0.0.0 \
    DAMAS_VISION_PORT=8765
EXPOSE 8765

HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8765/v1/health', timeout=2)"]

CMD ["python", "-m", "damas_vision_service"]
