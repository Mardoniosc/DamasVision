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
| **G2** | Calibration and geometry validated                       | APPROVED (2026-11-19) |

## E3 — Recognition

| Task   | Description                                                                                                                                  | Status                |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| E3-T01 | Typed configuration                                                                                                                          | DONE                  |
| E3-T02 | ROI extraction                                                                                                                               | DONE                  |
| E3-T03 | Feature extraction                                                                                                                           | DONE                  |
| E3-T04 | Empty classification                                                                                                                         | DONE                  |
| E3-T05 | Piece color classification and UNKNOWN                                                                                                       | DONE                  |
| E3-T06 | King baseline (marked kings) / manual fallback                                                                                               | DONE                  |
| E3-T07 | Observation assembly / confidence / warnings                                                                                                 | DONE                  |
| E3-T08 | Recognition overlay and correction                                                                                                           | DONE                  |
| G3-R   | G3 refactor: staged pipeline, traces, diagnostic mode, top-face kings, piece-shaped occupancy, temporal stabilization, metrics (ADR-030–036) | DONE                  |
| **G3** | Measurable recognition and correction workflow                                                                                               | APPROVED (2026-11-19) |

## E4 — Engine

| Task   | Description                                                    | Status                |
| ------ | -------------------------------------------------------------- | --------------------- |
| E4-T01 | Board and coordinates (initial position, validation, notation) | DONE                  |
| E4-T02 | Regular-piece movement                                         | DONE                  |
| E4-T03 | Mandatory captures (men capture backwards)                     | DONE                  |
| E4-T04 | Multi-capture and majority rule                                | DONE                  |
| E4-T05 | Flying king movement and capture                               | DONE                  |
| E4-T06 | Promotion (including during a capture sequence)                | DONE                  |
| E4-T07 | Results and draw interpretation                                | DONE                  |
| E4-T08 | API and serialization                                          | DONE                  |
| **G4** | Rules engine test suite passes independently                   | APPROVED (2026-11-19) |

## E5 — Stabilization / inference

| Task   | Description                                   | Status                |
| ------ | --------------------------------------------- | --------------------- |
| E5-T01 | Bounded observation window                    | DONE                  |
| E5-T02 | Stable board detector                         | DONE                  |
| E5-T03 | Board difference utility                      | DONE                  |
| E5-T04 | Legal candidate simulation                    | DONE                  |
| E5-T05 | Candidate scoring and ambiguity               | DONE                  |
| E5-T06 | Capture reconciliation                        | DONE                  |
| E5-T07 | Idempotency / duplicate prevention            | DONE                  |
| **G5** | Synthetic observation tests infer legal moves | APPROVED (2026-11-19) |

## E6 — Game integration

| Task   | Description                                         | Status                |
| ------ | --------------------------------------------------- | --------------------- |
| E6-T01 | Game controller / state machine                     | DONE                  |
| E6-T02 | Initial position validation                         | DONE                  |
| E6-T03 | Commit protocol                                     | DONE                  |
| E6-T04 | Live UI                                             | DONE                  |
| E6-T05 | Recovery UI                                         | DONE                  |
| E6-T06 | Undo only if robust                                 | DONE                  |
| **G6** | End-to-end workflow with deterministic observations | APPROVED (2026-11-19) |

## Later epics

| Epic | Scope           | Gate | Status |
| ---- | --------------- | ---- | ------ |
| E7   | Persistence     | G7   | TODO   |
| E8   | Release quality | G8   | TODO   |

Task-level breakdown for E4–E8 is in the specification §17.
