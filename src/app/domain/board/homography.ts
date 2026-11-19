import { Point2D } from './geometry';

/** 3×3 projective transform, row-major: [h00, h01, h02, h10, h11, h12, h20, h21, h22]. */
export type Homography = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

export type QuadPoints = readonly [Point2D, Point2D, Point2D, Point2D];

const EPSILON = 1e-12;

/**
 * Homography mapping each `source[i]` to `destination[i]` (normalized so h22 = 1).
 * Same formulation as OpenCV `getPerspectiveTransform`. Returns `null` for degenerate input.
 */
export function computeHomography(source: QuadPoints, destination: QuadPoints): Homography | null {
  const matrix: number[][] = [];
  const rhs: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = source[i] as Point2D;
    const { x: u, y: v } = destination[i] as Point2D;
    matrix.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    rhs.push(u);
    matrix.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    rhs.push(v);
  }
  const solution = solveLinearSystem(matrix, rhs);
  if (!solution) {
    return null;
  }
  const [a, b, c, d, e, f, g, h] = solution as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  return [a, b, c, d, e, f, g, h, 1];
}

export function applyHomography(h: Homography, point: Point2D): Point2D {
  const w = h[6] * point.x + h[7] * point.y + h[8];
  return {
    x: (h[0] * point.x + h[1] * point.y + h[2]) / w,
    y: (h[3] * point.x + h[4] * point.y + h[5]) / w,
  };
}

export function invertHomography(h: Homography): Homography | null {
  const [a, b, c, d, e, f, g, i, j] = h;
  const det = a * (e * j - f * i) - b * (d * j - f * g) + c * (d * i - e * g);
  if (Math.abs(det) < EPSILON) {
    return null;
  }
  const inverse: Homography = [
    (e * j - f * i) / det,
    (c * i - b * j) / det,
    (b * f - c * e) / det,
    (f * g - d * j) / det,
    (a * j - c * g) / det,
    (c * d - a * f) / det,
    (d * i - e * g) / det,
    (b * g - a * i) / det,
    (a * e - b * d) / det,
  ];
  const scale = inverse[8];
  return Math.abs(scale) < EPSILON
    ? inverse
    : (inverse.map((v) => v / scale) as unknown as Homography);
}

/** Gaussian elimination with partial pivoting. Returns `null` when the system is singular. */
function solveLinearSystem(matrix: number[][], rhs: number[]): number[] | null {
  const n = rhs.length;
  const rows = matrix.map((row, index) => [...row, rhs[index] as number]);

  for (let column = 0; column < n; column++) {
    let pivot = column;
    for (let row = column + 1; row < n; row++) {
      if (Math.abs(rows[row]?.[column] ?? 0) > Math.abs(rows[pivot]?.[column] ?? 0)) {
        pivot = row;
      }
    }
    const pivotRow = rows[pivot] as number[];
    const pivotValue = pivotRow[column] as number;
    if (Math.abs(pivotValue) < EPSILON) {
      return null;
    }
    rows[pivot] = rows[column] as number[];
    rows[column] = pivotRow;

    for (let row = 0; row < n; row++) {
      if (row === column) {
        continue;
      }
      const target = rows[row] as number[];
      const factor = (target[column] as number) / pivotValue;
      if (factor !== 0) {
        for (let k = column; k <= n; k++) {
          target[k] = (target[k] as number) - factor * (pivotRow[k] as number);
        }
      }
    }
  }
  return rows.map((row, index) => (row[n] as number) / (row[index] as number));
}
