import { squareFromName } from '../../src/app/domain/board/board-notation';
import { BoardState, emptyBoard, Piece } from '../../src/app/domain/board/piece';

/**
 * Engine test fixtures: build a board from named squares,
 * e.g. `position({ c3: 'WHITE', d4: 'BLACK' })`.
 */
export function position(pieces: Readonly<Record<string, Piece>>): BoardState {
  const cells = [...emptyBoard().cells];
  for (const [name, piece] of Object.entries(pieces)) cells[squareFromName(name)] = piece;
  return { cells };
}

export const sq = squareFromName;
