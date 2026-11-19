import {
  REAL_SET_BLUE_BOARD,
  random,
  renderCameraView,
  renderNormalizedBoard,
  RenderOptions,
  startingPosition,
} from '../../../tests/fixtures/synthetic-board';
import { CalibrationCorners, CORNER_NAMES } from '../domain/board/calibration';
import { distance } from '../domain/board/geometry';
import { gridScore, refineCorners, toGray } from './calibration-refinement';

const SOURCE = { width: 960, height: 540 };
/** True board corners in the camera image (oblique view: far edge shorter). */
const TRUE: CalibrationCorners = {
  topLeft: { x: 255, y: 70 },
  topRight: { x: 760, y: 68 },
  bottomRight: { x: 900, y: 500 },
  bottomLeft: { x: 125, y: 505 },
};

function frame(options: RenderOptions = REAL_SET_BLUE_BOARD) {
  return toGray(renderCameraView(renderNormalizedBoard(startingPosition(), options), TRUE, SOURCE));
}

function maxError(corners: CalibrationCorners): number {
  return Math.max(...CORNER_NAMES.map((name) => distance(corners[name], TRUE[name])));
}

function perturb(seed: number, amplitude: number): CalibrationCorners {
  const next = random(seed);
  const shift = (p: { x: number; y: number }) => ({
    x: p.x + (next() * 2 - 1) * amplitude,
    y: p.y + (next() * 2 - 1) * amplitude,
  });
  return {
    topLeft: shift(TRUE.topLeft),
    topRight: shift(TRUE.topRight),
    bottomRight: shift(TRUE.bottomRight),
    bottomLeft: shift(TRUE.bottomLeft),
  };
}

/** CPU-heavy search (~1 s alone); generous timeout for parallel runs. */
const REFINEMENT_TIMEOUT = { timeout: 30_000 };

describe('refineCorners', REFINEMENT_TIMEOUT, () => {
  const image = frame();

  it('scores the true grid higher than a misaligned one', () => {
    const insetTop = { ...TRUE, topLeft: { x: 265, y: 73 }, topRight: { x: 750, y: 71 } };

    expect(gridScore(image, TRUE)).toBeGreaterThan(gridScore(image, insetTop) * 1.2);
  });

  it('snaps top corners placed inside the board back onto the true corners', () => {
    const insetTop = { ...TRUE, topLeft: { x: 275, y: 76 }, topRight: { x: 740, y: 74 } };

    const result = refineCorners(image, insetTop);

    expect(maxError(result.corners)).toBeLessThan(2.5);
    expect(result.scoreAfter).toBeGreaterThan(result.scoreBefore);
  });

  it.each([1, 2, 3, 4, 5])('recovers from random errors of up to ±18 px (seed %i)', (seed) => {
    const result = refineCorners(image, perturb(seed, 18));

    expect(maxError(result.corners)).toBeLessThan(2.5);
  });

  it('keeps already-correct corners in place', () => {
    const result = refineCorners(image, TRUE);

    expect(maxError(result.corners)).toBeLessThan(1.5);
  });

  it('works on a noisy, unevenly lit frame', () => {
    const noisy = frame({ ...REAL_SET_BLUE_BOARD, noise: 12, gradient: [0.6, 1.1], seed: 9 });

    const result = refineCorners(noisy, perturb(7, 15));

    expect(maxError(result.corners)).toBeLessThan(3);
  });

  it('never moves a corner further than the allowed shift', () => {
    const far = perturb(11, 18);

    const result = refineCorners(image, far, {
      maxShiftSquares: 0.05,
      samplesPerLine: 48,
      minStepPx: 0.5,
    });

    // ≈ 0.05 × 63 px squares at the bottom corners.
    expect(result.maxShiftPx).toBeLessThan(4);
  });
});
