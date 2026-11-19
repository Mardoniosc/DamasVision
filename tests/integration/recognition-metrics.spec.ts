import { Piece } from '../../src/app/domain/board/piece';
import { createOpenCvLoader } from '../../src/app/vision/opencv-loader';
import {
  EvaluatedImage,
  evaluateRecognition,
  formatMetricsReport,
  RecognitionMetrics,
} from '../../src/app/vision/evaluation/recognition-metrics';
import { resolveClassifierConfig } from '../../src/app/vision/recognition/classifier.config';
import { recognizeBoard } from '../../src/app/vision/recognition/recognize-board';
import { DEFAULT_VISION_CONFIG } from '../../src/app/vision/vision.config';
import { environmentVariable, writeRepositoryFile } from '../fixtures/node-io';
import { REAL_SAMPLES } from '../fixtures/real-samples';
import { evaluateSample } from '../fixtures/sample-evaluation';
import {
  midgamePosition,
  REAL_SET_BLUE_BOARD,
  RenderOptions,
  renderNormalizedBoard,
  startingPosition,
} from '../fixtures/synthetic-board';

/**
 * G3 metrics (docs/vision/recognition-metrics.md). Real labeled samples are the evidence:
 * they are replayed through the real worker pipeline (OpenCV.js) and must meet the G3
 * targets. Synthetic scenarios are reported separately, as regression only.
 *
 * `npm run eval:recognition` regenerates the report (RECOGNITION_REPORT=1).
 */
const loadOpenCv = createOpenCvLoader();
const REPORT_PATH = 'docs/vision/recognition-metrics.md';

/** G3 targets (directive §12). */
const TARGETS = { emptyPrecision: 0.98, colorRecall: 0.95 };

const SYNTHETIC: readonly { name: string; position: () => Piece[]; options: RenderOptions }[] = [
  { name: 'wood, ideal, start', position: startingPosition, options: {} },
  { name: 'wood, ideal, mid-game + kings', position: midgamePosition, options: {} },
  { name: 'wood, dim', position: midgamePosition, options: { brightness: 0.55 } },
  { name: 'wood, bright', position: midgamePosition, options: { brightness: 1.2 } },
  { name: 'wood, gradient', position: startingPosition, options: { gradient: [0.6, 1.15] } },
  { name: 'wood, noise', position: midgamePosition, options: { noise: 10, seed: 3 } },
  { name: 'wood, off-center', position: startingPosition, options: { jitter: 0.08, seed: 5 } },
  {
    name: 'wood, local shadow',
    position: midgamePosition,
    options: { shadow: { x: 300, y: 420, radius: 220, factor: 0.6 } },
  },
  { name: 'wood, tall + kings', position: midgamePosition, options: { pieceHeight: 0.3 } },
  { name: 'blue model, start', position: startingPosition, options: REAL_SET_BLUE_BOARD },
  { name: 'blue model, kings', position: midgamePosition, options: REAL_SET_BLUE_BOARD },
  {
    name: 'blue model, kings, dim + noise',
    position: midgamePosition,
    options: { ...REAL_SET_BLUE_BOARD, brightness: 0.6, noise: 8 },
  },
];

function classMetric(metrics: RecognitionMetrics, label: Piece) {
  const found = metrics.classes.find((c) => c.label === label);
  if (!found) throw new Error(`no metrics for ${label}`);
  return found;
}

describe('G3 recognition metrics', { timeout: 120_000 }, () => {
  let saved: RecognitionMetrics;
  let refined: RecognitionMetrics;
  let synthetic: RecognitionMetrics;

  beforeAll(async () => {
    const asSaved: EvaluatedImage[] = [];
    const afterAdjustment: EvaluatedImage[] = [];
    for (const { name, sample, conditions } of REAL_SAMPLES) {
      const evaluation = await evaluateSample(sample, loadOpenCv);
      asSaved.push({
        name,
        conditions,
        labels: sample.labels,
        observed: evaluation.result.board.cells,
      });
      afterAdjustment.push({
        name,
        conditions,
        labels: sample.labels,
        observed: evaluation.refinedResult.board.cells,
      });
    }
    saved = evaluateRecognition(asSaved);
    refined = evaluateRecognition(afterAdjustment);

    const config = resolveClassifierConfig(DEFAULT_VISION_CONFIG);
    synthetic = evaluateRecognition(
      SYNTHETIC.map(({ name, position, options }) => {
        const labels = position();
        const { result } = recognizeBoard(renderNormalizedBoard(labels, options), config, {
          timestamp: 0,
          awayFromCamera: options.pieceHeight ? { x: 0, y: -1 } : null,
        });
        return { name, conditions: [], labels, observed: result.board.cells };
      }),
    );

    if (environmentVariable('RECOGNITION_REPORT') === '1') {
      await writeRepositoryFile(REPORT_PATH, report(saved, refined, synthetic));
    }
  }, 120_000);

  it.each([
    ['as saved', () => saved],
    ['after the automatic adjustment', () => refined],
  ] as const)('real samples (%s): no confident error, G3 targets met', (_label, metrics) => {
    const m = metrics();

    expect(m.errors).toEqual([]);
    expect(m.occupancy.falsePositives).toBe(0);
    expect(classMetric(m, 'EMPTY').precision).toBeGreaterThanOrEqual(TARGETS.emptyPrecision);
    expect(classMetric(m, 'WHITE').recall).toBeGreaterThanOrEqual(TARGETS.colorRecall);
    expect(classMetric(m, 'BLACK').recall).toBeGreaterThanOrEqual(TARGETS.colorRecall);
  });

  it('synthetic regression scenarios: no confident error', () => {
    expect(synthetic.errors).toEqual([]);
  });
});

function report(
  saved: RecognitionMetrics,
  refined: RecognitionMetrics,
  synthetic: RecognitionMetrics,
): string {
  return [
    '# Recognition metrics (G3)',
    '',
    '<!-- Generated by `npm run eval:recognition` (tests/integration/recognition-metrics.spec.ts). Do not edit by hand. -->',
    '',
    `Targets: EMPTY precision ≥ ${TARGETS.emptyPrecision * 100}%, WHITE/BLACK recall ≥ ${TARGETS.colorRecall * 100}%, zero confident errors. UNKNOWN is an abstention: it lowers recall, never precision.`,
    '',
    formatMetricsReport(saved, {
      title: 'Real samples — calibration as saved',
      source:
        'Evidence. Labeled frames exported from the app (tests/fixtures/real-samples), replayed through the real worker pipeline (OpenCV.js, single frame, no temporal stabilization).',
    }),
    formatMetricsReport(refined, {
      title: 'Real samples — after the automatic corner adjustment',
      source: 'Same frames, after REFINE_CALIBRATION (ADR-027).',
    }),
    formatMetricsReport(synthetic, {
      title: 'Synthetic regression scenarios (not evidence)',
      source:
        'Rendered boards (tests/fixtures/synthetic-board.ts). They guard known failure modes; they do not measure field accuracy.',
    }),
  ].join('\n');
}
