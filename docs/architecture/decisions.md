# Architecture decisions

Decisions and deviations from `docs/execution-specification.md`. Each entry states context, decision and consequence. Newest last.

## Exact versions (E0, 2026-11-19)

| Package                                 | Version         |
| --------------------------------------- | --------------- |
| Node.js (dev)                           | 26.13.1         |
| npm                                     | 11.20.0         |
| @angular/\* (core, router, build, cli…) | 22.3.0          |
| @angular/service-worker                 | 22.3.0          |
| TypeScript                              | 6.0.3           |
| RxJS                                    | 7.8.2           |
| tslib                                   | 2.9.1           |
| Tailwind CSS / @tailwindcss/postcss     | 4.3.5           |
| PostCSS                                 | 8.5.33          |
| Vitest                                  | 5.1.1           |
| jsdom                                   | 31.0.1          |
| @playwright/test                        | 1.65.1          |
| Chromium (Playwright headless shell)    | 159.0.8154.6    |
| ESLint                                  | 10.15.0         |
| @eslint/js                              | 10.0.1          |
| angular-eslint                          | 22.8.0          |
| typescript-eslint                       | 8.72.2          |
| Prettier                                | 3.10.1          |
| @techstark/opencv-js (OpenCV.js 5.0.0)  | 5.0.0-release.1 |
| Dexie                                   | 4.4.7           |
| fake-indexeddb (tests)                  | 6.2.8           |

All dependencies are pinned exactly in `package.json`; `.npmrc` sets `save-exact=true` and `engine-strict=true`.

## ADR-001 — Angular 22 instead of the globally installed CLI 21

- **Context:** the machine has a global `@angular/cli@21.0.2`, which reports Node 26 as unsupported. Angular 22.3.0 (current `latest`) supports `^22.22.3 || ^24.15.0 || >=26.0.0`.
- **Decision:** scaffold and run with the project-local Angular 22.3.0 CLI (`npx ng`). The global CLI was not modified.
- **Consequence:** always use `npx ng` / npm scripts.

## ADR-002 — Zoneless, OnPush by default, signals

- **Context:** spec requires Angular signals for reactive UI. Angular 22 is zoneless by default for new apps and makes `OnPush` the default change-detection strategy.
- **Decision:** no `zone.js`; UI state via signals; RxJS only where stream semantics help (e.g. frame scheduling later).
- **Consequence:** async work that must update the view has to write to signals.

## ADR-003 — 2016 file-name style guide

- **Context:** Angular 20+ defaults to suffix-less names (`app.ts`), but the spec structure names `app.component.ts`.
- **Decision:** `ng new --file-name-style-guide=2016`, so generated files keep `.component.ts`, `.service.ts` etc. The root class is still called `App` (CLI default).
- **Consequence:** generate code with the workspace schematics; they are pre-configured for this style.

## ADR-004 — Unit test runner

- **Context:** spec asks for an Angular-compatible runner / Vitest.
- **Decision:** `@angular/build:unit-test` with Vitest 5 and jsdom. It includes `src/**/*.spec.ts`, `tests/unit/**/*.spec.ts` and `tests/integration/**/*.spec.ts`.
- **Consequence:** no separate `vitest.config.ts`; options live in `angular.json`.

## ADR-005 — Tailwind CSS 4 via PostCSS

- **Decision:** `@tailwindcss/postcss` configured in `.postcssrc.json`; design tokens in `src/styles/theme.css` (`@theme`).
- **Consequence:** prefer utilities and tokens; component styles only for things utilities cannot express.

## ADR-006 — Layer boundaries enforced by ESLint

- **Context:** spec §2/§4 forbid rules in components, OpenCV/IndexedDB in UI and framework/browser code in `domain/**`.
- **Decision:** `no-restricted-imports`, `no-restricted-globals` and `no-restricted-properties` per folder in `eslint.config.js`; layer imports are matched by a relative-path regex so packages such as `@angular/core` are not confused with `src/app/core`. `@typescript-eslint/no-explicit-any` is an error.
- **Consequence:** verified during E0 with temporary probe files (13 expected violations reported, probes removed).

## ADR-007 — Additional strict compiler flags

- **Decision:** besides `strict`, enable `noUncheckedIndexedAccess`, `useUnknownInCatchVariables`, `noImplicitOverride`, `noPropertyAccessFromIndexSignature`, `noImplicitReturns`, `noFallthroughCasesInSwitch`; Angular `strictTemplates`, `strictStandalone`, `strictInjectionParameters`, `strictInputAccessModifiers`.
- **Rationale:** the board is a fixed 64-cell array accessed by index; `noUncheckedIndexedAccess` forces explicit handling of out-of-range access.

## ADR-008 — PWA baseline

- **Decision:** `@angular/pwa` (service worker + manifest + default icons). Service worker registered only when `!isDevMode()`.
- **Consequence:** default Angular icons are placeholders until branding is decided (E8-T05).

## ADR-009 — Structural deviations from spec §4

- `src/assets/` is not created: Angular 17+ serves static files from `public/` (`public/assets/`, `public/models/` exist as in the spec).
- The spec file is kept at the repository root (original deliverable) and copied byte-for-byte to `docs/execution-specification.md`.
- `public/icons/`, `ngsw-config.json`, `eslint.config.js`, `playwright.config.ts`, `.postcssrc.json` and `.github/workflows/ci.yml` are added by tooling choices above.
- Unknown URLs redirect to `/` instead of a dedicated not-found page (not in the route list of spec §10).

## ADR-010 — npm install scripts not approved

- **Context:** npm 11.20 blocks dependency install scripts until approved (`@parcel/watcher`, `esbuild`, `lmdb`, `msgpackr-extract`).
- **Decision:** left unapproved. Build, tests and dev server work because these packages ship prebuilt binaries via optional dependencies or have JS fallbacks.
- **Consequence:** if a future build fails on a native module, review and approve that specific package with `npm install-scripts approve <pkg>`.

## ADR-011 — Camera status semantics and error reporting (E1)

- **Context:** spec §9 lists the states `IDLE`, `REQUESTING_PERMISSION`, `READY`, `STREAMING` and `ERROR` without defining `READY`, and `start()` returns `Promise<void>`.
- **Decision:** `READY` = camera access was granted at least once, but no stream is open (labels known, restart needs no prompt). `start()` never rejects; failures become `status = { state: 'ERROR', error }`, which the UI renders, so nothing is swallowed. An unsupported browser or an insecure context is reported as `UNSUPPORTED` from construction, with a message that names HTTPS when the context is insecure. A track that ends unexpectedly (device unplugged or revoked) maps to `NO_DEVICE`.
- **Consequence:** callers inspect `status()`/`getStatus()` instead of catching.

## ADR-012 — Capture source is a private video element (E1)

- **Context:** `ImageCapture`/`MediaStreamTrackProcessor` are not available in every target browser.
- **Decision:** `VideoFrameSource` plays the stream in its own detached, muted `<video>` and captures with `createImageBitmap(video)`. The preview `<video>` in the UI is independent.
- **Consequence:** capture works without the preview being visible. `ImageBitmap` is transferable, matching the worker protocol in spec §9.

## ADR-013 — Scheduler drops instead of queueing (E1)

- **Decision:** a tick that finds `maxInFlight` frames busy is skipped (`skippedBusy`), so the next processed frame is always freshly captured. Frames older than `maxFrameAgeMs` when ready (`droppedStale`), or captured across a pause/stop (`droppedInactive`), are discarded. The scheduler always releases frames after processing settles.
- **Consequence:** bounded memory and latency. The stats make backpressure observable for tuning in later epics.

## ADR-014 — Camera lifetime is scoped to the setup route for now (E1)

- **Context:** the camera and capture services are root singletons so later epics (calibration, live game) can share one stream.
- **Decision:** in E1 the setup page stops capture and camera when it is destroyed. Moving the stream across routes will be decided explicitly in E2/E6.
- **Consequence:** leaving `/game/new` always releases the camera (verified in E2E).

## ADR-015 — E2E synthetic camera (E1)

- **Decision:** Playwright's Chromium runs with `--use-fake-device-for-media-stream=device-count=2` and `--use-fake-ui-for-media-stream` and is granted `camera` permission. E2E tests wrap `getUserMedia` with an init script to record streams and assert that no track remains live. The denied-permission case is simulated by overriding `getUserMedia` in an init script.
- **Consequence:** E2E covers Chromium only. Firefox/Safari camera behavior is part of the physical/device test matrix (E8).

## ADR-016 — OpenCV.js 5.0.0 via `@techstark/opencv-js` (E2)

- **Context:** spec §2 requires OpenCV.js with a controlled build and no runtime cloud dependency.
- **Decision:** `@techstark/opencv-js@5.0.0-release.1` (Apache-2.0), the official `docs.opencv.org/5.0.0/opencv.js` build with WASM embedded, pinned and bundled locally. Only the vision worker loads it, lazily: a 17.5 MB chunk (≈2.9 MB compressed). The initial bundle is unchanged.
- **Integration details:**
  - The package's CommonJS export is a real Promise of the runtime. esbuild's ESM interop (`__toESM`) copies it into an object that inherits `Promise.prototype` without being a Promise, and any `await` of that object throws. `vision/opencv-runtime.ts` therefore uses `import x = require(...)` (justified lint disable) and carries the module inside a plain wrapper object.
  - The file references `fs`/`path`/`crypto` only under `ENVIRONMENT_IS_NODE`. The build marks them as `externalDependencies`, and `allowedCommonJsDependencies` silences the CommonJS warning.
  - The dev server's Vite pre-bundling breaks the `require` inside the worker, so `serve.options.prebundle.exclude` lists the package.
- **Consequence:** the PWA `app` asset group currently prefetches the OpenCV chunk on install. That is needed for offline use but heavy, so it is to be revisited in E8-T05.

## ADR-017 — `src/app/vision/` layer (E2)

- **Context:** spec §4 has no folder for the worker-side pipeline. `core/workers` owns the protocol and client.
- **Decision:** new layer `src/app/vision/` holds pure TypeScript and OpenCV code that runs inside the worker: loader, `ResourceScope`, perspective, `VisionConfig`. It may import only `domain/**`. ESLint forbids Angular, RxJS, Dexie, DOM globals and app-layer imports there, and allows `@techstark/opencv-js` **only** there. The worker entry, protocol handler and client stay in `core/workers`.

## ADR-018 — Worker protocol in E2 (E2)

- **Decision:** spec §9 messages `INIT`, `CALIBRATE`, `RESET`, `DISPOSE`, `READY`, `CALIBRATION_RESULT` and `ERROR` are implemented. `PROCESS_FRAME`/`RECOGNITION_RESULT` arrive with recognition in E3.
- **Extensions:**
  - `RECTIFY_FRAME { frame, frameId }` → `RECTIFIED_FRAME { frameId, image }`, needed for the "normalized board" step of the spec §13 calibration sequence.
  - Optional `ERROR.requestType`, so errors without a `frameId` can be routed to their request.
- **`CalibrationResult`** (undefined in the spec): `{ valid, issues, transform?, normalizedWidth, normalizedHeight }`. `CALIBRATE` receives canonical corners, with orientation already applied.
- **Robustness:** both sides validate payloads. The client has timeouts (INIT 60 s, which includes compiling OpenCV; requests 15 s), supersedes duplicate requests, closes late `RECTIFIED_FRAME` bitmaps, terminates on crash and retries on the next call. Bitmaps are transferred, and the worker closes every bitmap it receives.

## ADR-019 — Worker and camera lifetime (E2, resolves ADR-014)

- **Decision:** `VisionWorkerClient` is provided by the calibration page, so leaving the route terminates the worker and frees OpenCV's memory (verified in E2E). Every camera-using page opens the camera on entry and releases it on exit. The chosen device is remembered by the root `CameraService`, so `/game/new` → `/calibration` keeps exactly one live stream (verified in E2E). The live game (E6) will decide whether to keep a single long-lived worker.

## ADR-020 — Calibration persistence (E2-T06)

- **Decision:** Dexie 4.4.7, database `damas-vision` schema v1 with only `calibrations: 'id, updatedAt'`. `isActive` is not indexed, because booleans are not valid IndexedDB keys. `games`, `settings` and `recognitionLogs` will be added as new schema versions in E7.
- The repository implements the spec §11 interface plus `getActive()`. Errors map to `PersistenceError` codes with pt-BR messages (quota, unavailable, not found, duplicate).
- Profiles store the image-order corners, the orientation and the source resolution. Corners are rescaled when the camera resolution changes.
- Tests use `fake-indexeddb` 6.2.8 (dev dependency).

## ADR-021 — Duplicate homography in TypeScript (E2)

- **Decision:** a small pure-TS homography (`domain/board/homography.ts`) projects the grid overlay on the main thread while handles are dragged. OpenCV remains the implementation that warps pixels. A unit test asserts both agree to 1e-6.

## ADR-022 — Classical, self-referenced square classifier (E3)

- **Context:** spec §7 asks for configurable classical features (HSV, luminance, contrast, area, king marks) and explicit `UNKNOWN`, without ML.
- **Decision:** features are computed in pure TypeScript on the rectified 800×800 board, and OpenCV is used for the warp, the denoising blur and the frame-quality checks. Each square is judged against references that share its lighting:
  - its own corners give the background;
  - neighbouring light squares (which never hold pieces) give the illumination.

  Color comes from the body/background luminance ratio. The foreground threshold scales with the local illumination. Occlusion and board-contrast guards turn risky "empty" answers into `UNKNOWN`. Details and measurements are in `docs/vision/recognition.md`.

- **Consequence:** deterministic and testable without a browser. Kings require a central mark (spec §7 assumption). Pieces with low luminance contrast against the dark squares (for example red on brown) need threshold tuning.

## ADR-023 — Typed classifier config inside `VisionConfig` (E3-T01)

- **Decision:** `ColorThresholds`/`ShapeThresholds` are type aliases, not interfaces, so they stay assignable to the spec's `Record<string, number>`; the lint rule is disabled with a justification. `resolveClassifierConfig` merges overrides over defaults, rejects unknown keys and invalid ranges, and runs at worker `INIT` (an invalid config gives `INVALID_REQUEST`).

## ADR-024 — `/recognition` route (E3)

- **Context:** spec §10 lists routes without a step for the setup flow's "initial recognition → correction", and E3-T08 needs a screen.
- **Decision:** add the lazy route `/recognition` (setup step 3), linked from the calibration page. The vision worker is scoped to that route, like on `/calibration`. The route contract test lists it as a documented addition.

## ADR-025 — Recognition never touches game state; confirmed observation stays local (E3)

- **Decision:** the confirmed (corrected) observation lives in `RecognitionStore` and is not persisted. E6 (initial position validation and game start) will consume it through the game-session controller. The temporal stabilizer is E5, so E3 classifies each frame independently and shows the latest reading.

## ADR-026 — Synthetic evaluation and board-video E2E (E3)

- **Decision:** `tests/fixtures/synthetic-board.ts` renders deterministic boards (lighting, gradients, shadows, noise, jitter, kings, perspective). Accuracy targets from spec §16 (≥ 95 %, zero confident errors) are asserted per scenario. For E2E, `tests/e2e/support/synthetic-video.ts` writes a Y4M video (gitignored, generated in Playwright `globalSetup`) that Chromium plays as the camera (`--use-file-for-fake-video-capture`), in the `chromium-board` project.
- **Consequence:** the full browser pipeline is tested end to end. Physical accuracy remains to be measured (E8-T02); the correction screen reports per-session agreement to support that.

## ADR-027 — Automatic corner adjustment (after the first real-world test)

- **Context:** the first test on a physical board (blue/cream, tall grooved pieces, oblique camera, 2026-11-19) showed 11 `?` squares, concentrated in the far rows. On screen the far edge is small, and corners placed about 10 px inside the board misalign the far rows by a third of a square. A synthetic reproduction confirmed it: a 10 px inset gives 11 UNKNOWN, a 20 px inset 17, with zero confident errors (safe, but unusable).
- **Decision:** `vision/calibration-refinement.ts` snaps the user's corners to the square borders by maximizing the luminance contrast across the 18 projected grid lines.
  - **Objective:** an edge derivative 1.5 px across each line, plus a quarter-square contrast; trimmed mean per line so pieces and shadows crossing a line are ignored.
  - **Search:** coordinate descent, then basin hopping (0.3-square jumps), at half resolution, followed by a full-resolution polish. Each corner may move at most half a square from the user's handle, so this is refinement, not automatic board detection (still out of scope).
  - **Protocol:** `REFINE_CALIBRATION` → `CALIBRATION_REFINED`.
  - **UI:** "Ajustar automaticamente" on `/calibration`; "Reajustar cantos" on `/recognition`, which also saves the adjusted profile.
- **Measured (synthetic):** recovers ±18 px random corner errors to < 2.5 px, takes ≈ 1–1.5 s per adjustment in Node, and turns the field failure (11 `?`) into 32/32.

## ADR-028 — Per-square diagnostics and labeled real samples

- **Decision:**
  - `RECOGNITION_RESULT` carries optional per-square diagnostics: reason, foreground fraction and occlusion. The board shows the reason for each `?` or low-confidence square, as a tooltip that is also read aloud.
  - After confirming a position, **"Baixar amostra rotulada"** exports a JSON with the camera frame (PNG), the calibration in frame pixels, the confirmed position (ground truth), the reading and the diagnostics.
  - `tests/integration/real-samples.spec.ts` replays every sample registered in `tests/fixtures/real-samples/` through the real worker pipeline. It fails on any confident wrong answer or on a regression below the recorded floor.
  - A dependency-free PNG codec for tests (`tests/fixtures/png.ts`, web `CompressionStream`) supports the harness.
- **Consequence:** recognition quality is measured on real boards, not only synthetic ones. Samples contain only the camera image of the board area, and the user decides whether to share them.

## ADR-029 — Playwright worker cap

- **Decision:** `workers: 4` locally and 2 in CI. With 8 parallel browsers each compiling OpenCV.js (17 MB), page navigation timed out under load; with 3–4 workers every run passed (52/52 over two repetitions).
