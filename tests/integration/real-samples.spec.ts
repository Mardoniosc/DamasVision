import { CalibrationCorners } from '../../src/app/domain/board/calibration';
import {
  isLabeledSample,
  LABELED_SAMPLE_FORMAT,
  LabeledSample,
} from '../../src/app/features/recognition/labeled-sample';
import { createOpenCvLoader } from '../../src/app/vision/opencv-loader';
import { DEFAULT_VISION_CONFIG } from '../../src/app/vision/vision.config';
import { bytesToDataUrl, dataUrlToBytes, decodePng, encodePng } from '../fixtures/png';
import { REAL_SAMPLES } from '../fixtures/real-samples';
import { evaluateSample } from '../fixtures/sample-evaluation';
import {
  REAL_SET_BLUE_BOARD,
  renderCameraView,
  renderNormalizedBoard,
  startingPosition,
} from '../fixtures/synthetic-board';

/**
 * Validation on labeled samples (exported from the recognition screen). Real samples in
 * tests/fixtures/real-samples are replayed through the real worker pipeline; a synthetic
 * sample exercises the same format and harness so it stays correct while that folder grows.
 */
const loadOpenCv = createOpenCvLoader();

const SOURCE = { width: 960, height: 540 };
const TRUE: CalibrationCorners = {
  topLeft: { x: 255, y: 70 },
  topRight: { x: 760, y: 68 },
  bottomRight: { x: 900, y: 500 },
  bottomLeft: { x: 125, y: 505 },
};

async function syntheticSample(corners: CalibrationCorners): Promise<LabeledSample> {
  const labels = startingPosition();
  const frame = renderCameraView(
    renderNormalizedBoard(labels, {
      ...REAL_SET_BLUE_BOARD,
      pieceHeight: 0.1,
      pieceRadiusRatio: 0.42,
    }),
    TRUE,
    SOURCE,
  );
  const diagnostics: unknown[] = [];
  return {
    format: LABELED_SAMPLE_FORMAT,
    version: 1,
    createdAt: '2026-11-19T12:00:00.000Z',
    frame: { ...SOURCE, png: bytesToDataUrl(await encodePng(frame)) },
    calibration: { corners, orientation: 'NORMAL' },
    labels,
    recognized: { cells: labels, confidenceBySquare: labels.map(() => 1), diagnostics },
    visionConfig: DEFAULT_VISION_CONFIG,
  };
}

describe('labeled samples', { timeout: 30_000 }, () => {
  beforeAll(async () => {
    await loadOpenCv();
  }, 60_000);

  it('round-trips frames through the PNG codec', async () => {
    const frame = renderCameraView(renderNormalizedBoard(startingPosition()), TRUE, SOURCE);

    const decoded = await decodePng(dataUrlToBytes(bytesToDataUrl(await encodePng(frame))));

    expect(decoded.width).toBe(SOURCE.width);
    expect(Array.from(decoded.data.subarray(0, 4000))).toEqual(
      Array.from(frame.data.subarray(0, 4000)),
    );
  });

  it('validates the export format', async () => {
    const sample = await syntheticSample(TRUE);

    expect(isLabeledSample(sample)).toBe(true);
    expect(isLabeledSample({ ...sample, labels: sample.labels.slice(1) })).toBe(false);
    expect(isLabeledSample(JSON.parse(JSON.stringify(sample)))).toBe(true);
  });

  it('harness: a sample with imprecise far corners is fixed by the automatic adjustment', async () => {
    const handles = { ...TRUE, topLeft: { x: 268, y: 75 }, topRight: { x: 745, y: 73 } };

    const { score, refinedScore } = await evaluateSample(
      await syntheticSample(handles),
      loadOpenCv,
    );

    expect(score.wrong).toBe(0);
    expect(score.unknown).toBeGreaterThan(0);
    expect(refinedScore.errors).toEqual([]);
    expect(refinedScore.correct).toBe(32);
  });

  describe.each(REAL_SAMPLES.map((entry) => [entry.name, entry] as const))(
    'real sample %s',
    (_name, entry) => {
      it('is a valid labeled sample', () => {
        expect(isLabeledSample(entry.sample)).toBe(true);
      });

      it('produces no confident wrong answer and does not regress', async () => {
        const { score, refinedScore } = await evaluateSample(entry.sample, loadOpenCv);

        expect(score.errors, 'as saved').toEqual([]);
        expect(refinedScore.errors, 'after adjustment').toEqual([]);
        expect(score.correct).toBeGreaterThanOrEqual(entry.minCorrect);
        expect(refinedScore.correct).toBeGreaterThanOrEqual(entry.minCorrectRefined);
      });
    },
  );
});
