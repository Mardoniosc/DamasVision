import {
  columnOf,
  isOnBoard,
  isPlayableSquare,
  isValidSquareIndex,
  PLAYABLE_SQUARE_COUNT,
  PLAYABLE_SQUARES,
  rowOf,
  SQUARE_COUNT,
  squareIndex,
} from './board';

describe('board conventions', () => {
  it('uses a 64-cell linear index row * 8 + column', () => {
    expect(SQUARE_COUNT).toBe(64);
    expect(squareIndex(0, 0)).toBe(0);
    expect(squareIndex(0, 7)).toBe(7);
    expect(squareIndex(7, 0)).toBe(56);
    expect(squareIndex(7, 7)).toBe(63);
    expect(rowOf(42)).toBe(5);
    expect(columnOf(42)).toBe(2);
  });

  it('round-trips every index', () => {
    for (let index = 0; index < SQUARE_COUNT; index++) {
      expect(squareIndex(rowOf(index), columnOf(index))).toBe(index);
    }
  });

  it('has 32 playable dark squares with (row + column) odd', () => {
    expect(PLAYABLE_SQUARES).toHaveLength(PLAYABLE_SQUARE_COUNT);
    expect(PLAYABLE_SQUARES.slice(0, 4)).toEqual([1, 3, 5, 7]);
    expect(PLAYABLE_SQUARES.every((index) => (rowOf(index) + columnOf(index)) % 2 === 1)).toBe(
      true,
    );
  });

  it('makes the bottom-left square of each side playable', () => {
    expect(isPlayableSquare(squareIndex(7, 0))).toBe(true); // White's left (canonical bottom)
    expect(isPlayableSquare(squareIndex(0, 7))).toBe(true); // Black's left (canonical top)
    expect(isPlayableSquare(squareIndex(7, 7))).toBe(false);
  });

  it.each([-1, 64, 1.5, Number.NaN])('rejects invalid index %p', (index) => {
    expect(isValidSquareIndex(index)).toBe(false);
    expect(() => rowOf(index)).toThrow(RangeError);
  });

  it('rejects coordinates outside the board', () => {
    expect(isOnBoard(8, 0)).toBe(false);
    expect(isOnBoard(0, -1)).toBe(false);
    expect(() => squareIndex(8, 0)).toThrow(RangeError);
  });
});
