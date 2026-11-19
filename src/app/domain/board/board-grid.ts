import { BOARD_SIZE, isPlayableSquare, PLAYABLE_SQUARES, SQUARE_COUNT, SquareIndex } from './board';
import { CalibrationCorners, cornersToArray } from './calibration';
import { Point2D, Rect, Size2D } from './geometry';
import { applyHomography, computeHomography, QuadPoints } from './homography';

/** Spec §5 contract. Geometry is separate from recognition output. */
export interface SquareGeometry {
  readonly index: SquareIndex;
  readonly row: number;
  readonly column: number;
  readonly bounds: Rect;
  readonly center: Point2D;
  readonly isPlayable: boolean;
}

/** Canonical 8×8 grid over a normalized board image (E2-T05). */
export function createBoardGrid(size: Size2D): readonly SquareGeometry[] {
  assertPositive(size);
  const squareWidth = size.width / BOARD_SIZE;
  const squareHeight = size.height / BOARD_SIZE;
  return Array.from({ length: SQUARE_COUNT }, (_, index) => {
    const row = Math.floor(index / BOARD_SIZE);
    const column = index % BOARD_SIZE;
    const bounds: Rect = {
      x: column * squareWidth,
      y: row * squareHeight,
      width: squareWidth,
      height: squareHeight,
    };
    return {
      index,
      row,
      column,
      bounds,
      center: { x: bounds.x + squareWidth / 2, y: bounds.y + squareHeight / 2 },
      isPlayable: isPlayableSquare(index),
    };
  });
}

/**
 * Central region of interest inside a square, inset by `insetRatio` of the square size
 * on each edge, to reduce interference from neighbouring squares and grid lines.
 */
export function squareRoi(square: SquareGeometry, insetRatio: number): Rect {
  if (!(insetRatio >= 0 && insetRatio < 0.5)) {
    throw new RangeError(`insetRatio must be in [0, 0.5), got ${insetRatio}`);
  }
  const dx = square.bounds.width * insetRatio;
  const dy = square.bounds.height * insetRatio;
  return {
    x: square.bounds.x + dx,
    y: square.bounds.y + dy,
    width: square.bounds.width - 2 * dx,
    height: square.bounds.height - 2 * dy,
  };
}

export interface LineSegment {
  readonly from: Point2D;
  readonly to: Point2D;
}

/** Canonical board grid projected back onto the camera image, for the calibration overlay. */
export interface ProjectedBoardOverlay {
  /** 9 horizontal + 9 vertical grid lines. */
  readonly gridLines: readonly LineSegment[];
  /** Centers of the 32 playable squares, in square-index order. */
  readonly playableCenters: readonly Point2D[];
  /** Midpoints of the canonical bottom (White) and top (Black) edges. */
  readonly whiteSideMidpoint: Point2D;
  readonly blackSideMidpoint: Point2D;
  /** Anchors just outside those edges, for side labels that do not cover the grid. */
  readonly whiteLabelAnchor: Point2D;
  readonly blackLabelAnchor: Point2D;
}

/** Distance of the side labels from the board edge, as a fraction of the board size. */
const SIDE_LABEL_OFFSET = 0.05;

const UNIT_SQUARE: QuadPoints = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

/** Returns `null` when the corners are degenerate (no homography exists). */
export function projectBoardOverlay(canonical: CalibrationCorners): ProjectedBoardOverlay | null {
  const homography = computeHomography(UNIT_SQUARE, cornersToArray(canonical));
  if (!homography) {
    return null;
  }
  const project = (x: number, y: number): Point2D => applyHomography(homography, { x, y });

  const gridLines: LineSegment[] = [];
  for (let i = 0; i <= BOARD_SIZE; i++) {
    const t = i / BOARD_SIZE;
    gridLines.push({ from: project(0, t), to: project(1, t) });
    gridLines.push({ from: project(t, 0), to: project(t, 1) });
  }

  const playableCenters = PLAYABLE_SQUARES.map((index) => {
    const row = Math.floor(index / BOARD_SIZE);
    const column = index % BOARD_SIZE;
    return project((column + 0.5) / BOARD_SIZE, (row + 0.5) / BOARD_SIZE);
  });

  return {
    gridLines,
    playableCenters,
    whiteSideMidpoint: project(0.5, 1),
    blackSideMidpoint: project(0.5, 0),
    whiteLabelAnchor: project(0.5, 1 + SIDE_LABEL_OFFSET),
    blackLabelAnchor: project(0.5, -SIDE_LABEL_OFFSET),
  };
}

function assertPositive(size: Size2D): void {
  if (!(size.width > 0 && size.height > 0)) {
    throw new RangeError(`invalid board size ${size.width}x${size.height}`);
  }
}
