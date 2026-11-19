import {
  CalibrationCorners,
  canonicalCorners,
  clampPoint,
  defaultCorners,
  imageCornersFromCanonical,
  nextOrientation,
  scaleCorners,
  validateCalibrationCorners,
} from './calibration';

const SIZE = { width: 640, height: 480 };

const GOOD: CalibrationCorners = {
  topLeft: { x: 120, y: 40 },
  topRight: { x: 520, y: 60 },
  bottomRight: { x: 540, y: 440 },
  bottomLeft: { x: 100, y: 420 },
};

function codes(corners: CalibrationCorners, size = SIZE): string[] {
  return validateCalibrationCorners(corners, size).issues.map((issue) => issue.code);
}

describe('calibration corners', () => {
  describe('validation (E2-T02)', () => {
    it('accepts a convex, clockwise, large-enough quad inside the image', () => {
      expect(validateCalibrationCorners(GOOD, SIZE)).toEqual({ valid: true, issues: [] });
    });

    it('accepts corners exactly on the image border', () => {
      expect(validateCalibrationCorners(defaultCorners(SIZE, 1), SIZE).valid).toBe(true);
    });

    it('reports corners outside the image', () => {
      const result = validateCalibrationCorners({ ...GOOD, topRight: { x: 700, y: 60 } }, SIZE);

      expect(result.valid).toBe(false);
      expect(result.issues).toContainEqual({ code: 'OUT_OF_BOUNDS', corners: ['topRight'] });
    });

    it('reports corners that are too close together', () => {
      const result = validateCalibrationCorners({ ...GOOD, topRight: { x: 125, y: 45 } }, SIZE);

      expect(result.issues.find((i) => i.code === 'CORNERS_TOO_CLOSE')?.corners).toEqual([
        'topLeft',
        'topRight',
      ]);
    });

    it('reports a mirrored (counter-clockwise) quad as WRONG_ORDER', () => {
      const mirrored = {
        topLeft: GOOD.topRight,
        topRight: GOOD.topLeft,
        bottomRight: GOOD.bottomLeft,
        bottomLeft: GOOD.bottomRight,
      };

      expect(codes(mirrored)).toEqual(['WRONG_ORDER']);
    });

    it('reports a self-intersecting (bow-tie) quad as NOT_CONVEX', () => {
      const bowTie = { ...GOOD, bottomRight: GOOD.bottomLeft, bottomLeft: GOOD.bottomRight };

      expect(codes(bowTie)).toContain('NOT_CONVEX');
    });

    it('reports a concave quad as NOT_CONVEX naming the reflex corner', () => {
      const concave = { ...GOOD, bottomRight: { x: 250, y: 200 } };
      const result = validateCalibrationCorners(concave, SIZE);

      expect(result.issues.find((i) => i.code === 'NOT_CONVEX')?.corners).toEqual(['bottomRight']);
    });

    it('reports collinear corners (a triangle) as NOT_CONVEX', () => {
      const triangle = {
        topLeft: { x: 100, y: 50 },
        topRight: { x: 300, y: 50 }, // on the line from topLeft to bottomRight
        bottomRight: { x: 500, y: 50 },
        bottomLeft: { x: 100, y: 400 },
      };

      const result = validateCalibrationCorners(triangle, SIZE);

      expect(result.issues.find((i) => i.code === 'NOT_CONVEX')?.corners).toContain('topRight');
    });

    it('reports a quad smaller than the minimum area', () => {
      const tiny = defaultCorners(SIZE, 0.15);

      expect(codes(tiny)).toContain('AREA_TOO_SMALL');
    });

    it('rejects non-finite points and invalid source sizes before other checks', () => {
      expect(codes({ ...GOOD, topLeft: { x: Number.NaN, y: 0 } })).toEqual(['INVALID_POINT']);
      expect(codes(GOOD, { width: 0, height: 480 })).toEqual(['INVALID_SOURCE_SIZE']);
    });

    it('honours custom thresholds', () => {
      const strict = validateCalibrationCorners(GOOD, SIZE, {
        minCornerDistanceRatio: 0.05,
        minAreaRatio: 0.9,
      });

      expect(strict.issues.map((i) => i.code)).toEqual(['AREA_TOO_SMALL']);
    });
  });

  describe('orientation', () => {
    it('cycles through the four orientations', () => {
      expect(nextOrientation('NORMAL')).toBe('ROTATED_90');
      expect(nextOrientation('ROTATED_270')).toBe('NORMAL');
    });

    it('moves the canonical top-left one corner clockwise per step', () => {
      expect(canonicalCorners(GOOD, 'NORMAL')).toEqual(GOOD);
      expect(canonicalCorners(GOOD, 'ROTATED_90')).toEqual({
        topLeft: GOOD.topRight,
        topRight: GOOD.bottomRight,
        bottomRight: GOOD.bottomLeft,
        bottomLeft: GOOD.topLeft,
      });
      expect(canonicalCorners(GOOD, 'ROTATED_180').topLeft).toEqual(GOOD.bottomRight);
      expect(canonicalCorners(GOOD, 'ROTATED_270').topLeft).toEqual(GOOD.bottomLeft);
    });

    it('maps canonical corners back to screen order for every orientation', () => {
      for (const orientation of ['NORMAL', 'ROTATED_90', 'ROTATED_180', 'ROTATED_270'] as const) {
        expect(imageCornersFromCanonical(canonicalCorners(GOOD, orientation), orientation)).toEqual(
          GOOD,
        );
      }
    });

    it('keeps a valid quad valid in every orientation', () => {
      for (const orientation of ['NORMAL', 'ROTATED_90', 'ROTATED_180', 'ROTATED_270'] as const) {
        expect(validateCalibrationCorners(canonicalCorners(GOOD, orientation), SIZE).valid).toBe(
          true,
        );
      }
    });
  });

  describe('helpers', () => {
    it('creates a centered default square', () => {
      expect(defaultCorners({ width: 1000, height: 500 }, 0.8)).toEqual({
        topLeft: { x: 300, y: 50 },
        topRight: { x: 700, y: 50 },
        bottomRight: { x: 700, y: 450 },
        bottomLeft: { x: 300, y: 450 },
      });
    });

    it('scales corners to a new source resolution', () => {
      const scaled = scaleCorners(GOOD, SIZE, { width: 1280, height: 960 });

      expect(scaled.bottomRight).toEqual({ x: 1080, y: 880 });
    });

    it('clamps points to the image', () => {
      expect(clampPoint({ x: -5, y: 900 }, SIZE)).toEqual({ x: 0, y: 480 });
    });
  });
});
