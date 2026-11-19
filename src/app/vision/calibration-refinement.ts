import { BOARD_SIZE } from '../domain/board/board';
import {
  CalibrationCorners,
  cornersFromArray,
  cornersToArray,
  validateCalibrationCorners,
} from '../domain/board/calibration';
import { distance, Point2D } from '../domain/board/geometry';
import {
  applyHomography,
  computeHomography,
  Homography,
  QuadPoints,
} from '../domain/board/homography';
import { RgbaImage } from './perspective';

/** 8-bit grayscale image. */
export interface GrayImage {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
}

export interface RefinementOptions {
  /** Maximum displacement of each corner, in squares (keeps the search near the user's handles). */
  readonly maxShiftSquares: number;
  /** Samples per grid line. */
  readonly samplesPerLine: number;
  /** Search stops when the step falls below this many pixels. */
  readonly minStepPx: number;
}

export const DEFAULT_REFINEMENT: RefinementOptions = {
  maxShiftSquares: 0.5,
  samplesPerLine: 48,
  minStepPx: 0.5,
};

export interface RefinementResult {
  /** Refined canonical corners, in source pixels. */
  readonly corners: CalibrationCorners;
  /** Grid-line contrast before and after (mean absolute luminance difference, 0..255). */
  readonly scoreBefore: number;
  readonly scoreAfter: number;
  /** Largest corner displacement, in pixels. */
  readonly maxShiftPx: number;
}

/** Fine cross-line offset in pixels: an edge derivative that peaks exactly on the border. */
const FINE_OFFSET_PX = 1.5;
/** Coarse cross-line offset, in squares: a wide basin of attraction. */
const COARSE_OFFSET = 0.25;
/** The search phase samples lines this many times more sparsely than the final polish. */
const SEARCH_SAMPLE_DIVISOR = 2;
/** The search phase stops refining below this step; the polish takes over. */
const SEARCH_MIN_STEP_PX = 1;
const POLISH_FIRST_STEP_PX = 2;
/** First descent step, in squares. */
const DESCENT_START_SQUARES = 0.25;
/** Basin-hopping jump length (squares), directions and maximum rounds. */
const HOP_SQUARES = 0.3;
const HOP_ROUNDS = 2;
const HOP_DIRECTIONS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [0.7, 0.7],
  [0.7, -0.7],
  [-0.7, 0.7],
  [-0.7, -0.7],
];
/** Fraction of each line's samples discarded at each end before averaging (pieces, shadows). */
const TRIM = 0.25;
const COARSE_WEIGHT = 0.5;
/** Outer lines border the printed margin, whose contrast varies between boards. */
const OUTER_LINE_WEIGHT = 0.5;
/** A move must improve the score by this fraction to be accepted (no wandering on plateaus). */
const MIN_RELATIVE_GAIN = 1e-4;

const UNIT_SQUARE: QuadPoints = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

export function toGray(image: RgbaImage): GrayImage {
  const data = new Uint8Array(image.width * image.height);
  for (let i = 0; i < data.length; i++) {
    const o = i * 4;
    data[i] = Math.round(
      0.299 * (image.data[o] ?? 0) +
        0.587 * (image.data[o + 1] ?? 0) +
        0.114 * (image.data[o + 2] ?? 0),
    );
  }
  return { width: image.width, height: image.height, data };
}

/**
 * Snaps manually placed corners to the board's actual square borders (calibration
 * refinement, not automatic detection: the search stays within `maxShiftSquares` of the
 * user's corners). The objective is the luminance contrast measured across the 18
 * projected grid lines — maximal when the grid coincides with the square borders, whatever
 * the pieces, since adjacent squares always alternate dark/light.
 *
 * Search: coordinate descent with shrinking steps, then "basin hopping" — each corner
 * tries jumps of `HOP_SQUARES` in 8 directions followed by a new descent, kept only when
 * the score rises. Candidates that fail corner validation are rejected.
 */
export function refineCorners(
  image: GrayImage,
  canonical: CalibrationCorners,
  options: RefinementOptions = DEFAULT_REFINEMENT,
): RefinementResult {
  const initial = cornersToArray(canonical).map((p) => ({ ...p }));
  const size = { width: image.width, height: image.height };
  const squarePx = localSquareSizes(canonical);
  const meanSquarePx = squarePx.reduce((sum, value) => sum + value, 0) / squarePx.length;
  const scoreBefore = gridScore(image, canonical, options.samplesPerLine);

  const allowed = (corner: number, point: Point2D): boolean =>
    distance(point, initial[corner] as Point2D) <=
    options.maxShiftSquares * (squarePx[corner] ?? 0);
  /** Search uses fewer samples per line; the final polish uses the full count. */
  const searchSamples = Math.max(8, Math.round(options.samplesPerLine / SEARCH_SAMPLE_DIVISOR));
  const score = (points: { x: number; y: number }[], samples: number): number | null => {
    const corners = cornersFromArray(points as unknown as QuadPoints);
    return validateCalibrationCorners(corners, size).valid
      ? gridScore(image, corners, samples)
      : null;
  };

  const descend = (
    start: { x: number; y: number }[],
    startScore: number,
    samples: number,
    firstStep: number,
    lastStep: number,
  ) => {
    let best = start.map((p) => ({ ...p }));
    let bestScore = startScore;
    for (let step = firstStep; step >= lastStep; step /= 2) {
      let improved = true;
      while (improved) {
        improved = false;
        for (let corner = 0; corner < 4; corner++) {
          for (const axis of ['x', 'y'] as const) {
            for (const sign of [1, -1]) {
              const candidate = best.map((p) => ({ ...p }));
              const point = candidate[corner] as { x: number; y: number };
              point[axis] += sign * step;
              if (!allowed(corner, point)) continue;
              const value = score(candidate, samples);
              if (value !== null && value > bestScore * (1 + MIN_RELATIVE_GAIN)) {
                best = candidate;
                bestScore = value;
                improved = true;
              }
            }
          }
        }
      }
    }
    return { points: best, value: bestScore };
  };

  const searchStart = gridScore(image, canonical, searchSamples);
  const firstStep = meanSquarePx * DESCENT_START_SQUARES;
  const searchLastStep = Math.max(options.minStepPx, SEARCH_MIN_STEP_PX);
  let best = descend(initial, searchStart, searchSamples, firstStep, searchLastStep);
  for (let round = 0; round < HOP_ROUNDS; round++) {
    let hopped = false;
    for (let corner = 0; corner < 4; corner++) {
      const hop = HOP_SQUARES * (squarePx[corner] ?? 0);
      for (const [dx, dy] of HOP_DIRECTIONS) {
        const candidate = best.points.map((p) => ({ ...p }));
        const point = candidate[corner] as { x: number; y: number };
        point.x += dx * hop;
        point.y += dy * hop;
        if (!allowed(corner, point)) continue;
        const start = score(candidate, searchSamples);
        if (start === null) continue;
        const local = descend(candidate, start, searchSamples, hop / 2, searchLastStep);
        if (local.value > best.value * (1 + MIN_RELATIVE_GAIN)) {
          best = local;
          hopped = true;
        }
      }
    }
    if (!hopped) break;
  }

  // Final polish at full resolution, from a small step.
  const polishStart = score(best.points, options.samplesPerLine) ?? scoreBefore;
  const polished = descend(
    best.points,
    polishStart,
    options.samplesPerLine,
    POLISH_FIRST_STEP_PX,
    options.minStepPx,
  );
  const final = polished.value >= scoreBefore ? polished : { points: initial, value: scoreBefore };

  return {
    corners: cornersFromArray(final.points as unknown as QuadPoints),
    scoreBefore,
    scoreAfter: final.value,
    maxShiftPx: Math.max(...final.points.map((p, i) => distance(p, initial[i] as Point2D))),
  };
}

/** Contrast across the projected grid lines (higher = better aligned). */
export function gridScore(
  image: GrayImage,
  canonical: CalibrationCorners,
  samplesPerLine = 48,
): number {
  const homography = computeHomography(UNIT_SQUARE, cornersToArray(canonical));
  if (!homography) {
    return 0;
  }
  let total = 0;
  let weight = 0;
  const square = 1 / BOARD_SIZE;
  for (let k = 0; k <= BOARD_SIZE; k++) {
    const lineWeight = k === 0 || k === BOARD_SIZE ? OUTER_LINE_WEIGHT : 1;
    const t = k * square;
    // Horizontal line (v = t), contrast along v; vertical line (u = t), contrast along u.
    for (const horizontal of [true, false]) {
      const fine: number[] = [];
      const coarse: number[] = [];
      for (let i = 0; i < samplesPerLine; i++) {
        const s = (i + 0.5) / samplesPerLine;
        const u = horizontal ? s : t;
        const v = horizontal ? t : s;
        const du = horizontal ? 0 : 1;
        const dv = horizontal ? 1 : 0;
        const squarePx = localSquarePx(homography, u, v, du, dv);
        const fineOffset = squarePx > 0 ? (FINE_OFFSET_PX / squarePx) * square : 0;
        const f = crossContrast(image, homography, u, v, du * fineOffset, dv * fineOffset);
        const c = crossContrast(
          image,
          homography,
          u,
          v,
          du * COARSE_OFFSET * square,
          dv * COARSE_OFFSET * square,
        );
        if (!Number.isNaN(f)) fine.push(f);
        if (!Number.isNaN(c)) coarse.push(c);
      }
      if (fine.length > 0 && coarse.length > 0) {
        total += lineWeight * (trimmedMean(fine) + COARSE_WEIGHT * trimmedMean(coarse));
        weight += lineWeight * (1 + COARSE_WEIGHT);
      }
    }
  }
  return weight === 0 ? 0 : total / weight;
}

/** Pixels spanned by one square along (du, dv) around (u, v). */
function localSquarePx(
  homography: Homography,
  u: number,
  v: number,
  du: number,
  dv: number,
): number {
  const half = 0.5 / BOARD_SIZE;
  return distance(
    applyHomography(homography, { x: u - du * half, y: v - dv * half }),
    applyHomography(homography, { x: u + du * half, y: v + dv * half }),
  );
}

function trimmedMean(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const cut = Math.floor(sorted.length * TRIM);
  const kept = sorted.slice(cut, sorted.length - cut);
  const used = kept.length > 0 ? kept : sorted;
  return used.reduce((sum, value) => sum + value, 0) / used.length;
}

function crossContrast(
  image: GrayImage,
  homography: Homography,
  u: number,
  v: number,
  du: number,
  dv: number,
): number {
  const a = sample(image, applyHomography(homography, { x: u - du, y: v - dv }));
  const b = sample(image, applyHomography(homography, { x: u + du, y: v + dv }));
  return a === null || b === null ? Number.NaN : Math.abs(a - b);
}

/** Bilinear sample; null outside the image. */
function sample(image: GrayImage, p: Point2D): number | null {
  const x = p.x - 0.5;
  const y = p.y - 0.5;
  if (!(x >= 0 && y >= 0 && x < image.width - 1 && y < image.height - 1)) {
    return null;
  }
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const at = (px: number, py: number): number => image.data[py * image.width + px] ?? 0;
  const top = at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx;
  const bottom = at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx;
  return top * (1 - fy) + bottom * fy;
}

/** Approximate size of one square, in pixels, at each corner. */
function localSquareSizes(canonical: CalibrationCorners): number[] {
  const [tl, tr, br, bl] = cornersToArray(canonical);
  const edge = (a: Point2D, b: Point2D): number => distance(a, b) / BOARD_SIZE;
  return [
    Math.min(edge(tl, tr), edge(tl, bl)),
    Math.min(edge(tr, tl), edge(tr, br)),
    Math.min(edge(br, tr), edge(br, bl)),
    Math.min(edge(bl, br), edge(bl, tl)),
  ];
}
