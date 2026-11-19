import { BOARD_SIZE, isPlayableSquare, SQUARE_COUNT } from '../../src/app/domain/board/board';
import { CalibrationCorners, cornersToArray } from '../../src/app/domain/board/calibration';
import { Size2D } from '../../src/app/domain/board/geometry';
import {
  applyHomography,
  computeHomography,
  Homography,
} from '../../src/app/domain/board/homography';
import { ObservedPiece, Piece } from '../../src/app/domain/board/piece';
import { RgbaImage } from '../../src/app/vision/perspective';

/**
 * Deterministic renderer of synthetic boards for recognition tests and the E2E fake
 * camera. Produces normalized (top-down) boards and perspective camera views, with
 * controllable lighting, noise, shadows and piece placement.
 */

export type Rgb = readonly [number, number, number];

export interface RenderOptions {
  readonly size?: number;
  readonly lightSquare?: Rgb;
  readonly darkSquare?: Rgb;
  readonly whitePiece?: Rgb;
  readonly blackPiece?: Rgb;
  /** Central mark that distinguishes kings (spec §7: standardized marked kings). */
  readonly whiteKingMark?: Rgb;
  readonly blackKingMark?: Rgb;
  /** Piece radius relative to the square size. */
  readonly pieceRadiusRatio?: number;
  readonly kingMarkRadiusRatio?: number;
  /** Global brightness multiplier. */
  readonly brightness?: number;
  /** Horizontal lighting gradient: multiplier at the left and right edges. */
  readonly gradient?: readonly [number, number];
  /** Darkened circular region (x, y, radius in pixels; factor < 1). */
  readonly shadow?: {
    readonly x: number;
    readonly y: number;
    readonly radius: number;
    readonly factor: number;
  };
  /** Gaussian pixel noise standard deviation (8-bit units). */
  readonly noise?: number;
  /** Maximum random piece offset from the square center, relative to the square size. */
  readonly jitter?: number;
  readonly seed?: number;
  /**
   * Piece height in square units (0 = flat disc seen from above). Seen by an oblique
   * camera at the canonical bottom, a piece's top face is displaced towards the far side
   * (row 0) and its side fills the gap, more so in far rows (perspective).
   */
  readonly pieceHeight?: number;
  /** Concentric grooves and a darker hollow center on the top face, like many real pieces. */
  readonly ridges?: boolean;
  /** Shadow cast by every piece on the board: offset in square units and darkening factor. */
  readonly castShadow?: { readonly dx: number; readonly dy: number; readonly factor: number };
  /** 'mark' = colored central mark (default); 'stacked' = two pieces, taller, no mark. */
  readonly kingStyle?: 'mark' | 'stacked';
}

/** How much longer the projection of a piece is in the farthest row than in the nearest. */
const PERSPECTIVE_GROWTH = 0.8;
/** Relative luminance of the side of a tall piece. */
const SIDE_SHADE = 0.78;

export const DEFAULT_RENDER: Required<Omit<RenderOptions, 'shadow' | 'gradient' | 'castShadow'>> = {
  size: 800,
  lightSquare: [232, 214, 176],
  darkSquare: [112, 72, 42],
  whitePiece: [242, 238, 228],
  blackPiece: [28, 26, 28],
  whiteKingMark: [150, 30, 30],
  blackKingMark: [222, 180, 60],
  pieceRadiusRatio: 0.4,
  kingMarkRadiusRatio: 0.13,
  brightness: 1,
  noise: 0,
  jitter: 0,
  seed: 1,
  pieceHeight: 0,
  ridges: false,
  kingStyle: 'mark',
};

/** The physical set of the first real-world test: blue/cream board, tall grooved pieces. */
export const REAL_SET_BLUE_BOARD: RenderOptions = {
  lightSquare: [236, 228, 205],
  darkSquare: [28, 108, 188],
  whitePiece: [236, 236, 232],
  blackPiece: [34, 34, 36],
  pieceRadiusRatio: 0.38,
  pieceHeight: 0.35,
  ridges: true,
  castShadow: { dx: -0.14, dy: 0.2, factor: 0.55 },
};

/** Seeded PRNG (mulberry32) so every rendering is reproducible. */
export function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(next: () => number): number {
  const u = Math.max(next(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * next());
}

/** Initial position: Black on rows 0–2, White on rows 5–7 (canonical orientation). */
export function startingPosition(): Piece[] {
  return Array.from({ length: SQUARE_COUNT }, (_, index) => {
    if (!isPlayableSquare(index)) return 'EMPTY';
    const row = Math.floor(index / BOARD_SIZE);
    return row <= 2 ? 'BLACK' : row >= 5 ? 'WHITE' : 'EMPTY';
  });
}

/** A mid-game position with kings of both colors and empty playable squares. */
export function midgamePosition(): Piece[] {
  const cells: Piece[] = Array.from({ length: SQUARE_COUNT }, () => 'EMPTY');
  const place: Record<number, Piece> = {
    1: 'BLACK',
    3: 'BLACK',
    10: 'BLACK',
    12: 'BLACK_KING',
    17: 'BLACK',
    21: 'BLACK',
    26: 'WHITE_KING',
    28: 'BLACK',
    33: 'WHITE',
    35: 'WHITE',
    42: 'WHITE',
    44: 'BLACK_KING',
    49: 'WHITE',
    51: 'WHITE',
    58: 'WHITE_KING',
    62: 'WHITE',
  };
  for (const [index, piece] of Object.entries(place)) {
    cells[Number(index)] = piece;
  }
  return cells;
}

/** Renders a normalized (rectified) board of `size`×`size` pixels. */
export function renderNormalizedBoard(
  cells: readonly Piece[],
  options: RenderOptions = {},
): RgbaImage {
  const o = { ...DEFAULT_RENDER, ...options };
  const size = o.size;
  const square = size / BOARD_SIZE;
  const next = random(o.seed);
  const offsets = cells.map(() => ({
    dx: (next() * 2 - 1) * o.jitter * square,
    dy: (next() * 2 - 1) * o.jitter * square,
  }));
  const pixels = size * size;
  const color = new Float32Array(pixels * 3);
  /** 1 where a piece was drawn: cast shadows only darken the board. */
  const isPiece = new Uint8Array(pixels);
  const castLight = new Float32Array(pixels).fill(1);

  // 1. Board.
  for (let y = 0; y < size; y++) {
    const row = Math.min(BOARD_SIZE - 1, Math.floor(y / square));
    for (let x = 0; x < size; x++) {
      const column = Math.min(BOARD_SIZE - 1, Math.floor(x / square));
      const squareColor = isPlayableSquare(row * BOARD_SIZE + column)
        ? o.darkSquare
        : o.lightSquare;
      color.set(squareColor, (y * size + x) * 3);
    }
  }

  const radius = o.pieceRadiusRatio * square;
  const pieces = cells.flatMap((piece, index) => {
    if (piece === 'EMPTY') return [];
    const row = Math.floor(index / BOARD_SIZE);
    const column = index % BOARD_SIZE;
    const offset = offsets[index] ?? { dx: 0, dy: 0 };
    const king = piece === 'WHITE_KING' || piece === 'BLACK_KING';
    const stacked = king && o.kingStyle === 'stacked';
    const growth = 1 + (PERSPECTIVE_GROWTH * (BOARD_SIZE - 1 - row)) / (BOARD_SIZE - 1);
    const height = o.pieceHeight * (stacked ? 1.8 : 1) * square * growth;
    const baseX = (column + 0.5) * square + offset.dx;
    const baseY = (row + 0.5) * square + offset.dy;
    return [{ piece, row, baseX, baseY, topY: baseY - height, king, stacked }];
  });

  // 2. Cast shadows (board only; applied with the lighting).
  if (options.castShadow) {
    const { dx, dy, factor } = options.castShadow;
    for (const p of pieces) {
      const cx = p.baseX + dx * square;
      const cy = p.baseY + dy * square;
      forEachPixel(size, cx - radius, cy - radius, cx + radius, cy + radius, (x, y) => {
        if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= radius) {
          castLight[y * size + x] = factor;
        }
      });
    }
  }

  // 3. Pieces, far rows first so that nearer pieces overlap them.
  for (const p of [...pieces].sort((a, b) => a.row - b.row)) {
    const white = p.piece === 'WHITE' || p.piece === 'WHITE_KING';
    const body = white ? o.whitePiece : o.blackPiece;
    const mark = white ? o.whiteKingMark : o.blackKingMark;
    forEachPixel(
      size,
      p.baseX - radius,
      p.topY - radius,
      p.baseX + radius,
      p.baseY + radius,
      (x, y) => {
        const px = x + 0.5;
        const py = y + 0.5;
        const topDistance = Math.hypot(px - p.baseX, py - p.topY);
        // The silhouette is a capsule: the top face plus the side down to the base.
        const clampedY = Math.min(p.baseY, Math.max(p.topY, py));
        const sideDistance = Math.hypot(px - p.baseX, py - clampedY);
        let shade: number;
        let rgb: Rgb = body;
        if (topDistance <= radius) {
          const t = topDistance / radius;
          shade = (1 - 0.12 * t * t) * topTexture(t, o.ridges);
          if (p.king && !p.stacked && topDistance <= o.kingMarkRadiusRatio * square) {
            rgb = mark;
            shade = 1;
          }
        } else if (sideDistance <= radius) {
          shade = SIDE_SHADE;
        } else {
          return;
        }
        const i = y * size + x;
        color.set([rgb[0] * shade, rgb[1] * shade, rgb[2] * shade], i * 3);
        isPiece[i] = 1;
      },
    );
  }

  // 4. Lighting and noise.
  const data = new Uint8ClampedArray(pixels * 4);
  const noise = random(o.seed + 7919);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      let light = o.brightness;
      if (options.gradient) {
        light *= options.gradient[0] + ((options.gradient[1] - options.gradient[0]) * x) / size;
      }
      if (
        options.shadow &&
        Math.hypot(x - options.shadow.x, y - options.shadow.y) < options.shadow.radius
      ) {
        light *= options.shadow.factor;
      }
      if (!isPiece[i]) {
        light *= castLight[i] ?? 1;
      }
      for (let c = 0; c < 3; c++) {
        const jitter = o.noise > 0 ? gaussian(noise) * o.noise : 0;
        data[i * 4 + c] = (color[i * 3 + c] ?? 0) * light + jitter;
      }
      data[i * 4 + 3] = 255;
    }
  }
  return { width: size, height: size, data };
}

/** Luminance factor of a piece's top face at relative radius `t` (0 = center). */
function topTexture(t: number, ridges: boolean): number {
  if (!ridges) {
    return Math.abs(t - 0.62) < 0.03 ? 0.93 : 1;
  }
  if (t < 0.22) return 0.6; // hollow center in shadow
  return [0.38, 0.55, 0.75].some((ring) => Math.abs(t - ring) < 0.035) ? 0.8 : 1;
}

function forEachPixel(
  size: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  visit: (x: number, y: number) => void,
): void {
  for (let y = Math.max(0, Math.floor(y0)); y < Math.min(size, Math.ceil(y1)); y++) {
    for (let x = Math.max(0, Math.floor(x0)); x < Math.min(size, Math.ceil(x1)); x++) {
      visit(x, y);
    }
  }
}

/**
 * Projects a normalized board into a camera image (bilinear sampling) with the board
 * corners at `corners`; everything else is `background`.
 */
export function renderCameraView(
  board: RgbaImage,
  corners: CalibrationCorners,
  source: Size2D,
  background: Rgb = [90, 120, 95],
): RgbaImage {
  const toBoard = computeHomography(cornersToArray(corners), [
    { x: 0, y: 0 },
    { x: board.width, y: 0 },
    { x: board.width, y: board.height },
    { x: 0, y: board.height },
  ]) as Homography;
  const data = new Uint8ClampedArray(source.width * source.height * 4);
  for (let y = 0; y < source.height; y++) {
    for (let x = 0; x < source.width; x++) {
      const p = applyHomography(toBoard, { x: x + 0.5, y: y + 0.5 });
      const offset = (y * source.width + x) * 4;
      if (p.x < 0 || p.y < 0 || p.x >= board.width || p.y >= board.height) {
        data.set([...background, 255], offset);
        continue;
      }
      const sample = bilinear(board, p.x - 0.5, p.y - 0.5);
      data.set([sample[0], sample[1], sample[2], 255], offset);
    }
  }
  return { ...source, data };
}

function bilinear(image: RgbaImage, x: number, y: number): [number, number, number] {
  const x0 = Math.max(0, Math.min(image.width - 1, Math.floor(x)));
  const y0 = Math.max(0, Math.min(image.height - 1, Math.floor(y)));
  const x1 = Math.min(image.width - 1, x0 + 1);
  const y1 = Math.min(image.height - 1, y0 + 1);
  const fx = Math.min(1, Math.max(0, x - x0));
  const fy = Math.min(1, Math.max(0, y - y0));
  const at = (px: number, py: number, c: number): number =>
    image.data[(py * image.width + px) * 4 + c] ?? 0;
  const out: [number, number, number] = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const top = at(x0, y0, c) * (1 - fx) + at(x1, y0, c) * fx;
    const bottom = at(x0, y1, c) * (1 - fx) + at(x1, y1, c) * fx;
    out[c] = top * (1 - fy) + bottom * fy;
  }
  return out;
}

export interface RecognitionScore {
  readonly playable: number;
  readonly correct: number;
  readonly unknown: number;
  /** Confidently wrong squares: the outcome the system must avoid. */
  readonly wrong: number;
  readonly accuracy: number;
  readonly errors: readonly { index: number; expected: Piece; observed: ObservedPiece }[];
}

export function scoreRecognition(
  expected: readonly Piece[],
  observed: readonly ObservedPiece[],
): RecognitionScore {
  let correct = 0;
  let unknown = 0;
  const errors: { index: number; expected: Piece; observed: ObservedPiece }[] = [];
  for (let index = 0; index < SQUARE_COUNT; index++) {
    if (!isPlayableSquare(index)) continue;
    const want = expected[index] ?? 'EMPTY';
    const got = observed[index] ?? 'UNKNOWN';
    if (got === want) correct++;
    else if (got === 'UNKNOWN') unknown++;
    else errors.push({ index, expected: want, observed: got });
  }
  const playable = SQUARE_COUNT / 2;
  return { playable, correct, unknown, wrong: errors.length, accuracy: correct / playable, errors };
}
