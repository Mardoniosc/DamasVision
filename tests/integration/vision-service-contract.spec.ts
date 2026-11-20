import { createVisionWorkerHandler } from '../../src/app/core/workers/vision-worker.handler';
import {
  isBoardRecognitionResult,
  isFrameAssessment,
  isSquareTraces,
  VisionWorkerResponse,
} from '../../src/app/core/workers/vision-worker.protocol';
import { canonicalCorners, CalibrationCorners } from '../../src/app/domain/board/calibration';
import { createOpenCvLoader } from '../../src/app/vision/opencv-loader';
import { RgbaImage } from '../../src/app/vision/perspective';
import { DEFAULT_VISION_CONFIG } from '../../src/app/vision/vision.config';
import { fakeBitmap, FakeBitmap } from '../fixtures/fake-frames';
import { environmentVariable, readRepositoryFile, writeRepositoryFile } from '../fixtures/node-io';
import { bytesToDataUrl, dataUrlToBytes, decodePng, encodePng } from '../fixtures/png';
import { EMPTY_SCENARIOS } from '../fixtures/empty-scenarios';
import { renderNormalizedBoard } from '../fixtures/synthetic-board';
import { SYNTHETIC_SCENARIOS } from '../fixtures/synthetic-scenarios';
import { resolveClassifierConfig } from '../../src/app/vision/recognition/classifier.config';
import { recognizeBoard } from '../../src/app/vision/recognition/recognize-board';
import { REAL_SAMPLES } from '../fixtures/real-samples';

/**
 * Contract between the browser recognizer and the optional local vision service (G3.1,
 * ADR-042). The browser pipeline is the reference:
 *
 * - `tests/fixtures/contract/default-vision-config.json` is the config the app sends to the
 *   service (`VisionConfig`, thresholds included). The service has no threshold defaults of
 *   its own: its tests load this file.
 * - `tests/fixtures/contract/browser-results/<sample>.json` holds what the browser worker
 *   answers for every real sample (as saved, refinement, after refinement). The service's
 *   parity tests (`vision-service/tests/test_parity.py`) compare their own answers with it.
 * - with `CONTRACT_EXPORT=1`, the synthetic regression boards (metrics and EMPTY suites) are
 *   written with their browser results to `tests/fixtures/contract/.generated/` (git-ignored,
 *   images are large) for the service's synthetic parity tests: kings and EMPTY edge cases,
 *   which the real samples do not cover yet.
 * - `tests/fixtures/contract/service-response.json`, written by the service tests, must pass
 *   the app's own protocol validators.
 *
 * This spec fails when a fixture no longer matches the browser pipeline; regenerate them
 * with `CONTRACT_EXPORT=1` (`npm run vision:contract`), then rerun `npm run vision:test`.
 */
const loadOpenCv = createOpenCvLoader();
const EXPORT = environmentVariable('CONTRACT_EXPORT') === '1';
const CONFIG_PATH = 'tests/fixtures/contract/default-vision-config.json';
const resultPath = (name: string): string => `tests/fixtures/contract/browser-results/${name}.json`;

interface BrowserRun {
  readonly saved: unknown;
  readonly refinement: unknown;
  readonly refined: unknown;
}

async function runBrowserPipeline(
  png: string,
  calibration: CalibrationCorners,
): Promise<BrowserRun> {
  const frame: RgbaImage = await decodePng(dataUrlToBytes(png));
  const posted: VisionWorkerResponse[] = [];
  const handle = createVisionWorkerHandler({
    loadOpenCv,
    post: (message) => posted.push(message),
    readBitmap: () => frame,
    createBitmap: async (image) =>
      fakeBitmap(image.width, image.height) as FakeBitmap & ImageBitmap,
    now: () => 0,
  });
  const bitmap = () => fakeBitmap(frame.width, frame.height) as FakeBitmap & ImageBitmap;
  const size = { width: frame.width, height: frame.height };
  const last = (): VisionWorkerResponse => posted.at(-1) as VisionWorkerResponse;
  const recognize = async (frameId: string): Promise<unknown> => {
    await handle({ type: 'PROCESS_FRAME', frame: bitmap(), frameId });
    const response = last();
    if (response.type !== 'RECOGNITION_RESULT') throw new Error(JSON.stringify(response));
    return { result: response.result, traces: response.traces, frame: response.frame };
  };

  await handle({ type: 'INIT', config: DEFAULT_VISION_CONFIG });
  await handle({ type: 'CALIBRATE', corners: calibration, ...size });
  const saved = await recognize('as-saved');
  await handle({
    type: 'REFINE_CALIBRATION',
    corners: calibration,
    frame: bitmap(),
    frameId: 'refine',
  });
  const refinement = last();
  if (refinement.type !== 'CALIBRATION_REFINED') throw new Error(JSON.stringify(refinement));
  await handle({ type: 'CALIBRATE', corners: refinement.corners, ...size });
  const refined = await recognize('refined');
  const { type: _type, frameId: _frameId, ...refinementResult } = refinement;
  return { saved, refinement: refinementResult, refined };
}

/** Round trip through JSON, as the fixture and the service see the data. */
const plain = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

describe('vision service contract (G3.1)', { timeout: 60_000 }, () => {
  beforeAll(async () => {
    await loadOpenCv();
  }, 60_000);

  it('default vision config fixture matches the app config', async () => {
    if (EXPORT) {
      await writeRepositoryFile(CONFIG_PATH, `${JSON.stringify(DEFAULT_VISION_CONFIG, null, 2)}\n`);
    }
    const stored = await readRepositoryFile(CONFIG_PATH);

    expect(stored, `${CONFIG_PATH} missing: run npm run vision:contract`).toBeDefined();
    expect(JSON.parse(stored as string)).toEqual(plain(DEFAULT_VISION_CONFIG));
  });

  it.each(REAL_SAMPLES.map((s) => [s.name, s] as const))(
    'browser results fixture is current: %s',
    async (name, registered) => {
      const { sample } = registered;
      const calibration = canonicalCorners(
        sample.calibration.corners,
        sample.calibration.orientation,
      );
      const run = plain({
        sample: name,
        calibration,
        ...(await runBrowserPipeline(sample.frame.png, calibration)),
      });
      if (EXPORT) {
        await writeRepositoryFile(resultPath(name), `${JSON.stringify(run)}\n`);
      }
      const stored = await readRepositoryFile(resultPath(name));

      expect(stored, `${resultPath(name)} missing: run npm run vision:contract`).toBeDefined();
      expect(JSON.parse(stored as string)).toEqual(run);
    },
  );

  it.skipIf(!EXPORT)('exports the synthetic boards for the service parity tests', async () => {
    const config = resolveClassifierConfig(DEFAULT_VISION_CONFIG);
    const UP = { x: 0, y: -1 };
    const scenarios = [
      ...SYNTHETIC_SCENARIOS.map((s) => ({ ...s, suite: 'metrics', paint: undefined })),
      ...EMPTY_SCENARIOS.map((s) => ({ ...s, suite: 'empty' })),
    ];
    const index: string[] = [];
    for (const [i, scenario] of scenarios.entries()) {
      const labels = scenario.position();
      const image = renderNormalizedBoard(labels, scenario.options);
      scenario.paint?.(image);
      const away = scenario.options.pieceHeight ? UP : null;
      const { result, traces, frame } = recognizeBoard(image, config, {
        timestamp: 0,
        awayFromCamera: away,
      });
      const file = `${String(i).padStart(2, '0')}-${scenario.suite}.json`;
      index.push(file);
      await writeRepositoryFile(
        `tests/fixtures/contract/.generated/${file}`,
        JSON.stringify(
          plain({
            name: scenario.name,
            suite: scenario.suite,
            awayFromCamera: away,
            labels,
            png: bytesToDataUrl(await encodePng(image)),
            result,
            traces,
            frame,
          }),
        ),
      );
    }
    await writeRepositoryFile(
      'tests/fixtures/contract/.generated/index.json',
      JSON.stringify(index),
    );
    expect(index.length).toBe(scenarios.length);
  });

  it('a service response passes the app protocol validators', async () => {
    const stored = await readRepositoryFile('tests/fixtures/contract/service-response.json');
    expect(stored, 'service-response.json missing: run npm run vision:test').toBeDefined();
    const response = JSON.parse(stored as string) as Record<string, unknown>;

    expect(isBoardRecognitionResult(response['result'])).toBe(true);
    expect(isSquareTraces(response['traces'])).toBe(true);
    expect(isFrameAssessment(response['frame'])).toBe(true);
    expect(typeof response['frameId']).toBe('string');
  });
});
