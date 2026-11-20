# Damas Vision

Local-first web application that follows a game of **Brazilian 64-square checkers** played on a physical board, through a camera. It recognizes the position, infers each move from stable observations and validates it with an independent TypeScript rules engine.

> Status: **release candidate 0.1.0-rc.1**. Epics E0–E8 are implemented, and the automated suites pass. The physical test matrix (real games on a real board) remains to be recorded: [docs/testing/physical-test-matrix.md](docs/testing/physical-test-matrix.md).

Principles:

- Vision observes; the engine decides.
- Uncertainty is explicit (`UNKNOWN`, confirmation requests); a false move is worse than a question.
- No cloud, no image upload: everything runs in the browser, and only positions and moves are stored. An optional Python recognizer can run on the same computer (below); frames never leave it.

## Using the app

1. **Nova partida.** Choose the camera and place it so it sees the whole board, from above or from one side.
2. **Calibração.** Drag the four corner handles onto the board's corners, press **Ajustar automaticamente**, then **Salvar calibração**.
3. **Reconhecimento.** Check the reading. Squares marked **?** could not be read safely.
   - **Modo diagnóstico** shows what the classifier sees and why.
   - **Pausar e corrigir** lets you fix any square; then **Confirmar posição**.
4. **Iniciar partida.** Enter the players' names; for a position other than the opening, choose who moves.
5. **Play.** Make one move at a time, and take your hand off the board.
   - The move appears on the official board when the camera sees the board still.
   - Remove captured pieces after the capture; crown a promoted piece with its mark.
   - Kings must carry a colored mark to be recognized as kings.
6. **When something does not match**, the **Correções** panel lets you:
   - confirm the move that was made;
   - register a move by hand;
   - read the board again;
   - correct the official position (this is recorded in the game).

   **Desfazer último lance**, **Pausar** and **Encerrar partida** (draw by agreement, resignation) are always available.

7. **Partidas** lists the saved games: continue, export (JSON) or delete. The home page offers to continue the latest unfinished game.

The app is a PWA: after the first visit it can be installed and works offline, camera recognition included.

## Requirements

- Node.js `^22.22.3 || ^24.15.0 || >=26.0.0` (developed on 26.13.1, see `.nvmrc`), npm 11.
- A browser with camera access, over `https://` or `http://localhost`. Tested in Chromium (desktop); other browsers and mobile devices are not tested yet (physical test matrix).

## Getting started

```bash
npm ci
npm start
```

Open http://localhost:4200.

## Scripts

| Command                    | What it does                                                                                  |
| -------------------------- | --------------------------------------------------------------------------------------------- |
| `npm start`                | Dev server on port 4200                                                                       |
| `npm test`                 | Unit + integration tests once (Vitest, jsdom)                                                 |
| `npm run test:watch`       | Tests in watch mode                                                                           |
| `npm run test:engine`      | Rules engine and move inference suite only (domain)                                           |
| `npm run lint`             | ESLint (TypeScript, templates, accessibility, layer boundaries)                               |
| `npm run format`           | Format with Prettier (`format:check` verifies)                                                |
| `npm run build`            | Production build to `dist/damas-vision/` (with service worker)                                |
| `npm run e2e`              | Playwright E2E in Chromium with synthetic cameras (dev server on 4300)                        |
| `npm run e2e:prod`         | E2E on the production build: PWA/offline and profiling (writes `docs/testing/performance.md`) |
| `npm run eval:recognition` | Recognition metrics on the real labeled samples (writes `docs/vision/recognition-metrics.md`) |
| `npm run validate`         | lint → format:check → test → build                                                            |

Before the first E2E run: `npx playwright install chromium`. The E2E setup generates synthetic camera videos in `tests/e2e/.generated/` (git-ignored, about 50 MB).

## PWA and production

The Angular service worker (`ngsw-config.json`) is registered only in production builds. It prefetches the whole app, including the OpenCV.js worker chunk (about 17 MB), so recognition works offline. To serve a build locally:

```bash
npm run build
node scripts/serve-dist.mjs 4400
```

Camera access requires a secure context: deploy behind HTTPS (any static host with SPA fallback to `index.html`).

## Optional local vision service (Python)

`vision-service/` is an alternative recognizer: Python + FastAPI + OpenCV on `127.0.0.1`, speaking the same protocol and giving the same answers as the browser recognizer (parity tests). Set it up with `npm run vision:setup`, run it with `npm run vision:serve`, and choose it in **Configurações → Reconhecimento**. Details: [vision-service/README.md](vision-service/README.md), [ADR-042](docs/architecture/decisions.md), [G3.1 report](docs/architecture/g3.1-report.md).

## Docker

`npm run docker:up` builds and starts the app and the vision service in containers; only `http://localhost:8092` is published. See [docs/release/docker.md](docs/release/docker.md).

## Project layout

```text
src/app/
  core/       camera, frame-capture, workers, persistence, app-state (services)
  domain/     pure TypeScript: board, engine (rules), move (inference), game (session)
  vision/     worker-side pipeline: OpenCV.js loader, perspective, recognition, evaluation
  features/   routed pages: home, camera (setup), calibration, recognition,
              live-game, game-history, settings
  shared/     reusable UI: components, directives, pipes, utilities
tests/        unit, integration, fixtures (incl. real samples), e2e, e2e-prod
docs/         specification, architecture, vision, engine, testing, release, backlog
```

Layer rules are enforced by ESLint; see [CLAUDE.md](CLAUDE.md#layer-ownership-enforced-by-eslintconfigjs).

## Documentation

- [Execution specification](docs/execution-specification.md) · [Release notes](docs/release/release-notes.md) · [Release review](docs/testing/release-review.md)
- [Architecture](docs/architecture/architecture.md) · [Decisions and versions](docs/architecture/decisions.md) · [Diagrams](docs/architecture/diagrams.md)
- [Calibration](docs/vision/calibration.md) · [Recognition](docs/vision/recognition.md) · [Recognition metrics](docs/vision/recognition-metrics.md) · [Move inference](docs/vision/move-inference.md)
- [Brazilian checkers rules](docs/engine/brazilian-checkers-rules.md)
- [Performance](docs/testing/performance.md) · [Physical test matrix](docs/testing/physical-test-matrix.md)
- [Implementation backlog](docs/backlog/implementation-backlog.md)
