import { LabeledSample } from '../../../src/app/features/recognition/labeled-sample';
import a from './blue-board-start-a.json';
import b from './blue-board-start-b.json';
import c from './blue-board-start-c.json';
import d from './blue-board-start-d.json';
import e from './blue-board-start-e.json';

export interface RegisteredSample {
  readonly name: string;
  readonly sample: LabeledSample;
  /** Regression floor: correct squares (of 32) with the calibration as saved. */
  readonly minCorrect: number;
  /** Regression floor after the automatic corner adjustment. */
  readonly minCorrectRefined: number;
}

/**
 * Real samples replayed by tests/integration/real-samples.spec.ts (see README.md).
 * Blue/cream board, tall grooved pieces, oblique camera, daylight — 2026-11-19.
 * Sample A: the exported label for h8 said WHITE; the frame shows a black man, so the
 * label was corrected to BLACK. Its h8 stays UNKNOWN (background chroma 0.073 vs the
 * 0.05 occlusion tolerance, because the far corner is blurred) — a safe answer.
 */
export const REAL_SAMPLES: readonly RegisteredSample[] = [
  {
    name: 'blue-board-start-a',
    sample: a as unknown as LabeledSample,
    minCorrect: 31,
    minCorrectRefined: 31,
  },
  {
    name: 'blue-board-start-b',
    sample: b as unknown as LabeledSample,
    minCorrect: 32,
    minCorrectRefined: 32,
  },
  {
    name: 'blue-board-start-c',
    sample: c as unknown as LabeledSample,
    minCorrect: 32,
    minCorrectRefined: 32,
  },
  {
    name: 'blue-board-start-d',
    sample: d as unknown as LabeledSample,
    minCorrect: 32,
    minCorrectRefined: 32,
  },
  {
    name: 'blue-board-start-e',
    sample: e as unknown as LabeledSample,
    minCorrect: 32,
    minCorrectRefined: 32,
  },
];
