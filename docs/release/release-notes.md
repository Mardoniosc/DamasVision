# Release notes

## 0.1.0-rc.1 — release candidate (2026-11-20)

The first complete version of Damas Vision: a physical game of Brazilian checkers followed by a camera, entirely in the browser.

### What it does

- **Camera and calibration:**
  - camera selection and preview;
  - four-corner calibration with automatic corner adjustment, saved on the device;
  - perspective correction (OpenCV.js in a Web Worker).
- **Recognition:**
  - a staged classifier (occupancy, color, king mark on the displaced top face of tall pieces), with explicit `UNKNOWN`;
  - temporal consolidation per square;
  - a diagnostic mode that shows the regions used and explains every square;
  - manual correction of the initial position.
- **Rules engine:** Brazilian 64-square rules (men capture backwards, flying kings, mandatory capture with the majority rule, promotion at the end of a move, draw rules), pure TypeScript.
- **Move inference:** compares the outcomes of the legal moves with a stable board. It waits while a piece is in the hand, while captured pieces are still on the board or while the board is covered, and asks for a confirmation when the reading is ambiguous or partial.
- **Live game:**
  - official board, camera, history, pause, undo, end (agreement or resignation);
  - recovery: confirm, enter a move by hand, or correct the position, all recorded;
  - camera interruption and reconnection.
- **Persistence:** games, moves, calibrations and settings in IndexedDB; history with export; continue after a reload. No image is stored.
- **PWA:** installable; works offline after the first visit, camera recognition included.

### Measured (automated, 2026-11-19/20)

- **Real samples:** 5 frames (160 squares), 160 correct, 0 confident errors (`docs/vision/recognition-metrics.md`).
- **Synthetic move inference:** 1,356 moves played frame by frame, 1,356 inferred, 0 false commits, median 0.8 s after the board settles (`docs/vision/move-inference.md`).
- **Production build:**
  - initial bundle 278 kB;
  - first reliable reading 3–4 s after opening the recognition page (two runs);
  - 5 frames analysed per second;
  - main-thread heap stable (`docs/testing/performance.md`).
- **Tests:** unit, integration and E2E, including:
  - moves detected by the camera in Chromium with real OpenCV.js;
  - offline use of the production build;
  - resource-leak and accessibility checks.

### Known limitations

- **Physical test matrix not recorded yet:** real games, kings, artificial light, occlusion and other cameras and devices remain to be measured (`docs/testing/physical-test-matrix.md`).
- **Kings need a colored mark;** stacked or unmarked kings are read as men.
- **A dark object the size of a piece** on an empty square reads as a black piece.
- **Tested in desktop Chromium only.**
- **Dev-tooling audit:** `npm audit` reports 7 moderate issues in development tooling only (`typescript-eslint` → `minimatch`); production dependencies have none. Fixing them needs a tooling update, not done without approval.
