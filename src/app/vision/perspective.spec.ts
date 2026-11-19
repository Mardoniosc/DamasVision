import { canonicalCorners, CalibrationCorners } from '../domain/board/calibration';
import { applyHomography, computeHomography, Homography } from '../domain/board/homography';
import { cornersToArray } from '../domain/board/calibration';
import { createOpenCvLoader, OpenCv } from './opencv-loader';
import { computePerspectiveTransform, RgbaImage, warpPerspective } from './perspective';

/** Real OpenCV.js (same pinned build the worker uses). */
const loadOpenCv = createOpenCvLoader();

/** 200×100 image: left half red, right half blue, fully opaque. */
function splitImage(width = 200, height = 100): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      const red = x < width / 2;
      data.set([red ? 255 : 0, 0, red ? 0 : 255, 255], offset);
    }
  }
  return { width, height, data };
}

function pixel(image: RgbaImage, x: number, y: number): number[] {
  const offset = (y * image.width + x) * 4;
  return Array.from(image.data.slice(offset, offset + 4));
}

const FULL_IMAGE: CalibrationCorners = {
  topLeft: { x: 0, y: 0 },
  topRight: { x: 200, y: 0 },
  bottomRight: { x: 200, y: 100 },
  bottomLeft: { x: 0, y: 100 },
};

describe('perspective (OpenCV.js)', () => {
  let cv: OpenCv;

  beforeAll(async () => {
    cv = await loadOpenCv();
  }, 60_000);

  it('matches the pure TypeScript homography used by the overlay', () => {
    const corners: CalibrationCorners = {
      topLeft: { x: 112, y: 64 },
      topRight: { x: 530, y: 80 },
      bottomRight: { x: 560, y: 450 },
      bottomLeft: { x: 90, y: 420 },
    };
    const size = { width: 800, height: 800 };

    const fromOpenCv = computePerspectiveTransform(cv, corners, size);
    const fromDomain = computeHomography(cornersToArray(corners), [
      { x: 0, y: 0 },
      { x: 800, y: 0 },
      { x: 800, y: 800 },
      { x: 0, y: 800 },
    ]) as Homography;

    fromOpenCv.forEach((value, i) => expect(value).toBeCloseTo(fromDomain[i] as number, 6));
    const mapped = applyHomography(fromOpenCv, corners.bottomRight);
    expect(mapped.x).toBeCloseTo(800, 6);
    expect(mapped.y).toBeCloseTo(800, 6);
  });

  it('warps the selected quadrilateral into the normalized image', () => {
    const size = { width: 80, height: 80 };
    const transform = computePerspectiveTransform(cv, FULL_IMAGE, size);

    const output = warpPerspective(cv, splitImage(), transform, size);

    expect(output.width).toBe(80);
    expect(output.data).toHaveLength(80 * 80 * 4);
    expect(pixel(output, 10, 40)).toEqual([255, 0, 0, 255]);
    expect(pixel(output, 70, 40)).toEqual([0, 0, 255, 255]);
  });

  it('applies the canonical orientation (180° swaps left and right)', () => {
    const size = { width: 80, height: 80 };
    const transform = computePerspectiveTransform(
      cv,
      canonicalCorners(FULL_IMAGE, 'ROTATED_180'),
      size,
    );

    const output = warpPerspective(cv, splitImage(), transform, size);

    expect(pixel(output, 10, 40)).toEqual([0, 0, 255, 255]);
    expect(pixel(output, 70, 40)).toEqual([255, 0, 0, 255]);
  });

  it('rejects a buffer that does not match its dimensions', () => {
    const transform = computePerspectiveTransform(cv, FULL_IMAGE, { width: 10, height: 10 });
    const broken = { width: 10, height: 10, data: new Uint8ClampedArray(4) };

    expect(() => warpPerspective(cv, broken, transform, { width: 10, height: 10 })).toThrow(
      RangeError,
    );
  });
});
