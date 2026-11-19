import { fakeBitmap, FakeBitmap } from '../../../../tests/fixtures/fake-frames';
import { CalibrationCorners } from '../../domain/board/calibration';
import { applyHomography } from '../../domain/board/homography';
import { createOpenCvLoader } from '../../vision/opencv-loader';
import { RgbaImage } from '../../vision/perspective';
import { DEFAULT_VISION_CONFIG } from '../../vision/vision.config';
import { createVisionWorkerHandler } from './vision-worker.handler';
import { VisionWorkerResponse } from './vision-worker.protocol';

const loadOpenCv = createOpenCvLoader();

const SOURCE = { width: 640, height: 480 };
const CORNERS: CalibrationCorners = {
  topLeft: { x: 120, y: 40 },
  topRight: { x: 520, y: 60 },
  bottomRight: { x: 540, y: 440 },
  bottomLeft: { x: 100, y: 420 },
};
const CONFIG = { ...DEFAULT_VISION_CONFIG, normalizedBoardWidth: 64, normalizedBoardHeight: 64 };

function solidImage(width: number, height: number): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data.set([200, 100, 50, 255], i);
  }
  return { width, height, data };
}

function setup(overrides: { loadOpenCv?: typeof loadOpenCv } = {}) {
  const posted: { message: VisionWorkerResponse; transfer?: Transferable[] }[] = [];
  const created: FakeBitmap[] = [];
  const handle = createVisionWorkerHandler({
    loadOpenCv: overrides.loadOpenCv ?? loadOpenCv,
    post: (message, transfer) => posted.push({ message, transfer }),
    readBitmap: (bitmap) => solidImage(bitmap.width, bitmap.height),
    createBitmap: async (image) => {
      const bitmap = fakeBitmap(image.width, image.height);
      created.push(bitmap);
      return bitmap as FakeBitmap & ImageBitmap;
    },
  });
  const last = (): VisionWorkerResponse | undefined => posted.at(-1)?.message;
  return { handle, posted, created, last };
}

function frame(width = SOURCE.width, height = SOURCE.height): FakeBitmap & ImageBitmap {
  return fakeBitmap(width, height) as FakeBitmap & ImageBitmap;
}

describe('vision worker handler', () => {
  beforeAll(async () => {
    await loadOpenCv();
  }, 60_000);

  it('answers INIT with READY once OpenCV is loaded', async () => {
    const { handle, last } = setup();

    await handle({ type: 'INIT', config: CONFIG });

    expect(last()).toEqual({ type: 'READY' });
  });

  it('reports INIT_FAILED when OpenCV cannot load', async () => {
    const { handle, last } = setup({ loadOpenCv: () => Promise.reject(new Error('wasm blocked')) });

    await handle({ type: 'INIT', config: CONFIG });

    expect(last()).toEqual({
      type: 'ERROR',
      code: 'INIT_FAILED',
      message: 'wasm blocked',
      requestType: 'INIT',
    });
  });

  it.each([
    ['a non-object', 'hello'],
    ['an unknown type', { type: 'EXPLODE' }],
    ['INIT without config', { type: 'INIT' }],
    ['INIT with a bad config', { type: 'INIT', config: { ...CONFIG, roiInsetRatio: 0.9 } }],
  ])('rejects %s as INVALID_REQUEST', async (_label, message) => {
    const { handle, last } = setup();

    await handle(message);

    expect(last()).toMatchObject({ type: 'ERROR', code: 'INVALID_REQUEST' });
  });

  it('refuses to calibrate before INIT', async () => {
    const { handle, last } = setup();

    await handle({ type: 'CALIBRATE', corners: CORNERS, ...SOURCE });

    expect(last()).toMatchObject({
      type: 'ERROR',
      code: 'NOT_INITIALIZED',
      requestType: 'CALIBRATE',
    });
  });

  it('returns a valid calibration with the image → board transform', async () => {
    const { handle, last } = setup();
    await handle({ type: 'INIT', config: CONFIG });

    await handle({ type: 'CALIBRATE', corners: CORNERS, ...SOURCE });

    const response = last();
    if (response?.type !== 'CALIBRATION_RESULT' || !response.result.transform) {
      throw new Error(`unexpected ${JSON.stringify(response)}`);
    }
    expect(response.result).toMatchObject({
      valid: true,
      issues: [],
      normalizedWidth: 64,
      normalizedHeight: 64,
    });
    const corner = applyHomography(response.result.transform, CORNERS.bottomRight);
    expect(corner.x).toBeCloseTo(64, 5);
    expect(corner.y).toBeCloseTo(64, 5);
  });

  it('returns validation issues for invalid corners and forgets the old calibration', async () => {
    const { handle, last } = setup();
    await handle({ type: 'INIT', config: CONFIG });
    await handle({ type: 'CALIBRATE', corners: CORNERS, ...SOURCE });

    const crossed = { ...CORNERS, topLeft: CORNERS.topRight, topRight: CORNERS.topLeft };
    await handle({ type: 'CALIBRATE', corners: crossed, ...SOURCE });
    expect(last()).toMatchObject({ type: 'CALIBRATION_RESULT', result: { valid: false } });

    const bitmap = frame();
    await handle({ type: 'RECTIFY_FRAME', frame: bitmap, frameId: 'f1' });
    expect(last()).toMatchObject({ type: 'ERROR', code: 'NOT_CALIBRATED', frameId: 'f1' });
    expect(bitmap.closed).toBe(true);
  });

  it('rectifies a frame, transfers the result and closes the input bitmap', async () => {
    const { handle, posted, created } = setup();
    await handle({ type: 'INIT', config: CONFIG });
    await handle({ type: 'CALIBRATE', corners: CORNERS, ...SOURCE });
    const input = frame();

    await handle({ type: 'RECTIFY_FRAME', frame: input, frameId: 'f7' });

    const { message, transfer } = posted.at(-1) ?? {};
    expect(message).toMatchObject({ type: 'RECTIFIED_FRAME', frameId: 'f7' });
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ width: 64, height: 64 });
    expect(transfer).toEqual([created[0]]);
    expect(input.closed).toBe(true);
  });

  it('closes the input bitmap and reports RECTIFY_FAILED when reading fails', async () => {
    const posted: VisionWorkerResponse[] = [];
    const handle = createVisionWorkerHandler({
      loadOpenCv,
      post: (message) => posted.push(message),
      readBitmap: () => {
        throw new Error('canvas lost');
      },
      createBitmap: async () => frame(),
    });
    await handle({ type: 'INIT', config: CONFIG });
    await handle({ type: 'CALIBRATE', corners: CORNERS, ...SOURCE });
    const input = frame();

    await handle({ type: 'RECTIFY_FRAME', frame: input, frameId: 'f2' });

    expect(posted.at(-1)).toMatchObject({ type: 'ERROR', code: 'RECTIFY_FAILED', frameId: 'f2' });
    expect(input.closed).toBe(true);
  });

  it('RESET forgets the calibration', async () => {
    const { handle, last } = setup();
    await handle({ type: 'INIT', config: CONFIG });
    await handle({ type: 'CALIBRATE', corners: CORNERS, ...SOURCE });

    await handle({ type: 'RESET' });
    await handle({ type: 'RECTIFY_FRAME', frame: frame(), frameId: 'f3' });

    expect(last()).toMatchObject({ type: 'ERROR', code: 'NOT_CALIBRATED' });
  });

  describe('PROCESS_FRAME (E3)', () => {
    it('refuses to process before calibration and closes the bitmap', async () => {
      const { handle, last } = setup();
      await handle({ type: 'INIT', config: CONFIG });
      const bitmap = frame();

      await handle({ type: 'PROCESS_FRAME', frame: bitmap, frameId: 'p1' });

      expect(last()).toMatchObject({
        type: 'ERROR',
        code: 'NOT_CALIBRATED',
        frameId: 'p1',
        requestType: 'PROCESS_FRAME',
      });
      expect(bitmap.closed).toBe(true);
    });

    it('returns a recognition result for the frame and closes the bitmap', async () => {
      const { handle, last } = setup();
      await handle({ type: 'INIT', config: CONFIG });
      await handle({ type: 'CALIBRATE', corners: CORNERS, ...SOURCE });
      const bitmap = frame();

      await handle({ type: 'PROCESS_FRAME', frame: bitmap, frameId: 'p2' });

      const response = last();
      expect(response).toMatchObject({ type: 'RECOGNITION_RESULT', frameId: 'p2' });
      if (response?.type === 'RECOGNITION_RESULT') {
        expect(response.result.board.cells).toHaveLength(64);
        expect(response.result.squares).toHaveLength(32);
      }
      expect(bitmap.closed).toBe(true);
    });

    it('rejects an invalid classifier configuration at INIT', async () => {
      const { handle, last } = setup();

      await handle({
        type: 'INIT',
        config: {
          ...CONFIG,
          classifier: { colorThresholds: { unknownKey: 1 }, shapeThresholds: {} },
        },
      });

      expect(last()).toMatchObject({ type: 'ERROR', code: 'INVALID_REQUEST', requestType: 'INIT' });
      expect(last()).toMatchObject({ message: expect.stringContaining('unknownKey') });
    });
  });

  describe('REFINE_CALIBRATION', () => {
    it('requires INIT and closes the bitmap', async () => {
      const { handle, last } = setup();
      const bitmap = frame();

      await handle({ type: 'REFINE_CALIBRATION', corners: CORNERS, frame: bitmap, frameId: 'r1' });

      expect(last()).toMatchObject({ type: 'ERROR', code: 'NOT_INITIALIZED', frameId: 'r1' });
      expect(bitmap.closed).toBe(true);
    });

    it('answers CALIBRATION_REFINED with corners and scores', async () => {
      const { handle, last } = setup();
      await handle({ type: 'INIT', config: CONFIG });
      const bitmap = frame();

      await handle({ type: 'REFINE_CALIBRATION', corners: CORNERS, frame: bitmap, frameId: 'r2' });

      expect(last()).toMatchObject({ type: 'CALIBRATION_REFINED', frameId: 'r2' });
      expect(bitmap.closed).toBe(true);
    });

    it('rejects a request without corners', async () => {
      const { handle, last } = setup();
      await handle({ type: 'INIT', config: CONFIG });

      await handle({ type: 'REFINE_CALIBRATION', frame: frame(), frameId: 'r3' });

      expect(last()).toMatchObject({ type: 'ERROR', code: 'INVALID_REQUEST' });
    });
  });
});
