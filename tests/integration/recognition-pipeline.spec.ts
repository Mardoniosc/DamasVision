import { createVisionWorkerHandler } from '../../src/app/core/workers/vision-worker.handler';
import {
  isBoardRecognitionResult,
  VisionWorkerResponse,
} from '../../src/app/core/workers/vision-worker.protocol';
import {
  CalibrationCorners,
  CalibrationOrientation,
  canonicalCorners,
} from '../../src/app/domain/board/calibration';
import { Piece } from '../../src/app/domain/board/piece';
import { createOpenCvLoader } from '../../src/app/vision/opencv-loader';
import { RgbaImage } from '../../src/app/vision/perspective';
import { DEFAULT_VISION_CONFIG } from '../../src/app/vision/vision.config';
import { fakeBitmap, FakeBitmap } from '../fixtures/fake-frames';
import {
  REAL_SET_BLUE_BOARD,
  midgamePosition,
  renderCameraView,
  renderNormalizedBoard,
  RenderOptions,
  scoreRecognition,
  startingPosition,
} from '../fixtures/synthetic-board';

/**
 * Integration (spec §16): camera frame → perspective → grid → classification →
 * observation, through the worker protocol handler with the real OpenCV.js build.
 */
const SOURCE = { width: 960, height: 720 };
const IMAGE_CORNERS: CalibrationCorners = {
  topLeft: { x: 250, y: 90 },
  topRight: { x: 735, y: 120 },
  bottomRight: { x: 800, y: 640 },
  bottomLeft: { x: 190, y: 610 },
};

describe('recognition pipeline (integration, real OpenCV)', () => {
  const loadOpenCv = createOpenCvLoader();

  beforeAll(async () => {
    await loadOpenCv();
  }, 60_000);

  async function recognize(
    position: Piece[],
    orientation: CalibrationOrientation,
    render: RenderOptions = {},
  ): Promise<VisionWorkerResponse[]> {
    const canonical = canonicalCorners(IMAGE_CORNERS, orientation);
    // The canonical board is drawn at the canonical corners, i.e. rotated in the image.
    const frame = renderCameraView(renderNormalizedBoard(position, render), canonical, SOURCE);
    const posted: VisionWorkerResponse[] = [];
    const handle = createVisionWorkerHandler({
      loadOpenCv,
      post: (message) => posted.push(message),
      readBitmap: (): RgbaImage => frame,
      createBitmap: async (image) =>
        fakeBitmap(image.width, image.height) as FakeBitmap & ImageBitmap,
      now: () => 1234,
    });
    await handle({ type: 'INIT', config: DEFAULT_VISION_CONFIG });
    await handle({ type: 'CALIBRATE', corners: canonical, ...SOURCE });
    await handle({
      type: 'PROCESS_FRAME',
      frame: fakeBitmap(SOURCE.width, SOURCE.height),
      frameId: 'f1',
    });
    return posted;
  }

  function resultOf(posted: VisionWorkerResponse[]) {
    const last = posted.at(-1);
    if (last?.type !== 'RECOGNITION_RESULT') {
      throw new Error(`expected RECOGNITION_RESULT, got ${JSON.stringify(last)}`);
    }
    return last;
  }

  it('reads the starting position from a perspective camera frame', async () => {
    const expected = startingPosition();
    const response = resultOf(await recognize(expected, 'NORMAL'));

    expect(response.frameId).toBe('f1');
    expect(isBoardRecognitionResult(response.result)).toBe(true);
    expect(response.result.board.sourceFrameId).toBe('f1');
    expect(response.result.timestamp).toBe(1234);
    const score = scoreRecognition(expected, response.result.board.cells);
    expect(score.errors).toEqual([]);
    expect(score.correct).toBe(32);
  });

  it('reads a mid-game position with kings, seen from the other side (180°)', async () => {
    const expected = midgamePosition();
    const response = resultOf(await recognize(expected, 'ROTATED_180'));
    const score = scoreRecognition(expected, response.result.board.cells);

    expect(score.errors).toEqual([]);
    expect(score.accuracy).toBeGreaterThanOrEqual(0.95);
  });

  it('keeps zero confident errors under dim, noisy light', async () => {
    const expected = midgamePosition();
    const response = resultOf(
      await recognize(expected, 'ROTATED_90', { brightness: 0.6, noise: 8, seed: 21 }),
    );
    const score = scoreRecognition(expected, response.result.board.cells);

    expect(score.errors).toEqual([]);
    expect(score.accuracy).toBeGreaterThanOrEqual(0.95);
  });

  it('handles heavy sensor noise (σ = 20) thanks to OpenCV smoothing', async () => {
    const expected = midgamePosition();
    const response = resultOf(await recognize(expected, 'NORMAL', { noise: 20, seed: 4 }));
    const score = scoreRecognition(expected, response.result.board.cells);

    expect(score.errors).toEqual([]);
    expect(score.accuracy).toBeGreaterThanOrEqual(0.95);
  });

  it('returns 64 cells and confidences, non-playable squares always EMPTY', async () => {
    const response = resultOf(await recognize(startingPosition(), 'NORMAL'));
    const { cells, confidenceBySquare } = response.result.board;

    expect(cells).toHaveLength(64);
    expect(confidenceBySquare).toHaveLength(64);
    expect(response.result.squares).toHaveLength(32);
    expect(
      cells
        .filter((_, index) => (Math.floor(index / 8) + (index % 8)) % 2 === 0)
        .every((c) => c === 'EMPTY'),
    ).toBe(true);
  });

  describe(
    'misaligned calibration (first real-world test, 2026-11-19)',
    { timeout: 30_000 },
    () => {
      const SOURCE_960 = { width: 960, height: 540 };
      const TRUE: CalibrationCorners = {
        topLeft: { x: 255, y: 70 },
        topRight: { x: 760, y: 68 },
        bottomRight: { x: 900, y: 500 },
        bottomLeft: { x: 125, y: 505 },
      };
      /** The user's handles on the small far edge landed slightly inside the board. */
      const HANDLES: CalibrationCorners = {
        ...TRUE,
        topLeft: { x: 268, y: 75 },
        topRight: { x: 745, y: 73 },
      };
      const SET: RenderOptions = {
        ...REAL_SET_BLUE_BOARD,
        pieceHeight: 0.1,
        pieceRadiusRatio: 0.42,
      };

      async function run(): Promise<{ before: VisionWorkerResponse; after: VisionWorkerResponse }> {
        const expected = startingPosition();
        const frame = renderCameraView(renderNormalizedBoard(expected, SET), TRUE, SOURCE_960);
        const posted: VisionWorkerResponse[] = [];
        const handle = createVisionWorkerHandler({
          loadOpenCv,
          post: (message) => posted.push(message),
          readBitmap: (): RgbaImage => frame,
          createBitmap: async (image) =>
            fakeBitmap(image.width, image.height) as FakeBitmap & ImageBitmap,
        });
        const bitmap = () => fakeBitmap(SOURCE_960.width, SOURCE_960.height);
        await handle({ type: 'INIT', config: DEFAULT_VISION_CONFIG });
        await handle({ type: 'CALIBRATE', corners: HANDLES, ...SOURCE_960 });
        await handle({ type: 'PROCESS_FRAME', frame: bitmap(), frameId: 'before' });
        const before = posted.at(-1) as VisionWorkerResponse;

        await handle({
          type: 'REFINE_CALIBRATION',
          corners: HANDLES,
          frame: bitmap(),
          frameId: 'refine',
        });
        const refined = posted.at(-1);
        if (refined?.type !== 'CALIBRATION_REFINED') throw new Error(JSON.stringify(refined));
        await handle({ type: 'CALIBRATE', corners: refined.corners, ...SOURCE_960 });
        await handle({ type: 'PROCESS_FRAME', frame: bitmap(), frameId: 'after' });
        return { before, after: posted.at(-1) as VisionWorkerResponse };
      }

      it('reproduces the field failure, then the automatic adjustment restores 32/32', async () => {
        const { before, after } = await run();
        if (before.type !== 'RECOGNITION_RESULT' || after.type !== 'RECOGNITION_RESULT') {
          throw new Error('expected recognition results');
        }
        const expected = startingPosition();

        const beforeScore = scoreRecognition(expected, before.result.board.cells);
        expect(beforeScore.wrong).toBe(0);
        expect(beforeScore.unknown).toBeGreaterThanOrEqual(8);

        const afterScore = scoreRecognition(expected, after.result.board.cells);
        expect(afterScore.errors).toEqual([]);
        expect(afterScore.correct).toBe(32);
      });
    },
  );
});
