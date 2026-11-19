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
- No backend/cloud inference in MVP.
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

| Purpose                     | Command                                            |
| --------------------------- | -------------------------------------------------- |
| Dev server (localhost:4200) | `npm start`                                        |
| Unit + integration tests    | `npm test` (Vitest via `@angular/build:unit-test`) |
| Tests in watch mode         | `npm run test:watch`                               |
| Lint (incl. boundary rules) | `npm run lint`                                     |
| Format / check format       | `npm run format` / `npm run format:check`          |
| Production build            | `npm run build` (output `dist/damas-vision/`)      |
| E2E (Playwright, Chromium)  | `npm run e2e` (starts `ng serve` on port 4300)     |
| Full validation             | `npm run validate` (lint, format, test, build)     |

First-time E2E setup: `npx playwright install chromium`.

## Environment and versions

- Node 26.13.1 (`.nvmrc`), npm 11.20.0. `engines` mirrors Angular's supported Node range.
- Angular 22.3.0, TypeScript 6.0.3, Tailwind 4.3.5, Vitest 5.1.1, Playwright 1.65.1, ESLint 10.15.0 + angular-eslint 22.8.0.
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
- `src/app/core/workers/**` — worker protocol/client (the only place that creates `Worker`s).
- `src/app/core/persistence/**` — repositories and DB schema (the only place that touches IndexedDB/Dexie).
- `src/app/core/app-state/**` — application-level state services.
- `src/app/features/**` — UI and orchestration; no OpenCV, IndexedDB, `Worker` or camera APIs directly.
- `src/app/shared/**` — reusable UI only; must not import `features` or `core`.
- `core/**` must not import `features/**`.

If a rule blocks legitimate work, raise it instead of disabling it inline.

## Current status

- G0 approved (2026-11-19).
- E1 — Camera implemented. **Gate G1 awaiting approval.** Do not start E2 (calibration) or any later epic until the user approves G1.
- Camera/capture tests use the fakes in `tests/fixtures/` (`FakeMediaDevices`, `FakeFrameSource`); E2E uses Chromium's synthetic camera flags in `playwright.config.ts`. Assert "no live tracks" after every lifecycle change.
- Backlog and gate status: `docs/backlog/implementation-backlog.md`.
