import { createVisionWorkerHandler } from '../../src/app/core/workers/vision-worker.handler';
import { VisionWorkerResponse } from '../../src/app/core/workers/vision-worker.protocol';
import { isPlayableSquare } from '../../src/app/domain/board/board';
import { createBoardGrid, squareRoi } from '../../src/app/domain/board/board-grid';
import {
  CalibrationCorners,
  CalibrationOrientation,
  canonicalCorners,
  cornersToArray,
} from '../../src/app/domain/board/calibration';
import {
  applyHomography,
  computeHomography,
  Homography,
} from '../../src/app/domain/board/homography';
import { createOpenCvLoader } from '../../src/app/vision/opencv-loader';
import { RgbaImage } from '../../src/app/vision/perspective';
import { DEFAULT_VISION_CONFIG } from '../../src/app/vision/vision.config';
import { fakeBitmap, FakeBitmap } from '../fixtures/fake-frames';

/**
 * Integration (spec §16): calibration → perspective → grid, with the real OpenCV.js build.
 * A synthetic camera image contains an 8×8 board seen in perspective; after calibrating
 * with its corners and rectifying, every square of the canonical grid must land on the
 * right board square (target: 100 % square mapping after a valid calibration).
 */

const SOURCE = { width: 640, height: 480 };
const NORMALIZED = { width: 400, height: 400 };
const DARK = [40, 30, 20, 255];
const LIGHT = [230, 210, 170, 255];
const BACKGROUND = [120, 160, 120, 255];

/** Physical board corners in the image, as the camera sees them (perspective, rotation). */
const BOARD_CORNERS: CalibrationCorners = {
  topLeft: { x: 150, y: 52 },
  topRight: { x: 505, y: 78 },
  bottomRight: { x: 560, y: 430 },
  bottomLeft: { x: 95, y: 405 },
};

/**
 * Renders the board: board square (r, c) is dark when (r + c) is odd, with r/c measured
 * from the physical corner placed at `BOARD_CORNERS.topLeft`.
 */
function renderBoardImage(): RgbaImage {
  const toBoard = computeHomography(cornersToArray(BOARD_CORNERS), [
    { x: 0, y: 0 },
    { x: 8, y: 0 },
    { x: 8, y: 8 },
    { x: 0, y: 8 },
  ]) as Homography;
  const data = new Uint8ClampedArray(SOURCE.width * SOURCE.height * 4);
  for (let y = 0; y < SOURCE.height; y++) {
    for (let x = 0; x < SOURCE.width; x++) {
      const p = applyHomography(toBoard, { x: x + 0.5, y: y + 0.5 });
      const inside = p.x >= 0 && p.x < 8 && p.y >= 0 && p.y < 8;
      const color = !inside
        ? BACKGROUND
        : (Math.floor(p.x) + Math.floor(p.y)) % 2 === 1
          ? DARK
          : LIGHT;
      data.set(color, (y * SOURCE.width + x) * 4);
    }
  }
  return { ...SOURCE, data };
}

function meanColor(
  image: RgbaImage,
  rect: { x: number; y: number; width: number; height: number },
): number[] {
  const sum = [0, 0, 0];
  let count = 0;
  for (let y = Math.ceil(rect.y); y < rect.y + rect.height; y++) {
    for (let x = Math.ceil(rect.x); x < rect.x + rect.width; x++) {
      const offset = (y * image.width + x) * 4;
      sum[0] = (sum[0] ?? 0) + (image.data[offset] ?? 0);
      sum[1] = (sum[1] ?? 0) + (image.data[offset + 1] ?? 0);
      sum[2] = (sum[2] ?? 0) + (image.data[offset + 2] ?? 0);
      count++;
    }
  }
  return sum.map((value) => value / count);
}

function isDark(color: number[]): boolean {
  return (color[0] ?? 255) < 100;
}

describe('calibration → perspective → grid (integration, real OpenCV)', () => {
  const loadOpenCv = createOpenCvLoader();
  const source = renderBoardImage();

  beforeAll(async () => {
    await loadOpenCv();
  }, 60_000);

  async function rectify(orientation: CalibrationOrientation): Promise<RgbaImage> {
    const posted: VisionWorkerResponse[] = [];
    let output: RgbaImage | null = null;
    const handle = createVisionWorkerHandler({
      loadOpenCv,
      post: (message) => posted.push(message),
      readBitmap: () => source,
      createBitmap: async (image) => {
        output = image;
        return fakeBitmap(image.width, image.height) as FakeBitmap & ImageBitmap;
      },
    });
    const config = {
      ...DEFAULT_VISION_CONFIG,
      normalizedBoardWidth: NORMALIZED.width,
      normalizedBoardHeight: NORMALIZED.height,
    };

    await handle({ type: 'INIT', config });
    await handle({
      type: 'CALIBRATE',
      corners: canonicalCorners(BOARD_CORNERS, orientation),
      ...SOURCE,
    });
    await handle({
      type: 'RECTIFY_FRAME',
      frame: fakeBitmap(SOURCE.width, SOURCE.height),
      frameId: 'f1',
    });

    expect(posted.map((m) => m.type)).toEqual(['READY', 'CALIBRATION_RESULT', 'RECTIFIED_FRAME']);
    if (!output) throw new Error('no rectified image');
    return output;
  }

  it('maps all 64 squares: playable squares are exactly the dark ones', async () => {
    const image = await rectify('NORMAL');
    const grid = createBoardGrid(NORMALIZED);

    const mismatches = grid.filter(
      (square) =>
        isDark(meanColor(image, squareRoi(square, DEFAULT_VISION_CONFIG.roiInsetRatio))) !==
        square.isPlayable,
    );

    expect(mismatches.map((s) => s.index)).toEqual([]);
  });

  it("keeps the mapping under a 180° orientation (the other player's view)", async () => {
    const image = await rectify('ROTATED_180');
    const grid = createBoardGrid(NORMALIZED);

    const mismatches = grid.filter(
      (square) =>
        isDark(meanColor(image, squareRoi(square, 0.15))) !== isPlayableSquare(square.index),
    );

    expect(mismatches).toEqual([]);
  });

  it('a 90° orientation swaps dark and light squares, which the overlay makes visible', async () => {
    const image = await rectify('ROTATED_90');
    const grid = createBoardGrid(NORMALIZED);

    const playableAreDark = grid
      .filter((s) => s.isPlayable)
      .every((s) => isDark(meanColor(image, squareRoi(s, 0.15))));
    const playableAreLight = grid
      .filter((s) => s.isPlayable)
      .every((s) => !isDark(meanColor(image, squareRoi(s, 0.15))));

    expect(playableAreDark).toBe(false);
    expect(playableAreLight).toBe(true);
  });

  it('places the board outside the rectified image nowhere (no background in any ROI)', async () => {
    const image = await rectify('NORMAL');

    for (const square of createBoardGrid(NORMALIZED)) {
      const [r, g] = meanColor(image, squareRoi(square, 0.15));
      expect(
        Math.abs((r ?? 0) - BACKGROUND[0]!) + Math.abs((g ?? 0) - BACKGROUND[1]!),
      ).toBeGreaterThan(40);
    }
  });
});
