# Real labeled samples

Labeled samples exported from the recognition screen (**Baixar amostra rotulada**, after
**Confirmar posição**). Each JSON file holds one camera frame (PNG), the calibration, the
position confirmed by the user (ground truth) and what the recognizer read.

To add a sample:

1. Copy the `.json` file into this folder (keep the exported name, or rename it to describe
   the setup, e.g. `blue-board-window-light.json`).
2. Register it in `index.ts` with the minimum number of correct squares it must keep, both as
   saved and after the automatic corner adjustment (start with what it gets today; raise it
   as recognition improves).
3. Run `npm test`. `tests/integration/real-samples.spec.ts` replays every sample through the
   real worker pipeline (OpenCV.js) and fails on any confident wrong answer or regression.

The images show only the board and its surroundings; review them before committing.
