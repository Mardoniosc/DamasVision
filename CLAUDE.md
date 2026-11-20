# Damas Vision — Claude Code Instructions

Damas Vision is a local-first Angular application using camera vision to recognize a physical Brazilian 64-square checkers board and track a game. The independent TypeScript engine is the authoritative game state. Vision observes and infers; it must not mutate the game directly.

## Source of truth

- `docs/execution-specification.md` (copy of the delivered `Damas_Vision_Execution_Specification_v1.md`; both must stay identical)
- Architecture documents in `docs/architecture/` (`decisions.md` records every deviation and exact versions)
- Domain contracts and tests

If sources conflict, stop and report the conflict.

## Architecture

- Angular standalone, strict TypeScript, Tailwind.
- OpenCV.js MVP vision.
- Web Worker for non-trivial image processing.
- IndexedDB local persistence.
- No backend/cloud inference in MVP. Approved exception (ADR-042): the optional local vision service on 127.0.0.1; the browser recognizer stays the default.
- Pure TypeScript domain engine.
- Recognition never directly mutates game state.
- Moves inferred and validated against legal engine moves.
- UNKNOWN and reconciliation are first-class.

## Workflow

- Implement current task/gate only.
- Inspect before changing.
- Add tests.
- Run tests/lint/build and report actual results.
- Do not silently proceed across gates.
- No unrelated features or dependency upgrades.

## Quality

- No unexplained any.
- Cleanup camera streams, workers and OpenCV resources.
- Bounded frame processing; drop stale frames.
- Explicit recovery and errors.
- Thin components, focused modules.
- Document deviations.

## Commands

| Purpose                     | Command                                                                                                                                                                     |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dev server (localhost:4200) | `npm start`                                                                                                                                                                 |
| Unit + integration tests    | `npm test` (Vitest via `@angular/build:unit-test`)                                                                                                                          |
| Engine test suite (G4)      | `npm run test:engine` (domain specs only)                                                                                                                                   |
| Tests in watch mode         | `npm run test:watch`                                                                                                                                                        |
| Lint (incl. boundary rules) | `npm run lint`                                                                                                                                                              |
| Format / check format       | `npm run format` / `npm run format:check`                                                                                                                                   |
| Production build            | `npm run build` (output `dist/damas-vision/`)                                                                                                                               |
| E2E (Playwright, Chromium)  | `npm run e2e` (starts `ng serve` on port 4300)                                                                                                                              |
| Full validation             | `npm run validate` (lint, format, test, build)                                                                                                                              |
| E2E on the production build | `npm run e2e:prod` (PWA/offline, profiling → `docs/testing/performance.md`)                                                                                                 |
| Local vision service        | `npm run vision:setup` once, then `npm run vision:serve`; tests `npm run vision:test`; metrics `npm run vision:eval`; E2E `npm run e2e:service`; all `npm run validate:all` |
| Recognition metrics report  | `npm run eval:recognition` (real samples → `docs/vision/recognition-metrics.md`)                                                                                            |

First-time E2E setup: `npx playwright install chromium`.

## Environment and versions

- Node 26.13.1 (`.nvmrc`), npm 11.20.0. `engines` mirrors Angular's supported Node range.
- Angular 22.3.0, TypeScript 6.0.3, Tailwind 4.3.5, Vitest 5.1.1, Playwright 1.65.1, ESLint 10.15.0 + angular-eslint 22.8.0, OpenCV.js 5.0.0 (`@techstark/opencv-js@5.0.0-release.1`), Dexie 4.4.7.
- Versions are pinned exactly (`.npmrc` has `save-exact=true`). Never upgrade a major version without approval; record any version change in `docs/architecture/decisions.md`.
- Use the project-local CLI (`npx ng ...`); the global CLI may be an older, incompatible major.

## Repository conventions

- File naming follows the Angular **2016** style guide (`*.component.ts`, `*.service.ts`), matching the spec's `app.component.ts`.
- Applications are zoneless; components default to OnPush in Angular 22. Use signals for UI state, RxJS only where streams are genuinely useful.
- Feature routes are lazy (`loadComponent`) and declared in `src/app/app.routes.ts`. UI text is pt-BR; code, comments and docs are English.
- Unit tests live next to the code (`*.spec.ts`) or in `tests/unit/`; integration tests in `tests/integration/`; deterministic fixtures in `tests/fixtures/`; E2E in `tests/e2e/`.
- Centralize thresholds and tunable values in typed config; no magic numbers.

## Layer ownership (enforced by `eslint.config.js`)

- `src/app/domain/**` — pure TypeScript. No `@angular/*`, RxJS, browser globals, OpenCV, Dexie/IndexedDB, nor imports from `core`, `features` or `shared`.
- `src/app/core/camera/**` — camera lifecycle (the only place allowed to touch `navigator.mediaDevices`).
- `src/app/core/frame-capture/**` — frame scheduling.
- `src/app/core/workers/**` — worker protocol, worker entry/handler and client (the only place that creates `Worker`s).
- `src/app/vision/**` — worker-side pipeline (pure TS + OpenCV). May import only `domain/**`; no Angular, RxJS, Dexie or DOM globals. The **only** place allowed to import `@techstark/opencv-js`.
- `vision-service/**` — the optional Python service (ADR-042): observation only; no rules, moves or game state. Bound to 127.0.0.1. Not linted by ESLint.
- `src/app/core/persistence/**` — repositories and DB schema (the only place that touches IndexedDB/Dexie).
- `src/app/core/app-state/**` — application-level state services.
- `src/app/features/**` — UI and orchestration (feature stores allowed); no OpenCV, IndexedDB, `Worker` or camera APIs directly.
- `src/app/shared/**` — reusable UI only; must not import `features` or `core`.
- `core/**` must not import `features/**`.

If a rule blocks legitimate work, raise it instead of disabling it inline.

## OpenCV.js pitfalls (see ADR-016)

- Never `await`, return from an async function, or resolve a Promise with the raw OpenCV module object: it is (or inherits from) a Promise and breaks Promise resolution. Load it only through `createOpenCvLoader()`.
- Create every `Mat`/OpenCV object inside `withResources` (`vision/resource-scope.ts`) or delete it in `finally`.
- Bitmaps sent to the worker are transferred; the worker closes every bitmap it receives and the client closes late results.
- The production build takes ~1 min because of the 13 MB OpenCV file; the dev server excludes it from Vite pre-bundling.

## Current status

- G0–G6 approved (2026-11-19); G7 and G8 approved (2026-11-20). All epics of the specification are done; the app is release candidate `0.1.0-rc.1`.
- **G3.1 — Optional local vision service (Python + FastAPI + OpenCV), ADR-042:** the user chose the hybrid option and approved the design on 2026-11-20 (deviation from spec principle 7: local, optional, non-cloud). Implemented: `vision-service/` (see its README), the remote worker and provider in `core/workers`, the recognizer choice in the settings. The browser recognizer stays the default. G3.1 approved (2026-11-20, `docs/architecture/g3.1-report.md`); the reported UNKNOWN on empty squares is still not reproduced on real samples (7 frames), so no threshold was changed. The service must keep parity with the browser recognizer: any classifier change goes to both `src/app/vision/recognition` and `vision-service/src/damas_vision_service/recognition`, then `npm run vision:test` (parity) and `npm run vision:eval`.
- E3 — Recognition implemented and refactored in G3 (ADR-030–036). G3 approved without further real samples: real kings, empty boards, artificial light and obstruction are still unmeasured (see `docs/vision/recognition.md`, Known limitations). G3 committed (`f13fa4e`).
- E4 — Engine implemented (`domain/engine/`, rules in `docs/engine/brazilian-checkers-rules.md`, ADR-037). G4 approved, with the draw-rule interpretations confirmed as documented. E4 committed (`4a0b692`).
- E5 — Stabilization and move inference implemented (`domain/move/`, `docs/vision/move-inference.md`, ADR-038). G5 approved; committed (`2e10692`).
- E6 — Game integration implemented (`core/app-state/game-session.controller.ts`, `domain/game/`, `/game/:id`, ADR-039). G6 approved; committed (`368afc2`).
- E7 — Persistence implemented (schema v2, `DexieGameRepository`, settings, `/games`, reload, ADR-040). G7 approved; committed (`eabecfd`).
- E8 — Release quality implemented (camera-move E2E, release specs, production E2E/PWA/profiling, physical test procedure, release docs; ADR-041). G8 approved as a release candidate on the automated measurements. The physical test matrix results are still to be recorded by the user (`docs/testing/physical-test-matrix.md`); they decide the final release. The `typescript-eslint` update (7 moderate dev-only audit findings) still needs approval.
- Only `GameSessionController` changes the authoritative session, always through the engine-validated functions in `domain/game/game-session.ts`, and it persists before showing a change. Games are stored in IndexedDB (`GAME_REPOSITORY` → `DexieGameRepository`); specs that do not test persistence provide `tests/fixtures/in-memory-game-repository.ts`.
- Move inference must never commit a wrong move: `tests/integration/move-inference.spec.ts` must keep zero false commits; the app chain uses `PIPELINE_INFERENCE_CONFIG` on G3-stabilized observations.
- Engine changes must keep `npm run test:engine` green; every rule change needs a fixture in `src/app/domain/engine/*.spec.ts` and an update to the rules document.
- Recognition must never produce a confident wrong answer: any classifier change must keep `tests/integration/recognition-accuracy.spec.ts`, `recognition-empty.spec.ts`, `recognition-pipeline.spec.ts`, `real-samples.spec.ts` and `recognition-metrics.spec.ts` at zero confident errors; add a scenario for every new failure mode found. Validate every threshold change on the real samples (`tests/fixtures/real-samples`), not only on synthetic boards, and regenerate `docs/vision/recognition-metrics.md` with `npm run eval:recognition`.
- Synthetic boards rendered with `pieceHeight` must pass `awayFromCamera: { x: 0, y: -1 }` to `recognizeBoard` (the worker derives it from the calibration).
- Test doubles live in `tests/fixtures/`: `FakeMediaDevices`, `FakeFrameSource`, `FakeVisionWorker`, `InMemoryCalibrationRepository`, `synthetic-board.ts` (deterministic board renderer + `scoreRecognition`), `recognition-results.ts`. Specs that need OpenCV load the real bundled build. E2E uses Chromium's synthetic camera (`playwright.config.ts`; project `chromium-board` plays a generated board video for `*recognition.spec.ts`) and `tests/e2e/support/media-probe.ts`; assert "no live tracks" after every lifecycle change.
- Backlog and gate status: `docs/backlog/implementation-backlog.md`.
