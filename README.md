# Damas Vision

Local-first web application that observes a physical **Brazilian 64-square checkers** board through a camera, reconstructs the position, infers moves from stable observations and validates them with an independent TypeScript rules engine.

> Status: **E3 — Recognition** done (camera, calibration, OpenCV.js perspective correction, piece recognition with confidence/UNKNOWN, manual correction). The rules engine, move inference and game tracking are not implemented yet. See [the backlog](docs/backlog/implementation-backlog.md).

Principles: vision observes, the engine decides; uncertainty is explicit (`UNKNOWN`); no backend, no cloud inference, no image upload.

## Requirements

- Node.js `^22.22.3 || ^24.15.0 || >=26.0.0` (developed on 26.13.1, see `.nvmrc`)
- npm 11

## Getting started

```bash
npm ci
npm start
```

Open http://localhost:4200.

## Scripts

| Command                | What it does                                                    |
| ---------------------- | --------------------------------------------------------------- |
| `npm start`            | Dev server on port 4200                                         |
| `npm test`             | Unit + integration tests once (Vitest, jsdom)                   |
| `npm run test:watch`   | Tests in watch mode                                             |
| `npm run lint`         | ESLint (TypeScript, templates, accessibility, layer boundaries) |
| `npm run format`       | Format with Prettier                                            |
| `npm run format:check` | Verify formatting                                               |
| `npm run build`        | Production build to `dist/damas-vision/` (with service worker)  |
| `npm run e2e`          | Playwright E2E in Chromium (starts its own dev server on 4300)  |
| `npm run validate`     | lint → format:check → test → build                              |

Before the first E2E run: `npx playwright install chromium`.

## PWA

The Angular service worker (`ngsw-config.json`) is registered only in production builds. To try it locally, serve `dist/damas-vision/browser` over `http://localhost` or HTTPS with any static server.

## Project layout

```text
src/app/
  core/       camera, frame-capture, workers, persistence, app-state (services)
  domain/     pure TypeScript: board, game, move, rules, engine
  vision/     worker-side pipeline: OpenCV.js loader, perspective, recognition (no Angular/DOM)
  features/   routed pages: home, camera (setup), calibration, recognition,
              live-game, game-history, settings
  shared/     reusable UI: components, directives, pipes, utilities
tests/        unit, integration, fixtures, e2e
docs/         specification, architecture, vision, engine, testing, backlog
```

Layer rules are enforced by ESLint; see [CLAUDE.md](CLAUDE.md#layer-ownership-enforced-by-eslintconfigjs).

## Documentation

- [Execution specification](docs/execution-specification.md)
- [Architecture](docs/architecture/architecture.md) · [Decisions and versions](docs/architecture/decisions.md) · [Diagrams](docs/architecture/diagrams.md)
- [Calibration](docs/vision/calibration.md) · [Recognition](docs/vision/recognition.md)
- [Implementation backlog](docs/backlog/implementation-backlog.md)
