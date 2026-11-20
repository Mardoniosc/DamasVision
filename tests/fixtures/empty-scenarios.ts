import { Piece } from '../../src/app/domain/board/piece';
import { RgbaImage } from '../../src/app/vision/perspective';
import { REAL_SET_BLUE_BOARD, RenderOptions, startingPosition } from './synthetic-board';

/**
 * EMPTY-specific scenarios (G3): synthetic boards with artifacts on empty squares (shadows,
 * glare, a fingertip, a hand, a phone). Used by tests/integration/recognition-empty.spec.ts
 * and exported for the vision service's parity tests (G3.1).
 */

const emptyBoard = (): Piece[] => Array.from({ length: 64 }, () => 'EMPTY');
const sparse = (): Piece[] => {
  const cells = emptyBoard();
  cells[19] = 'WHITE';
  cells[28] = 'BLACK';
  cells[37] = 'BLACK';
  cells[44] = 'WHITE_KING';
  return cells;
};

/** Dark squares (playable) used to place artifacts: centers in pixels. */
const DARK_CENTERS: readonly [number, number][] = [
  [350, 250],
  [450, 350],
  [150, 450],
];

function paintEllipse(
  image: RgbaImage,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  rgb: readonly number[],
) {
  for (let y = Math.floor(cy - ry); y < cy + ry; y++) {
    for (let x = Math.floor(cx - rx); x < cx + rx; x++) {
      if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) {
        image.data.set([...rgb, 255], (y * image.width + x) * 4);
      }
    }
  }
}

function paintRect(
  image: RgbaImage,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  rgb: readonly number[],
) {
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) image.data.set([...rgb, 255], (y * image.width + x) * 4);
  }
}

const SKIN = [205, 160, 130];
const GLARE = [252, 250, 245];

export interface EmptyScenario {
  readonly name: string;
  readonly position: () => Piece[];
  readonly options: RenderOptions;
  readonly paint?: (image: RgbaImage) => void;
  /** Minimum empty squares read EMPTY (recall floor), when the scenario is not adversarial. */
  readonly minEmptyRecall?: number;
}

export const EMPTY_SCENARIOS: readonly EmptyScenario[] = [
  { name: 'empty board, ideal', position: emptyBoard, options: {}, minEmptyRecall: 1 },
  {
    name: 'empty board, dim light',
    position: emptyBoard,
    options: { brightness: 0.55 },
    minEmptyRecall: 1,
  },
  {
    name: 'empty board, bright light',
    position: emptyBoard,
    options: { brightness: 1.2 },
    minEmptyRecall: 1,
  },
  {
    name: 'empty board, side gradient',
    position: emptyBoard,
    options: { gradient: [0.6, 1.15] },
    minEmptyRecall: 1,
  },
  {
    name: 'empty board, sensor noise',
    position: emptyBoard,
    options: { noise: 10, seed: 3 },
    minEmptyRecall: 1,
  },
  {
    name: 'empty board, local shadow',
    position: emptyBoard,
    options: { shadow: { x: 300, y: 420, radius: 220, factor: 0.6 } },
    minEmptyRecall: 1,
  },
  {
    name: 'empty board, very dark shadow (UNKNOWN allowed)',
    position: emptyBoard,
    options: { shadow: { x: 400, y: 400, radius: 250, factor: 0.4 } },
  },
  {
    name: 'empty blue board',
    position: emptyBoard,
    options: REAL_SET_BLUE_BOARD,
    minEmptyRecall: 1,
  },
  {
    name: 'empty blue board, dim + noise',
    position: emptyBoard,
    options: { ...REAL_SET_BLUE_BOARD, brightness: 0.6, noise: 8 },
    minEmptyRecall: 1,
  },
  {
    name: 'shadows cast by adjacent tall pieces',
    position: startingPosition,
    options: { ...REAL_SET_BLUE_BOARD, castShadow: { dx: -0.2, dy: 0.3, factor: 0.35 } },
    minEmptyRecall: 1,
  },
  {
    name: 'few tall pieces with strong cast shadows',
    position: sparse,
    options: { ...REAL_SET_BLUE_BOARD, castShadow: { dx: -0.25, dy: 0.3, factor: 0.35 } },
    minEmptyRecall: 1,
  },
  {
    name: 'glare spots beside the center',
    position: emptyBoard,
    options: {},
    paint: (image) =>
      DARK_CENTERS.forEach(([x, y]) => paintEllipse(image, x + 22, y - 18, 25, 18, GLARE)),
  },
  {
    name: 'small glare spots at the center',
    position: emptyBoard,
    options: {},
    paint: (image) => DARK_CENTERS.forEach(([x, y]) => paintEllipse(image, x, y, 15, 12, GLARE)),
  },
  {
    // Edge case: radius ≈ 0.26 square, ring coverage 0.49 vs the 0.5 threshold (narrow margin).
    name: 'large glare spots at the center',
    position: emptyBoard,
    options: {},
    paint: (image) => DARK_CENTERS.forEach(([x, y]) => paintEllipse(image, x, y, 28, 24, GLARE)),
  },
  {
    name: 'glare on the blue board',
    position: emptyBoard,
    options: REAL_SET_BLUE_BOARD,
    paint: (image) =>
      DARK_CENTERS.forEach(([x, y]) => paintEllipse(image, x + 15, y - 15, 30, 20, GLARE)),
  },
  {
    name: 'fingertip over an empty square',
    position: emptyBoard,
    options: {},
    paint: (image) => paintEllipse(image, 350, 230, 22, 45, SKIN),
  },
  {
    name: 'hand over the empty rows of the starting position',
    position: startingPosition,
    options: {},
    paint: (image) => paintRect(image, 150, 320, 650, 480, SKIN),
  },
  {
    name: 'hand over an empty board',
    position: emptyBoard,
    options: {},
    paint: (image) => paintRect(image, 200, 200, 600, 600, SKIN),
  },
  {
    name: 'phone (1.4 × 2.8 squares) lying on the board',
    position: emptyBoard,
    options: {},
    paint: (image) => paintRect(image, 380, 220, 520, 500, [20, 20, 22]),
  },
];
