# Implementation backlog

Source: `docs/execution-specification.md` §17. Status values: `TODO`, `DONE`, `AWAITING APPROVAL`, `APPROVED`.

## E0 — Foundation

| Task   | Description                                                                                 | Status                |
| ------ | ------------------------------------------------------------------------------------------- | --------------------- |
| E0-T01 | Scaffold: Angular standalone, strict TS, Tailwind, lint/format, tests, PWA baseline, README | DONE                  |
| E0-T02 | Shell/routes: folder structure, lazy routes, shell                                          | DONE                  |
| E0-T03 | Validation scripts / CI baseline: build, test, lint, E2E placeholder                        | DONE                  |
| **G0** | Foundation validated                                                                        | APPROVED (2026-11-19) |

## E1 — Camera

| Task   | Description                                                         | Status                |
| ------ | ------------------------------------------------------------------- | --------------------- |
| E1-T01 | Device discovery: enumerate devices, permission-label behavior      | DONE                  |
| E1-T02 | Lifecycle: start/stop/select, permission/errors, cleanup            | DONE                  |
| E1-T03 | Preview/status UI                                                   | DONE                  |
| E1-T04 | Frame scheduler: bounded in-flight frames, drop stale, pause/resume | DONE                  |
| **G1** | Camera lifecycle stable, no leaked streams                          | APPROVED (2026-11-19) |

## E2 — Calibration

| Task   | Description                                              | Status                |
| ------ | -------------------------------------------------------- | --------------------- |
| E2-T01 | Corner-selection UI: drag, edit (keyboard), reset        | DONE                  |
| E2-T02 | Validation: bounds, distinctness, area, convexity, order | DONE                  |
| E2-T03 | OpenCV loader / resource management                      | DONE                  |
| E2-T04 | Perspective transform                                    | DONE                  |
| E2-T05 | Grid mapper and playable-square overlay                  | DONE                  |
| E2-T06 | Persist calibration                                      | DONE                  |
| **G2** | Calibration and geometry validated                       | **AWAITING APPROVAL** |

## Later epics

| Epic | Scope                     | Gate | Status |
| ---- | ------------------------- | ---- | ------ |
| E3   | Recognition               | G3   | TODO   |
| E4   | Engine (Brazilian rules)  | G4   | TODO   |
| E5   | Stabilization / inference | G5   | TODO   |
| E6   | Game integration          | G6   | TODO   |
| E7   | Persistence               | G7   | TODO   |
| E8   | Release quality           | G8   | TODO   |

Task-level breakdown for E3–E8 is in the specification §17.
