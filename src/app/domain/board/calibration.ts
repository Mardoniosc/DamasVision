import { distance, isFinitePoint, Point2D, polygonArea, Size2D, turnDirection } from './geometry';
import { QuadPoints } from './homography';

/** Contracts from docs/execution-specification.md §5 (Geometry and calibration). */
export interface CalibrationCorners {
  readonly topLeft: Point2D;
  readonly topRight: Point2D;
  readonly bottomRight: Point2D;
  readonly bottomLeft: Point2D;
}

export type CalibrationOrientation = 'NORMAL' | 'ROTATED_90' | 'ROTATED_180' | 'ROTATED_270';

export interface CalibrationProfile {
  readonly id: string;
  readonly name: string;
  readonly cameraDeviceId?: string;
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  /** Corners as placed on the camera image (screen order), in source pixels. */
  readonly corners: CalibrationCorners;
  readonly normalizedWidth: number;
  readonly normalizedHeight: number;
  /** Which image corner is the canonical top-left; see {@link canonicalCorners}. */
  readonly orientation: CalibrationOrientation;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type CornerName = keyof CalibrationCorners;

export const CORNER_NAMES: readonly CornerName[] = [
  'topLeft',
  'topRight',
  'bottomRight',
  'bottomLeft',
];

export const ORIENTATIONS: readonly CalibrationOrientation[] = [
  'NORMAL',
  'ROTATED_90',
  'ROTATED_180',
  'ROTATED_270',
];

export function cornersToArray(corners: CalibrationCorners): QuadPoints {
  return [corners.topLeft, corners.topRight, corners.bottomRight, corners.bottomLeft];
}

export function cornersFromArray(points: QuadPoints): CalibrationCorners {
  const [topLeft, topRight, bottomRight, bottomLeft] = points;
  return { topLeft, topRight, bottomRight, bottomLeft };
}

/** Next orientation when the user rotates the canonical board 90° clockwise. */
export function nextOrientation(orientation: CalibrationOrientation): CalibrationOrientation {
  const index = ORIENTATIONS.indexOf(orientation);
  return ORIENTATIONS[(index + 1) % ORIENTATIONS.length] as CalibrationOrientation;
}

/**
 * Maps the corners placed on the image (screen order) to canonical board corners.
 * Each 90° step moves the canonical top-left one corner clockwise on screen, so the
 * canonical board can be aligned with the physical board whatever the camera angle.
 * Rotation is a cyclic shift, so a clockwise quad stays clockwise.
 */
export function canonicalCorners(
  imageCorners: CalibrationCorners,
  orientation: CalibrationOrientation,
): CalibrationCorners {
  const steps = ORIENTATIONS.indexOf(orientation);
  const points = cornersToArray(imageCorners);
  return cornersFromArray(
    [0, 1, 2, 3].map((i) => points[(i + steps) % 4]) as unknown as QuadPoints,
  );
}

/** Inverse of {@link canonicalCorners}: canonical corners back to screen order. */
export function imageCornersFromCanonical(
  canonical: CalibrationCorners,
  orientation: CalibrationOrientation,
): CalibrationCorners {
  const steps = ORIENTATIONS.indexOf(orientation);
  const points = cornersToArray(canonical);
  return cornersFromArray(
    [0, 1, 2, 3].map((i) => points[(i - steps + 4) % 4]) as unknown as QuadPoints,
  );
}

export function scaleCorners(
  corners: CalibrationCorners,
  from: Size2D,
  to: Size2D,
): CalibrationCorners {
  const sx = to.width / from.width;
  const sy = to.height / from.height;
  const scale = (p: Point2D): Point2D => ({ x: p.x * sx, y: p.y * sy });
  return {
    topLeft: scale(corners.topLeft),
    topRight: scale(corners.topRight),
    bottomRight: scale(corners.bottomRight),
    bottomLeft: scale(corners.bottomLeft),
  };
}

/** Initial corners: a centered square covering `coverage` of the shorter image side. */
export function defaultCorners(
  size: Size2D,
  coverage = DEFAULT_CORNER_COVERAGE,
): CalibrationCorners {
  const side = Math.min(size.width, size.height) * coverage;
  const left = (size.width - side) / 2;
  const top = (size.height - side) / 2;
  return {
    topLeft: { x: left, y: top },
    topRight: { x: left + side, y: top },
    bottomRight: { x: left + side, y: top + side },
    bottomLeft: { x: left, y: top + side },
  };
}

export const DEFAULT_CORNER_COVERAGE = 0.7;

export function clampPoint(point: Point2D, size: Size2D): Point2D {
  return {
    x: Math.min(Math.max(point.x, 0), size.width),
    y: Math.min(Math.max(point.y, 0), size.height),
  };
}

// ---------------------------------------------------------------------------
// Validation (E2-T02)
// ---------------------------------------------------------------------------

export type CalibrationIssueCode =
  | 'INVALID_SOURCE_SIZE'
  | 'INVALID_POINT'
  | 'OUT_OF_BOUNDS'
  | 'CORNERS_TOO_CLOSE'
  | 'WRONG_ORDER'
  | 'NOT_CONVEX'
  | 'AREA_TOO_SMALL';

export interface CalibrationIssue {
  readonly code: CalibrationIssueCode;
  readonly corners: readonly CornerName[];
}

export interface CalibrationValidation {
  readonly valid: boolean;
  readonly issues: readonly CalibrationIssue[];
}

export interface CornerValidationOptions {
  /** Minimum distance between any two corners, as a ratio of the image diagonal. */
  readonly minCornerDistanceRatio: number;
  /** Minimum quadrilateral area, as a ratio of the image area. */
  readonly minAreaRatio: number;
}

/** Initial values; tune with physical tests (spec §14: centralize thresholds). */
export const DEFAULT_CORNER_VALIDATION: CornerValidationOptions = {
  minCornerDistanceRatio: 0.05,
  minAreaRatio: 0.04,
};

/**
 * Validates corners in image space: ordering (clockwise TL → TR → BR → BL on screen),
 * bounds, distinctness, convexity and minimum area (spec §7 step 1).
 */
export function validateCalibrationCorners(
  corners: CalibrationCorners,
  sourceSize: Size2D,
  options: CornerValidationOptions = DEFAULT_CORNER_VALIDATION,
): CalibrationValidation {
  if (
    !(sourceSize.width > 0) ||
    !(sourceSize.height > 0) ||
    !Number.isFinite(sourceSize.width) ||
    !Number.isFinite(sourceSize.height)
  ) {
    return invalid([{ code: 'INVALID_SOURCE_SIZE', corners: [] }]);
  }

  const nonFinite = CORNER_NAMES.filter((name) => !isFinitePoint(corners[name]));
  if (nonFinite.length > 0) {
    return invalid([{ code: 'INVALID_POINT', corners: nonFinite }]);
  }

  const issues: CalibrationIssue[] = [];

  const outside = CORNER_NAMES.filter((name) => {
    const { x, y } = corners[name];
    return x < 0 || y < 0 || x > sourceSize.width || y > sourceSize.height;
  });
  if (outside.length > 0) {
    issues.push({ code: 'OUT_OF_BOUNDS', corners: outside });
  }

  const minDistance =
    Math.hypot(sourceSize.width, sourceSize.height) * options.minCornerDistanceRatio;
  const tooClose = new Set<CornerName>();
  for (let i = 0; i < CORNER_NAMES.length; i++) {
    for (let j = i + 1; j < CORNER_NAMES.length; j++) {
      const a = CORNER_NAMES[i] as CornerName;
      const b = CORNER_NAMES[j] as CornerName;
      if (distance(corners[a], corners[b]) < minDistance) {
        tooClose.add(a);
        tooClose.add(b);
      }
    }
  }
  if (tooClose.size > 0) {
    issues.push({ code: 'CORNERS_TOO_CLOSE', corners: [...tooClose] });
  }

  const points = cornersToArray(corners);
  const turns = points.map((point, i) =>
    turnDirection(points[(i + 3) % 4] as typeof point, point, points[(i + 1) % 4] as typeof point),
  );
  if (turns.every((turn) => turn < 0)) {
    issues.push({ code: 'WRONG_ORDER', corners: [...CORNER_NAMES] });
  } else if (!turns.every((turn) => turn > 0)) {
    const offending = CORNER_NAMES.filter((_, i) => !((turns[i] ?? 0) > 0));
    issues.push({ code: 'NOT_CONVEX', corners: offending });
  }

  if (polygonArea(points) < sourceSize.width * sourceSize.height * options.minAreaRatio) {
    issues.push({ code: 'AREA_TOO_SMALL', corners: [] });
  }

  return issues.length === 0 ? { valid: true, issues } : invalid(issues);
}

function invalid(issues: readonly CalibrationIssue[]): CalibrationValidation {
  return { valid: false, issues };
}
