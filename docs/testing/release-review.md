# Release review (E8, Gate G8)

Release candidate **0.1.0-rc.1**, reviewed 2026-11-20 against the spec's definition of done (§21) and release checklist (§22). Evidence links point to the test or document that shows each item; "pending" items need the physical test sessions (`physical-test-matrix.md`).

## Definition of done (§21)

| Item                                                    | Status                                     | Evidence                                                                         |
| ------------------------------------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------- |
| Camera can be selected and started                      | Done                                       | `tests/e2e/camera.spec.ts`                                                       |
| Four corners can be calibrated                          | Done                                       | `tests/e2e/calibration.spec.ts`                                                  |
| Perspective correction and grid mapping work            | Done                                       | `tests/integration/calibration-pipeline.spec.ts`, diagnostic mode                |
| Initial board recognized or manually corrected          | Done                                       | `tests/e2e/recognition.spec.ts`, real samples                                    |
| Engine implements documented Brazilian rules            | Done                                       | `npm run test:engine`, `docs/engine/brazilian-checkers-rules.md` (G4)            |
| Stable observations are produced                        | Done                                       | `src/app/domain/move/stabilization.spec.ts`, G3 stabilizer                       |
| Legal physical moves are inferred                       | Done (synthetic and E2E); physical pending | `tests/integration/move-inference.spec.ts`, `tests/e2e/camera-moves.spec.ts`     |
| Moves validated by engine                               | Done                                       | `commitMove` (engine validation), controller tests                               |
| Capture and multi-capture reconciled                    | Done (synthetic); physical pending         | inference and reconciliation tests (E5)                                          |
| Promotion handled                                       | Done (synthetic); physical pending         | engine, inference (`PROMOTION_NOT_MARKED`), reconciliation                       |
| Recognition failures cannot corrupt authoritative state | Done                                       | only `GameSessionController` changes the game; zero false commits on 1,356 moves |
| User can correct mismatch                               | Done                                       | recovery UI tests, `tests/e2e/live-game.spec.ts`                                 |
| Games and moves persist                                 | Done                                       | `game.repository.spec.ts`, `game-persistence.spec.ts` (G7)                       |
| Reload/recovery tested                                  | Done                                       | `tests/e2e/live-game.spec.ts` (reload), camera reconnection test                 |
| Unit/integration/E2E results documented                 | Done                                       | this review, `performance.md`, `recognition-metrics.md`, `move-inference.md`     |
| Physical test matrix recorded                           | **Pending**                                | `physical-test-matrix.md` — procedure ready, results to record                   |
| PWA/offline behavior tested on supported devices        | Partial                                    | `tests/e2e-prod/pwa.spec.ts` (desktop Chromium); real devices pending            |
| Resource cleanup/performance verified                   | Done                                       | `tests/e2e/resources.release.spec.ts`, `tests/e2e-prod/profile.spec.ts`          |
| README and user instructions complete                   | Done                                       | `README.md`, `release-notes.md`                                                  |

## Release checklist (§22)

**Engineering**

- Build, tests, lint, format: `npm run validate` and `npm run e2e`, `npm run e2e:prod` — all green (see the Gate G8 report).
- **Dependencies reviewed:** versions pinned (`save-exact`); production dependencies have 0 known vulnerabilities (`npm audit --omit=dev`). Dev tooling has 7 moderate ones (`typescript-eslint` → `minimatch` ReDoS, not shipped); fixing them needs a tooling update, left for approval.
- **Resource cleanup:**
  - camera tracks and workers are released on every page exit, over 6 cycles;
  - the main-thread heap stays flat (7.3 → 7.8 MB over 6 cycles; +0.4 MB in a 30 s live game);
  - bitmaps are closed (unit tests).
- **Migrations:** schema v1 → v2 tested.
- **No critical issues known.**

**Functional:** calibration, recognition, correction, engine validation, captures, promotion, history and recovery are covered by the automated suites listed above.

**Physical:** lighting, angles, real captures, multi-captures, kings, occlusion and camera interruption are **pending** (matrix scenarios P1–P14). Camera interruption is also covered with a fake camera.

**PWA:**

- installable (manifest with 192/512 icons, service worker) and offline (opens, calibrates, recognizes) — production build, desktop Chromium;
- HTTPS deployment and other browsers and devices are pending.

## Accessibility and responsiveness (E8-T06)

**Automated** (`tests/e2e/accessibility.release.spec.ts`), every page at 375 px and 1280 px wide, including recognition with the diagnostic panel and the live game:

- no horizontal scrolling;
- one `h1`;
- every button, link, form field and image has an accessible name;
- Tab reaches the controls with a visible focus indicator.

**Manual review:**

- **Contrast:** body text `stone-600` on white ≈ 7.6:1 and secondary `stone-500` ≈ 4.8:1 meet WCAG AA. Status colours (`amber-800` on `amber-50`, `red-800` on `red-50`, `brand-700` on white) are all above 4.5:1.
- **Status and errors:** announced through `role="status"` / `role="alert"`; the board's squares are buttons with descriptive names; the diagnostic squares are keyboard-focusable.
- **Not reviewed:** a real screen reader session (NVDA/VoiceOver) and touch use on phones — to do with the physical sessions.

## Gate G8 — what "measured" means here

**G8 approved on 2026-11-20** as a release candidate, on the automated measurements below.

- **Measured automatically:** recognition on real samples, move inference on synthetic sequences, camera-detected moves in the browser, performance, resource use, offline, accessibility basics.
- **Not measured:** field rates on real games (physical matrix). The release candidate is ready for those sessions; their results decide the final release.
