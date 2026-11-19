# Architecture decisions

Decisions and deviations from `docs/execution-specification.md`. Each entry states context, decision and consequence. Newest last.

## Exact versions (E0, 2026-11-19)

| Package                                 | Version      |
| --------------------------------------- | ------------ |
| Node.js (dev)                           | 26.13.1      |
| npm                                     | 11.20.0      |
| @angular/\* (core, router, build, cli…) | 22.3.0       |
| @angular/service-worker                 | 22.3.0       |
| TypeScript                              | 6.0.3        |
| RxJS                                    | 7.8.2        |
| tslib                                   | 2.9.1        |
| Tailwind CSS / @tailwindcss/postcss     | 4.3.5        |
| PostCSS                                 | 8.5.33       |
| Vitest                                  | 5.1.1        |
| jsdom                                   | 31.0.1       |
| @playwright/test                        | 1.65.1       |
| Chromium (Playwright headless shell)    | 159.0.8154.6 |
| ESLint                                  | 10.15.0      |
| @eslint/js                              | 10.0.1       |
| angular-eslint                          | 22.8.0       |
| typescript-eslint                       | 8.72.2       |
| Prettier                                | 3.10.1       |

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
