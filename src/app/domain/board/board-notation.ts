import { BOARD_SIZE, SquareIndex } from './board';

const FILES = 'abcdefgh';

/**
 * Square name in algebraic style: files a–h left → right, ranks 1–8 from White's side
 * (canonical row 7 = rank 1).
 */
export function squareName(index: SquareIndex): string {
  const row = Math.floor(index / BOARD_SIZE);
  const column = index % BOARD_SIZE;
  return `${FILES[column]}${BOARD_SIZE - row}`;
}

export const FILE_LETTERS: readonly string[] = FILES.split('');

/** Inverse of `squareName` ("c3" → index); throws RangeError on an invalid name. */
export function squareFromName(name: string): SquareIndex {
  const column = FILES.indexOf(name[0] ?? '');
  const rank = Number(name.slice(1));
  if (name.length !== 2 || column < 0 || !Number.isInteger(rank) || rank < 1 || rank > BOARD_SIZE) {
    throw new RangeError(`invalid square name "${name}"`);
  }
  return (BOARD_SIZE - rank) * BOARD_SIZE + column;
}
