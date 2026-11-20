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

## ADR-030 — Staged recognition pipeline with per-square traces (G3)

- **Context:** the G3 audit found the E3 classifier hard to diagnose: one function mixed occupancy, color and king evidence, and the diagnostics carried only a reason and two numbers. The user's real-world test called for a visual, explainable diagnosis.
- **Decision:** `recognizeBoard` runs explicit stages: A frame assessment, B occupancy, C color (plus a board-level check), D piece type and E consolidation (`vision/recognition/stages/`). Occupancy is decided first, so color or king evidence can never spoil an "empty". Each square produces a serializable `SquareTrace`: regions, corner matches, every stage outcome, the key features, the limiting stage and a pt-BR explanation built from the same numbers and thresholds the stages used. `RECOGNITION_RESULT` carries `traces` and `frame` (the `FrameAssessment`) instead of E3's `diagnostics`. `square-classifier.ts` is removed; `square-regions.ts` is the single definition of the regions, used by the classifier and drawn by the UI.
- **Consequence:** every reading can be explained and inspected. The protocol change is internal: the client and the labeled-sample export were updated together, and older samples remain readable (`diagnostics` is `unknown[]`).

## ADR-031 — Background model and shadow-tolerant foreground (G3)

- **Context:** in real sample A, a neighbour's tall piece covered part of h8's corners, corrupting its median background, so h8 was `UNKNOWN`. Shadows on empty squares could read as foreground.
- **Decision:** each corner quadrant is a background candidate only if it matches the board's typical dark square (chromaticity ≤ 0.06, luminance/light ratio ±25 %). The background is the median of the matching corners; no match gives `ROI_OBSTRUCTED`. A disk pixel that keeps the background's chromaticity, with a luminance between 0.45× and 1.35× the background's, is the board in shadow or under glare, not foreground. The grid-alignment quality (Stage A) raises `CALIBRATION_MISALIGNED` below 0.5.
- **Consequence:** sample A reads 32/32, and sample D's shifted calibration is reported instead of silently degrading. A very dark shadow (×0.4) still gives `UNKNOWN`, which is safe.

## ADR-032 — Color consistency and piece-shaped occupancy (G3)

- **Context:** with the background model, a hand over the board could read as white pieces. Synthetic G3 scenarios showed a glare spot or a fingertip on an empty square reading as a white piece: an invented piece.
- **Decision:**
  - with ≥ 3 white pieces, a "white" whose body chromaticity departs by more than 0.05 from the median of the others is undetermined (`INCONSISTENT_PIECE_COLOR`, `UNEXPECTED_OBJECTS`);
  - an occupied disk must also cover its outer ring (0.7–1 × radius) at ≥ 50 %; otherwise it is `NOT_PIECE_SHAPED` → `UNKNOWN`.
  - The ring threshold comes from data: real pieces cover ≥ 58 % (minimum over the 5 real samples, 120 pieces), a centered glare spot of radius 0.26 s covers 49 % and a fingertip 38 %. The first value tried (80 %) was rejected because it turned real pieces into `UNKNOWN`.
- **Consequence:** no scenario in the EMPTY suite invents a piece, except a dark object of exactly piece size (documented limitation). The margin against a piece-sized glare spot is narrow, and it is documented.

## ADR-033 — King mark searched on the displaced top face (G3)

- **Context:** a G3 synthetic scenario with tall pieces (the model of the user's real set) showed **every king read as a man, confidently**. An oblique camera projects a tall piece's top face, where the mark is, away from the camera, by up to 0.6 square; E3 looked for the mark at the square center only. Dim light hid marks too (absolute luminance threshold).
- **Decision:** `top-face.ts`.
  - `awayFromCamera` derives the direction from the calibration: the far edge of the board is the shortest in the camera image. The worker computes it at `CALIBRATE`; it is null for a board seen from above.
  - `searchKingMark` searches along that line (0.7 s long, ± 0.22 s). A mark pixel must be bright relative to the local light, differ from the body's chromaticity, and not be explainable as a mix of two of {body, background, light square, neutral gray}. Coverage is the best compact concentration (a disk of 1.5 mark radii slid along the line), relative to the expected mark area.
  - **Validated on real data before adoption:** the first version (no blend rejection, no compactness) turned 40–70 % of the real men into kings, because of white/blue edge blends and bluish reflections on black pieces. It was rejected. The adopted version finds at most 0.04 of mark coverage on any of the 120 real men (threshold 0.4) and detects every synthetic king, tall or flat, in dim light and with noise.
- **Consequence:** kings are read on tall pieces seen obliquely. King accuracy on _real_ kings is not measured yet (no real sample has kings).

## ADR-034 — Diagnostic mode (G3)

- **Decision:** `PROCESS_FRAME { debug: true }` makes the worker return the rectified image as a transferred `ImageBitmap` next to the traces. The client closes late images, and the store closes the previous image when it is replaced, when diagnostics are turned off and when the page is destroyed. **Modo diagnóstico** on `/recognition` (`RecognitionDebugComponent`, presentational) draws the regions, corner matches and mark-search line of every square from the traces, colored by state. It shows the frame assessment and an inspector with stage outcomes, temporal votes and features next to their thresholds, and compares two squares with Shift + click. The calibration preview draws the classifier's piece disk and background radius instead of the E2 inset rectangle on dark squares.
- **Consequence:** the ROI shown is the ROI used. Without the debug flag nothing extra is computed or transferred.

## ADR-035 — Per-square temporal stabilization in G3; E5 untouched

- **Context:** spec §14 defines `stabilityWindowSize` and `stableObservationCount`, and the backlog places "stabilization / inference" in E5. ADR-025 said E3 classifies each frame independently. The G3 directive asked for temporal stabilization, and the user approved it in the G3 proposal: a per-square vote buffer in G3, with the stable-board detector and move inference left in E5.
- **Decision:** `vision/recognition/temporal/observation-stabilizer.ts`, used by `RecognitionStore`, keeps the last 5 usable frames per square.
  - A piece is accepted when ≥ 3 frames agree and it has twice the votes of every other known reading. Its confidence is the median (no boosting). `UNKNOWN` frames do not vote. A full window without consensus is `MANUAL`.
  - Blurry and badly exposed frames are skipped, and stale frames expire. The window resets on start, resume and corner adjustment.
  - It changes what the recognition page shows, not the per-frame contract.
- **Consequence:** this supersedes the "each frame independently" part of ADR-025. E5 (stable-board detection between moves, move inference, reconciliation) is not started.

## ADR-036 — Recognition metrics, EMPTY suite and dataset metadata (G3)

- **Decision:**
  - `vision/evaluation/recognition-metrics.ts` (pure) computes the confusion matrix, per-class precision/recall, UNKNOWN rate, occupancy false positives/negatives, color and type errors, per image and per condition. It formats a Markdown report.
  - `tests/integration/recognition-metrics.spec.ts` asserts the G3 targets on the real samples, as saved and after adjustment: zero confident errors, EMPTY precision ≥ 98 %, WHITE/BLACK recall ≥ 95 %. `npm run eval:recognition` (`scripts/eval-recognition.mjs`) regenerates `docs/vision/recognition-metrics.md`.
  - The report is written through `tests/fixtures/node-io.ts`, which types the two Node calls it needs instead of adding `@types/node` to the spec build.
  - `recognition-empty.spec.ts` asserts that no empty square is read as a piece across lighting, cast shadows, glare, fingertip, hand and phone scenarios.
  - The sample export takes optional condition tags (`SAMPLE_CONDITIONS`) and a description.
- **Consequence:** synthetic data are reported as regression only; the real samples are the evidence. No dependency was added and no version changed.

## ADR-037 — Brazilian checkers engine (E4)

- **Context:** spec §6 requires a pure TypeScript engine implementing the Brazilian 64-square rules, with the interpretations documented before implementation.
- **Decision:**
  - The rules adopted are written in `docs/engine/brazilian-checkers-rules.md`: men capture backwards, flying kings, mandatory capture with the majority rule (men and kings count the same), captured pieces removed at the end of the sequence and never jumped twice, promotion only when a move ends on the back row, White first.
  - `BrazilianCheckersEngine` (`domain/engine/`) implements the spec's `CheckersEngine`. It is stateless, validates every input board (`InvalidBoardError` with explicit issues) and never mutates its inputs. `applyMove` accepts only legal moves (`IllegalMoveError`); `simulateMove` deliberately skips legality, for move inference (E5).
  - A move is identified by `from`, `to` and the _set_ of captured squares (`moveKey`). Flying-king paths that capture the same pieces and land on the same square are listed once, and any of those paths validates.
  - `Move.path` includes `from` and `to`. `Move.id` is the move's notation (`c3-d4`, `c3xe5xc7`); `squareFromName` is the inverse of `squareName`.
  - `getResult(board, playerToMove)` sees one position, so it decides only wins (no pieces, no legal move). The draw rules need the history and live in `evaluateDraw(history)` (threefold repetition, 20 king-only plies, 5 moves each in the short endings). The game integration (E6) calls both, a win first.
  - Rule constants live in `domain/rules/brazilian-rules.ts`; `Move` in `domain/move`, `GameResult` in `domain/game` (spec §5 contracts).
- **Interpretations confirmed at Gate G4 (2026-11-19):** the counting unit of the 20-move and 5-move draw rules as documented; the "3 kings vs 1 on the main diagonal" ending stays unimplemented.
- **Consequence:** `npm run test:engine` runs the engine suite on its own (Gate G4). It covers every spec §6 fixture, plus 40 seeded random games checking invariants after every move.

## ADR-038 — Stabilization and move inference in the domain (E5)

- **Context:** spec §8 infers a move by comparing the outcomes of the legal moves with a stable observed board; E5 delivers it before game integration (E6).
- **Decision:**
  - `domain/move/` (pure TypeScript): `ObservationWindow` (bounded, drops stale frames), `StableBoardDetector` (identical boards over a minimum time; new once), `compareObservedBoard` (UNKNOWN is uncertainty), `inferMove` (classifies candidates as EXACT, PENDING_REMOVAL, OCCLUDED or PARTIAL, then resolves), `reconcileObservation` (after a commit) and `MoveTracker` (one inference per position and stable board).
  - Only a single exact, confident candidate is `MATCHED`. Pending captures, occlusion and a piece in the hand wait; partial or low-confidence matches ask the user; anything else is `NO_MATCH` → reconciliation.
  - Two situations found while designing the tests became explicit rules: a piece in the hand (`PIECES_REMOVED_ONLY`, wait instead of `NO_MATCH`) and a promotion whose crown is not placed yet (`PROMOTION_NOT_MARKED`, the move still matches; reconciliation reports `PENDING_PROMOTION_MARK`).
  - `MoveCandidate` extends the spec's fields with the match class, pending/unknown squares, the confidence of the changed squares and `promotionUnmarked`. `MoveInferenceResult.warnings` uses typed codes.
  - The app chain runs the G3 per-square stabilizer, then the detector with `PIPELINE_INFERENCE_CONFIG` (2 identical boards over 200 ms). The generic defaults (3 over 500 ms) double the latency on already-consolidated input: 1.2 s and 11 missed moves out of 1,356, against 0.8 s and none, both with zero false commits.
- **Consequence:** the Gate G5 test plays 1,356 synthetic moves frame by frame with occlusion, lifted pieces, delayed capture removal and noise. Every move is inferred, with zero false commits and a median 0.8 s after the board settles. Committing, the game state machine and the UI remain E6.

## ADR-039 — Game integration: controller, commit protocol and recovery (E6)

- **Context:** E6 connects the confirmed position, the camera, move inference (E5) and the engine (E4) into a live game, following spec §8 (commit protocol, recovery), §10 (state ownership) and §12 (state machine). Persistence is E7.
- **Decision:**
  - **Pure domain:**
    - `domain/game/game-session.ts`: `validateInitialPosition` (E6-T02: no UNKNOWN, a valid board, both sides present; non-standard positions allowed, with the player to move chosen), `commitMove` (engine validation, `expectedPly` against duplicates, result: win first, then the history draws), `undoLastMove`, `correctPosition`, `endGame`.
    - `domain/game/game-state-machine.ts`: spec §12 as a transition table; the controller applies only transitions listed there.
    - `BoardProblem`: board problems as data, so the UI can word them in pt-BR.
  - **`GameSessionController`** (`core/app-state`, root) is the only owner of the authoritative session. Vision observations come in through `observe()`; every change is validated by the engine, persisted, and only then shown. A save failure keeps the previous session. Commits are serialized: a second commit while one is being saved is a duplicate and is refused.
  - **Persistence port:** `GAME_REPOSITORY` implements the spec §11 `GameRepository` / `PersistedGame`, plus `initialPlayer` and `adjustments`. Until E7 the implementation is in memory, so games are lost on reload and the live page says so; E7 replaces the provider behind the same token.
  - **Recorded adjustments:** undo and explicit position corrections are recorded in `GameSession.adjustments` (spec §8: authoritative position changes must be explicit and recorded). Undo is allowed back to the last correction only, where the history is exact (E6-T06 "undo only if robust"). After a correction, the history-based draw rules restart.
  - **Spec ambiguity resolved:** §12 says `MOVE_INFERENCE → MONITORING` on no match, while §8 says "if no legal outcome matches, enter reconciliation". A `NO_MATCH` returns to monitoring (the game is not blocked) and shows the discrepancy with its recovery options. `AMBIGUOUS` and partial or low-confidence matches enter `RECONCILIATION` and need the user's choice. A pending decision is resolved only by a confirmed move, by retrying, or by a fully visible board equal to the official one: UNKNOWN squares are no evidence.
  - **UI:**
    - `/recognition` gains "Iniciar partida" (player labels, side to move for non-standard positions).
    - `/game/:id` shows the official board, the camera with its reading, side to move, last move, history, status, controls (pause, undo, end by agreement or resignation) and `GameRecoveryComponent` (confirm a candidate, register a move by hand, correct the position explicitly).
    - `RecognitionStore.setLivePaused` pauses the camera with the game.
- **Consequence:** the engine is the only authority. Vision proposes moves; ambiguous, illegal or partial readings never change the game without the user. Gate G6 is covered by controller, page and Chromium E2E tests with deterministic observations.

## ADR-040 — IndexedDB persistence of games and settings (E7)

- **Context:** spec §11 defines the `games`, `calibrations` and `settings` stores and their repositories, with schema versioning, game state and moves persisted together, no video, and explicit storage failures. E6 used an in-memory game repository behind `GAME_REPOSITORY`.
- **Decision:**
  - **Schema v2** adds `games` (`id, updatedAt, status`) and `settings` (`key`) on top of v1 `calibrations`. A migration test opens a v1 database and checks the calibrations are kept. The optional `recognitionLogs` store is not created, because nothing needs it yet.
  - **Games:** `DexieGameRepository` (spec `GameRepository`) replaces the in-memory provider behind the same token; the in-memory class moved to `tests/fixtures` as a test double. A record embeds its moves and adjustments, so one put writes them atomically; `update` checks existence in a transaction.
  - **Settings:** `DexieSettingsRepository` (spec `SettingsRepository`, `AppSetting`) with typed keys (`SettingValues`). The only setting so far is the default player names, edited on `/settings` and prefilled at game start.
  - **Pages:** `/games` lists the saved games newest first, with status, result and number of moves, and lets you open, continue or delete one (two-step confirmation). The home page offers to continue the latest unfinished game, and `/game/:id` reloads a saved game.
  - **Failures:** every Dexie/IndexedDB failure becomes a `PersistenceError` with a pt-BR message, shown by the page. A failed commit keeps the previous game, both in memory and on disk.
- **Consequence:** Gate G7 is covered by:
  - repository tests on fake IndexedDB (round trip, ordering, quota, unavailable storage, migration);
  - controller tests across a simulated reload and with failures;
  - page tests;
  - an E2E that reloads the page in Chromium's real IndexedDB.

## ADR-041 — Release quality: production E2E, camera-move video, game statistics (E8)

- **Context:** E8 asks for E2E, physical tests, profiling, resource-leak tests, PWA/offline, an accessibility/responsive review and release docs; Gate G8 is a release candidate with measured results.
- **Decision:**
  - **Camera-detected moves (E8-T01):** `chromium-moves` plays a generated video of a game (the opening, then `c3-d4`, then `f6-e5`; 1 fps, about 50 MB, git-ignored). The whole chain must record both moves from the camera alone.
  - **Release specs (`*.release.spec.ts`, on the board video):**
    - resource soak: 6 navigation cycles through the camera pages, then no live track, no worker, and a flat main-thread heap after a forced GC (DevTools protocol);
    - a 30 s live game;
    - accessibility and responsiveness: every page at 375 and 1280 px; no horizontal scroll, one `h1`, accessible names from the Chromium accessibility tree, visible keyboard focus. The checker was verified to catch an injected unnamed button and an overflow.
  - **Production E2E (E8-T03/T05):** `playwright.prod.config.ts` builds the app and serves `dist/` with `scripts/serve-dist.mjs` (Node built-ins only, SPA fallback; no new dependency). `tests/e2e-prod` checks installability (manifest, icons, service worker) and offline use (open, calibrate, recognize with OpenCV.js from the cache). It also profiles and writes `docs/testing/performance.md`.
  - **Physical tests (E8-T02):** `docs/testing/physical-test-matrix.md` holds the procedure, scenarios P1–P14, targets and the results record. `gameStatistics` (moves by camera vs. manual, captures, promotions, undos, corrections) is shown in the history, and each game can be exported as JSON.
  - **Camera interruption:** the live page shows the camera error with **Reconectar câmera** (restarts camera and recognition). The game continues and moves can be entered by hand.
  - **Release docs:** README (user instructions), `docs/release/release-notes.md`, `docs/testing/release-review.md` (§21/§22 with evidence). Version `0.1.0-rc.1`.
- **Not done:** the `typescript-eslint` update that would clear 7 moderate dev-only audit findings (needs approval); real-device and physical measurements (the user's sessions).
