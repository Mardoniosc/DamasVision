# Physical test matrix (E8-T02)

Requirements: `docs/execution-specification.md` §16 ("Physical test matrix", "Initial measured targets") and §22 ("Physical" release checklist).

The automated suites (unit, integration, E2E, synthetic and real labeled samples) validate the logic. Only real games on a real board measure the field rates. This document is the procedure and the record. **The results table is filled in by whoever runs the session; until then the physical part of Gate G8 is not measured.**

## Setup to record

For each session, note:

- the board and piece set (colours, piece height, how kings are marked);
- the camera (device, resolution) and its position (height, angle, side of the board);
- the light (daylight, lamp, mixed; direction);
- the app version (commit).

## Procedure

1. **Prepare.** Open **Configurações** and set the players' names (optional). Then open **Calibração**: mark the corners, use **Ajustar automaticamente**, and save.
2. **Initial position.** In **Reconhecimento**, check the reading (use **Modo diagnóstico** if needed), correct any `?`, then **Confirmar posição**.
   - Note the reading (`N de 32 casas corretas`).
   - Export a labeled sample (**Baixar amostra rotulada**), ticking the session's conditions.
3. **Play.** **Iniciar partida**, then play normally: one move at a time, hands off the board after each move.
   - When the app asks for a confirmation or reports a discrepancy, resolve it, and note the move and the message.
4. **Record.** When the game is over, open **Partidas** and **Exportar** the game. The line "Lances: N pela câmera · M manual(is)" gives the measured rates; the exported JSON keeps every move with its source (`VISION` or `MANUAL`) and every undo or correction.
5. **Samples.** For every scenario below, also export one or two labeled samples (step 2) with the matching condition tags. Add them to `tests/fixtures/real-samples/` and run `npm run eval:recognition` (see that folder's README).

## Scenarios

| #   | Scenario (spec §16)        | What to do                                                           | Pass when                                                                                      |
| --- | -------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| P1  | Bright light               | Lamp or direct daylight                                              | Initial reading ≥ 95 % correct; 0 confident errors                                             |
| P2  | Dim light                  | Evening, one weak lamp                                               | 0 confident errors; uncertain squares shown as `?`                                             |
| P3  | Shadows                    | A lamp to one side; a hand casting a shadow                          | Empty squares are never read as pieces                                                         |
| P4  | Angle and distance         | Camera low (oblique) and high (near top-down); near and far          | Calibration valid; reading as P1                                                               |
| P5  | Board relocation           | Nudge the board 1–2 cm during a game                                 | "calibração deslocada" warning, or `?` squares; **Reajustar cantos** recovers; no false move   |
| P6  | Slow and fast moves        | Hesitate with the piece in the hand; then move quickly               | No move registered while the piece is in the hand; each move registered once                   |
| P7  | Hand occlusion             | Leave the hand over the board after moving                           | Nothing registered until the hand leaves; then the right move                                  |
| P8  | Off-square piece           | Leave a piece half outside its square                                | `?` or a confirmation request; never a wrong move                                              |
| P9  | Capture with removal delay | Move the capturing piece, wait 2–3 s, then remove the captured piece | "Retire do tabuleiro as peças capturadas", then the capture is registered                      |
| P10 | Multi-capture              | A two- or three-piece capture                                        | Registered once, all captured pieces removed                                                   |
| P11 | Promotion                  | A man reaches the far row; crown it after a few seconds              | Registered as promotion ("coloque a marca de dama" until crowned)                              |
| P12 | Kings                      | Several king moves, including a flying capture                       | King moves registered (requires the colored mark, spec §7)                                     |
| P13 | Camera interruption        | Unplug or cover the camera, or switch apps (mobile), mid-game        | Clear message; moves can be entered by hand; the game is intact; the camera recovers on return |
| P14 | Reload                     | Reload the page mid-game, and close and reopen the browser           | The game reopens with all moves (**Continuar partida**)                                        |

## Targets (spec §16, initial — not guarantees)

| Measure                                  | Target                          | How it is measured                                             |
| ---------------------------------------- | ------------------------------- | -------------------------------------------------------------- |
| Square mapping after a valid calibration | 100 %                           | Diagnostic mode: the grid matches the squares                  |
| Piece classification (controlled light)  | ≥ 95 %                          | Initial reading `N de 32` and labeled samples (metrics report) |
| Simple-move inference                    | ≥ 95 % registered by the camera | Game statistics: simple moves by camera / simple moves         |
| Capture inference                        | ≥ 90 % registered by the camera | Game statistics: captures by camera / captures                 |
| False move commits                       | effectively 0                   | Moves later undone because they were wrong (note them)         |
| Confirmation latency                     | ≤ 1 s after the board is still  | Stopwatch or video; synthetic baseline 0.8 s                   |
| Recognition failure corrupting the game  | never                           | Every game's final position matches the physical board         |

## Results

_To be filled in during the physical sessions._

| Date | Session (board, camera, light) | Scenarios | Initial reading | Moves (camera / total) | Captures (camera / total) | False commits | Notes |
| ---- | ------------------------------ | --------- | --------------- | ---------------------- | ------------------------- | ------------- | ----- |
|      |                                |           |                 |                        |                           |               |       |

### Already measured

- **2026-11-19, blue/cream board, tall grooved pieces, oblique camera, daylight:** 5 real frames of the starting position, 160/160 squares correct, 0 confident errors (`docs/vision/recognition-metrics.md`). No game was recorded yet, and no kings, artificial light, occlusion or interruption were measured.
- **2026-11-20, same board and pieces, daylight, camera placed closer:** 2 real frames (the starting position and a game in progress, 12 against 12), 64/64 squares correct with both recognizers (browser and local service), 0 UNKNOWN, 0 confident errors. Still no kings, artificial light, occlusion or recorded game.
