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
