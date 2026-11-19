# Real labeled samples

Labeled samples exported from the recognition screen (**Baixar amostra rotulada**, after
**Confirmar posição**). Each JSON file holds one camera frame (PNG), the calibration, the
position confirmed by the user (ground truth) and what the recognizer read.

To add a sample:

1. Copy the `.json` file into this folder (keep the exported name, or rename it to describe
   the setup, e.g. `blue-board-window-light.json`).
2. Register it in `index.ts` with the minimum number of correct squares it must keep, both as
   saved and after the automatic corner adjustment (start with what it gets today; raise it
   as recognition improves), and its capture conditions (the sample's `conditions` if it was
   exported with tags, see `SAMPLE_CONDITIONS`).
3. Run `npm test`. `tests/integration/real-samples.spec.ts` replays every sample through the
   real worker pipeline (OpenCV.js) and fails on any confident wrong answer or regression;
   `recognition-metrics.spec.ts` checks the G3 targets over all samples.
4. Run `npm run eval:recognition` to regenerate `docs/vision/recognition-metrics.md`.

Most wanted next: kings, an empty or nearly empty board, artificial light, shadows, a hand
over the board and other camera angles.

The images show only the board and its surroundings; review them before committing.
