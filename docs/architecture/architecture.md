# Architecture

Summary of `docs/execution-specification.md` §3–§4 as implemented so far. The specification remains authoritative.

## Layers

| Layer         | Path                         | Responsibility                                     | Status                                                              |
| ------------- | ---------------------------- | -------------------------------------------------- | ------------------------------------------------------------------- |
| Presentation  | `src/app/features/**`        | Routed pages, overlays, status, controls           | Setup (E1), calibration (E2), recognition (E3); others placeholders |
| Shared UI     | `src/app/shared/**`          | Reusable presentational components                 | `PagePlaceholder`, `BoardView`, `MediaStreamDirective`              |
| Camera        | `src/app/core/camera`        | Devices, permissions, stream lifecycle             | Done (E1)                                                           |
| Frame capture | `src/app/core/frame-capture` | Scheduling, backpressure, stale-frame dropping     | Done (E1)                                                           |
| Workers       | `src/app/core/workers`       | Vision worker protocol, entry/handler and client   | Calibration, rectification (E2), recognition (E3)                   |
| Vision        | `src/app/vision`             | Worker-side pipeline: OpenCV loader, perspective   | Perspective (E2), recognition (E3)                                  |
| Persistence   | `src/app/core/persistence`   | IndexedDB schema, repositories                     | Calibrations (E2); rest in E7                                       |
| App state     | `src/app/core/app-state`     | Session controller / state machine                 | Empty (E6)                                                          |
| Domain        | `src/app/domain/**`          | Board, game, move, rules, engine — pure TypeScript | Board geometry, calibration (E2), observations (E3); engine E4      |

Dependency direction: `features → core → domain`, `features → shared`, `features → domain`, `core/workers → vision → domain`. `domain` depends on nothing. `shared` depends on neither `features` nor `core`. These rules are enforced by ESLint (see ADR-006).

## Application shell

- `src/main.ts` bootstraps the standalone root `App` (`app.component.ts`) with `app.config.ts`.
- Providers: global error listeners, router with component input binding, service worker (production only).
- `App` renders header, primary navigation, `<main>` with `<router-outlet>` and footer. It contains no feature logic.
- Routes (`app.routes.ts`): `/`, `/game/new`, `/game/:id`, `/calibration`, `/games`, `/settings`, all lazy; `**` redirects to `/`.

## Camera (E1)

`CameraService` (`core/camera`, root) implements `CameraServiceContract` (spec §9) and exposes signals: `status`, `devices`, `devicesRequirePermission`, `stream`, `selectedDeviceId`, `isStreaming`.

```mermaid
stateDiagram-v2
    [*] --> IDLE
    [*] --> ERROR: unsupported / insecure context
    IDLE --> READY: devices listed with labels (access granted before)
    IDLE --> REQUESTING_PERMISSION: start()
    READY --> REQUESTING_PERMISSION: start()
    REQUESTING_PERMISSION --> STREAMING: getUserMedia resolved
    REQUESTING_PERMISSION --> ERROR: rejected (mapped code)
    STREAMING --> REQUESTING_PERMISSION: start(other device) / selectDevice()
    STREAMING --> READY: stop()
    STREAMING --> ERROR: track ended (device lost) → NO_DEVICE
    ERROR --> REQUESTING_PERMISSION: retry
    ERROR --> IDLE: stop() (no access granted yet)
```

- Browser APIs are reached only through the `CAMERA_ENVIRONMENT` token (`navigator.mediaDevices` is lint-restricted to `core/camera`).
- Before permission, browsers hide labels and often ids: such entries are not selectable and `devicesRequirePermission` is true. After the first successful stream the list is refreshed with real labels. `devicechange` refreshes it too.
- Errors are mapped to `CameraErrorCode` with pt-BR messages; raw browser messages are never shown.
- Leak guarantees: one stream at a time (released before requesting another); a request id discards any stream that resolves after a newer `start()`/`stop()` and stops its tracks; the stream is released on track `ended` and when the service is destroyed. The setup page stops camera and capture when the route is left.

## Frame capture (E1)

- `FrameScheduler` (plain TS): interval ticks; if `maxInFlight` frames are busy the tick is skipped (never queued). Frames older than `maxFrameAgeMs` or captured across a pause/stop are dropped. Every frame is released (`bitmap.close()`) in `finally`, whether processed, dropped or failed — closing a bitmap already transferred to a worker is a no-op, so the worker client in E2/E3 needs no special ownership rule.
- `VideoFrameSource`: private detached muted `<video>` on the camera stream + `createImageBitmap`; independent of the preview element.
- `FrameCaptureService` (root): wires camera stream → source → scheduler, exposes `state`, `stats`, `lastFrame`, `error`; stops automatically when the camera stream changes or closes. In E1 the processor only measures frames; E2/E3 pass the vision-worker processor to `start()`.
- Config tokens: `CAMERA_CONFIG` (1280×720 ideal, rear camera preferred) and `FRAME_CAPTURE_CONFIG` (200 ms, 1 in flight, 500 ms max age).

## Calibration and vision worker (E2)

Details: `docs/vision/calibration.md`.

```mermaid
flowchart LR
    Page[CalibrationPage + CalibrationStore] -->|corners, validation, overlay| Domain[domain/board]
    Page -->|captureSnapshot| Capture[FrameCaptureService]
    Page -->|calibrate / rectify| Client[VisionWorkerClient]
    Client -->|postMessage + transfer| Worker[vision.worker → handler]
    Worker --> Vision[vision/perspective]
    Vision --> CV[(OpenCV.js 5.0.0)]
    Page -->|save / getActive| Repo[DexieCalibrationRepository]
    Repo --> DB[(IndexedDB: calibrations)]
```

- The client is provided by the calibration page, so the worker is terminated on leaving the route.
- The live overlay uses the pure-TS homography, and pixels are warped only in the worker.

## Recognition (E3, refactored in G3)

Details, measurements and limitations: `docs/vision/recognition.md`; metrics on the real samples: `docs/vision/recognition-metrics.md`.

- `RecognitionStore` (route-scoped) starts `FrameCaptureService` with a processor that sends each frame to the worker (`PROCESS_FRAME`). The worker warps the frame, measures its quality, denoises it and runs the staged pipeline (`vision/recognition/`: frame assessment, background model, occupancy, color, piece type, consolidation). It answers `RECOGNITION_RESULT` with the result, one `SquareTrace` per playable square and the frame assessment, plus the rectified image when diagnostics are on.
- The store consolidates frames per square (`ObservationStabilizer`, ADR-035) and shows the stable reading. It freezes it for correction, applies corrections (`domain/board/observation.ts`) and confirms. It never touches game state.
- `RecognitionDebugComponent` (Modo diagnóstico) draws the classifier's regions and traces over the rectified image, with a per-square inspector (ADR-034).
- `vision/evaluation/` computes recognition metrics against labeled samples (ADR-036).
- `shared/components/board-view` renders any observation (UNKNOWN, confidence, corrected squares) and will be reused by the live game.

## Runtime principles (from spec)

1. Vision observes; engine decides.
2. Recognition never mutates authoritative game state.
3. Non-trivial image processing runs in a Web Worker.
4. No backend or cloud dependency.
