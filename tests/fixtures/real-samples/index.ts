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
  /** Capture conditions (labeled-sample `SAMPLE_CONDITIONS`), for the per-condition metrics. */
  readonly conditions: readonly string[];
}

/** All five samples: starting position, daylight from a window, oblique camera. */
const START_DAYLIGHT = ['LUZ_NATURAL', 'MUITAS_PECAS'] as const;

/**
 * Real samples replayed by tests/integration/real-samples.spec.ts (see README.md).
 * Blue/cream board, tall grooved pieces, oblique camera, daylight — 2026-11-19.
 * Sample A: the exported label for h8 said WHITE; the frame shows a black man, so the
 * label was corrected to BLACK. Before G3 its h8 was UNKNOWN (blurred far corner); the G3
 * background model reads it correctly. Sample D's saved calibration is shifted: it raises
 * CALIBRATION_MISALIGNED as saved, and is read correctly either way.
 * Floors are the current results (G3): every sample 32/32, no UNKNOWN.
 */
export const REAL_SAMPLES: readonly RegisteredSample[] = [
  {
    name: 'blue-board-start-a',
    sample: a as unknown as LabeledSample,
    minCorrect: 32,
    minCorrectRefined: 32,
    conditions: START_DAYLIGHT,
  },
  {
    name: 'blue-board-start-b',
    sample: b as unknown as LabeledSample,
    minCorrect: 32,
    minCorrectRefined: 32,
    conditions: START_DAYLIGHT,
  },
  {
    name: 'blue-board-start-c',
    sample: c as unknown as LabeledSample,
    minCorrect: 32,
    minCorrectRefined: 32,
    conditions: START_DAYLIGHT,
  },
  {
    name: 'blue-board-start-d',
    sample: d as unknown as LabeledSample,
    minCorrect: 32,
    minCorrectRefined: 32,
    conditions: START_DAYLIGHT,
  },
  {
    name: 'blue-board-start-e',
    sample: e as unknown as LabeledSample,
    minCorrect: 32,
    minCorrectRefined: 32,
    conditions: START_DAYLIGHT,
  },
];
