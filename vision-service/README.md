# Damas Vision — local vision service (optional)

A Python + OpenCV recognizer that answers the app's vision-worker protocol over HTTP on this machine (G3.1, ADR-042). It **observes** the board: it calibrates, rectifies and classifies the squares. It knows nothing about moves, rules or games; the app's stabilizer, move inference and engine stay authoritative. The browser recognizer (OpenCV.js) remains the default and works offline on any device; this service is an alternative for a computer that runs it.

## Setup and use

Requirements: Python 3.11–3.13 (developed on 3.11.9). From the repository root:

```bash
npm run vision:setup
npm run vision:serve
```

`vision:setup` creates `vision-service/.venv` and installs the exact pins of `requirements.lock`. `vision:serve` runs the service on `http://127.0.0.1:8765` (loopback only). Then, in the app, open **Configurações → Reconhecimento**, choose **Serviço local de visão (Python)**, press **Testar conexão**, then **Salvar**. The choice applies from the next camera page. If the service stops, the app says so ("O serviço de visão local não respondeu…") and never switches silently.

| Command                   | What it does                                                                                |
| ------------------------- | ------------------------------------------------------------------------------------------- |
| `npm run vision:setup`    | venv + exact dependencies                                                                   |
| `npm run vision:serve`    | the service on 127.0.0.1:8765                                                               |
| `npm run vision:test`     | exports the browser fixtures (`vision:contract`), then pytest (unit, API, parity)           |
| `npm run vision:contract` | regenerates the contract fixtures from the browser pipeline                                 |
| `npm run vision:eval`     | metrics on the real samples → `docs/vision/service-metrics.md`                              |
| `npm run e2e:service`     | Playwright with the app and the service (port 8766) → `docs/testing/service-performance.md` |
| `npm run validate:all`    | `validate` + `vision:test`                                                                  |

Environment overrides: `DAMAS_VISION_PORT`, `DAMAS_VISION_ORIGINS` (extra allowed origins, comma-separated), `DAMAS_VISION_MAX_BODY_BYTES`, `DAMAS_VISION_MAX_SESSIONS`, `DAMAS_VISION_SESSION_TTL`, `DAMAS_VISION_WORKER_THREADS`, `DAMAS_VISION_FRAME_TIMEOUT`, `DAMAS_VISION_REFINE_TIMEOUT`, `DAMAS_VISION_LOG_LEVEL`. The host is always `127.0.0.1`.

## API (contract v1)

OpenAPI: `GET /openapi.json` (the Swagger/ReDoc pages are disabled because they load from a CDN).

| Endpoint                                    | Body                       | Answer                         | Protocol             |
| ------------------------------------------- | -------------------------- | ------------------------------ | -------------------- |
| `GET /v1/health`                            | —                          | versions, contract version     | before `INIT`        |
| `POST /v1/sessions`                         | `{config: VisionConfig}`   | `{sessionId, contractVersion}` | `INIT`               |
| `DELETE /v1/sessions/{id}`                  | —                          | 204                            | `DISPOSE`            |
| `PUT /v1/sessions/{id}/calibration`         | `{corners, width, height}` | `CalibrationResult`            | `CALIBRATE`          |
| `DELETE /v1/sessions/{id}/calibration`      | —                          | 204                            | `RESET`              |
| `POST /v1/sessions/{id}/calibration/refine` | `{corners, image: base64}` | refined corners and scores     | `REFINE_CALIBRATION` |
| `POST /v1/sessions/{id}/rectify`            | JPEG/PNG                   | JPEG                           | `RECTIFY_FRAME`      |
| `POST /v1/sessions/{id}/frames?debug=`      | JPEG/PNG, `X-Frame-Id`     | `RecognitionResponse`          | `PROCESS_FRAME`      |

Errors are `{code, message}`: the protocol codes plus `BUSY` (409, the frame is dropped), `PAYLOAD_TOO_LARGE` (413), `UNSUPPORTED_MEDIA` (415), `TIMEOUT` (504) and `SESSION_LIMIT` (503). Limits: 8 MB bodies, 320–4096 px images (checked in the header before decoding), one frame per session at a time, 2 s per frame, 4 sessions (the least recently used idle one makes room), 10 min idle expiry.

## Layout

```text
src/damas_vision_service/
  api/            FastAPI app (routes, limits, CORS, logs) and the contract models (schemas.py)
  geometry/       board conventions, corner validation, homographies, grid/ROIs, corner refinement
  recognition/    config, quality, features, background model, king-mark search, stages, trace, recognize
  imaging.py      image validation, decode, encode
  pipeline.py     protocol operations on a session
  sessions.py     sessions, locks, expiry
scripts/evaluate.py   metrics report
tests/                unit, API, parity with the browser recognizer
```

The recognition is a port of the browser pipeline (`src/app/vision/recognition`), with the same stages, thresholds (sent by the app), confidence and pt-BR explanations. `tests/test_parity.py` checks it square by square against the browser's answers on the real samples and on 31 synthetic boards (kings, dim light, glare, a hand...). A change to the classifier must be made on both sides and keep the parity tests green.
