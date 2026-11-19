/**
 * Board conventions (docs/execution-specification.md §5, documented in
 * docs/vision/calibration.md):
 * - 8 rows × 8 columns, linear index `row * 8 + column`.
 * - `row = 0` is the top of the normalized (canonical) board image, `column = 0` its left.
 * - Playable squares are the dark squares: `(row + column)` is odd, so the bottom-left
 *   square (7, 0) is playable — the standard placement for Brazilian 64-square checkers.
 * - Canonical orientation: row 7 (bottom) is White's side, row 0 (top) Black's side.
 */
export type SquareIndex = number;

export const BOARD_SIZE = 8;
export const SQUARE_COUNT = BOARD_SIZE * BOARD_SIZE;
export const PLAYABLE_SQUARE_COUNT = SQUARE_COUNT / 2;

export function isValidSquareIndex(index: number): index is SquareIndex {
  return Number.isInteger(index) && index >= 0 && index < SQUARE_COUNT;
}

export function squareIndex(row: number, column: number): SquareIndex {
  if (!isOnBoard(row, column)) {
    throw new RangeError(`square (${row}, ${column}) is outside the board`);
  }
  return row * BOARD_SIZE + column;
}

export function isOnBoard(row: number, column: number): boolean {
  return (
    Number.isInteger(row) &&
    Number.isInteger(column) &&
    row >= 0 &&
    row < BOARD_SIZE &&
    column >= 0 &&
    column < BOARD_SIZE
  );
}

export function rowOf(index: SquareIndex): number {
  assertSquareIndex(index);
  return Math.floor(index / BOARD_SIZE);
}

export function columnOf(index: SquareIndex): number {
  assertSquareIndex(index);
  return index % BOARD_SIZE;
}

export function isPlayableSquare(index: SquareIndex): boolean {
  return (rowOf(index) + columnOf(index)) % 2 === 1;
}

/** The 32 playable square indices in ascending order. */
export const PLAYABLE_SQUARES: readonly SquareIndex[] = Array.from(
  { length: SQUARE_COUNT },
  (_, index) => index,
).filter(isPlayableSquare);

function assertSquareIndex(index: number): void {
  if (!isValidSquareIndex(index)) {
    throw new RangeError(`invalid square index ${index}`);
  }
}
