# Calibration

Implements `docs/execution-specification.md` §5 (Geometry and calibration) and §7 (Perspective correction, Grid mapping). Epic E2.

## Board conventions (shared with the engine)

Defined in `src/app/domain/board/board.ts`:

- 8 × 8 board, linear index `row * 8 + column` (0–63); `row = 0` is the top of the normalized image, `column = 0` its left.
- Playable squares are the dark squares, where `row + column` is odd. Square (7, 0) — the bottom-left corner — is playable, which is the standard placement for Brazilian 64-square checkers (a dark square at each player's left hand).
- **Canonical orientation:** row 7 (bottom) is White's side and row 0 (top) is Black's side. This is provisional until the engine's movement direction is documented in E4 (`docs/engine/brazilian-checkers-rules.md`); calibration only needs a fixed convention.
- Calibration maps camera pixels to this canonical board; it never changes the engine's conventions.

## Workflow (`/calibration`)

1. The camera opens on entry (the device chosen in `/game/new` is reused) and is released on exit.
2. Four handles start as a centered square. The user drags them — or focuses one with Tab and moves it with the arrow keys (Shift = 10 px) — onto the outer corners of the playing area.
3. While the quad is valid, the projected 8 × 8 grid, green dots on the 32 playable squares and the **Brancas/Pretas** side labels are drawn over the live image.
4. **Girar 90°** cycles the orientation until the dots sit on the dark squares and _Brancas_ is on White's side.
5. **Ajustar automaticamente** snaps the handles to the actual square borders (ADR-027). Place the handles roughly on the corners first: each corner moves at most half a square. This matters most on the far edge, where the squares are small on screen.
6. **Gerar imagem normalizada** captures one frame, sends it to the vision worker, which warps it with OpenCV.js into an 800 × 800 image shown with the canonical grid, playable squares and their regions of interest (ROI).
7. **Salvar calibração** stores the profile in IndexedDB and marks it active; it is restored automatically next time.

## Orientation

Corners are stored as placed on the image (screen order: top-left, top-right, bottom-right, bottom-left). The canonical corners are derived with `canonicalCorners(corners, orientation)`: each 90° step moves the canonical top-left one corner clockwise on screen. A 90° or 270° step swaps which squares look dark, so the playable-square overlay immediately shows a wrong orientation (verified by `tests/integration/calibration-pipeline.spec.ts`).

## Validation

`validateCalibrationCorners` (domain, pure TS) runs live in the UI and again in the worker:

| Code                  | Rule                                                      |
| --------------------- | --------------------------------------------------------- |
| `INVALID_SOURCE_SIZE` | video size unknown or not positive                        |
| `INVALID_POINT`       | non-finite coordinate                                     |
| `OUT_OF_BOUNDS`       | a corner outside the image                                |
| `CORNERS_TOO_CLOSE`   | two corners closer than 5 % of the image diagonal         |
| `WRONG_ORDER`         | the quad is convex but counter-clockwise (mirrored)       |
| `NOT_CONVEX`          | concave, self-intersecting (bow-tie) or collinear corners |
| `AREA_TOO_SMALL`      | quad area below 4 % of the image                          |

Thresholds live in `DEFAULT_CORNER_VALIDATION` and are initial values to tune with physical tests.

## Perspective and grid

- `computePerspectiveTransform` uses OpenCV `getPerspectiveTransform`; `warpPerspective` uses `cv.warpPerspective` (bilinear, black border). Every `Mat` is released through `withResources`/`ResourceScope`.
- The overlay on the live image uses a pure-TS homography (`domain/board/homography.ts`) so it can follow the handles on the main thread without the worker. A unit test checks that it matches OpenCV to 6 decimal places.
- `createBoardGrid` produces the 64 `SquareGeometry` entries; `squareRoi` insets each square by `roiInsetRatio` (15 %) per edge.

## Persistence

`PersistedCalibration` (spec §11) in the `calibrations` store, schema v1 (`core/persistence/damas-vision.db.ts`). The profile records the source resolution; if the camera later delivers another resolution, the corners are scaled proportionally.

## Tests

- Unit: `domain/board/*.spec.ts`, `vision/*.spec.ts` (real OpenCV), `core/workers/*.spec.ts`, `core/persistence/*.spec.ts` (fake IndexedDB), `features/calibration/*.spec.ts`.
- Integration: `tests/integration/calibration-pipeline.spec.ts` — synthetic perspective board, all 64 squares mapped correctly.
- E2E: `tests/e2e/calibration.spec.ts` — real worker + OpenCV.js + IndexedDB in Chromium.
