import { BOARD_SIZE, isPlayableSquare, SQUARE_COUNT } from '../board/board';
import { squareName } from '../board/board-notation';
import { BoardState, isKing, isPiece, Piece, pieceColor, PlayerColor } from '../board/piece';
import { BRAZILIAN_RULES, promotionRow } from '../rules/brazilian-rules';

/** Rows initially occupied by each side (docs/engine/brazilian-checkers-rules.md). */
const INITIAL_ROWS: Readonly<Record<PlayerColor, readonly number[]>> = {
  BLACK: [0, 1, 2],
  WHITE: [5, 6, 7],
};

/** The initial position: 12 black men on rows 0–2, 12 white men on rows 5–7. */
export function initialBoard(): BoardState {
  return {
    cells: Array.from({ length: SQUARE_COUNT }, (_, index): Piece => {
      if (!isPlayableSquare(index)) return 'EMPTY';
      const row = Math.floor(index / BOARD_SIZE);
      if (INITIAL_ROWS.BLACK.includes(row)) return 'BLACK';
      if (INITIAL_ROWS.WHITE.includes(row)) return 'WHITE';
      return 'EMPTY';
    }),
  };
}

export class InvalidBoardError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(`invalid board: ${issues.join('; ')}`);
    this.name = 'InvalidBoardError';
  }
}

/** Why a board is not a valid position, as data (for messages in any language). */
export type BoardProblem =
  | { readonly code: 'CELL_COUNT'; readonly count: number }
  | { readonly code: 'NOT_A_PIECE'; readonly square: number; readonly value: string }
  | { readonly code: 'LIGHT_SQUARE'; readonly square: number; readonly piece: Piece }
  | { readonly code: 'TOO_MANY_PIECES'; readonly color: PlayerColor; readonly count: number }
  | { readonly code: 'MAN_ON_PROMOTION_ROW'; readonly square: number; readonly piece: Piece };

/** Every reason why `board` cannot be a Brazilian checkers position (empty when valid). */
export function boardProblems(board: BoardState): BoardProblem[] {
  const cells: readonly unknown[] = board.cells;
  if (cells.length !== SQUARE_COUNT) return [{ code: 'CELL_COUNT', count: cells.length }];
  const problems: BoardProblem[] = [];
  const counts: Record<PlayerColor, number> = { WHITE: 0, BLACK: 0 };
  cells.forEach((cell, index) => {
    if (!isPiece(cell)) {
      problems.push({ code: 'NOT_A_PIECE', square: index, value: String(cell) });
      return;
    }
    const color = pieceColor(cell);
    if (!color) return;
    if (!isPlayableSquare(index)) {
      problems.push({ code: 'LIGHT_SQUARE', square: index, piece: cell });
      return;
    }
    counts[color]++;
    if (!isKing(cell) && Math.floor(index / BOARD_SIZE) === promotionRow(color)) {
      problems.push({ code: 'MAN_ON_PROMOTION_ROW', square: index, piece: cell });
    }
  });
  for (const color of ['WHITE', 'BLACK'] as const) {
    if (counts[color] > BRAZILIAN_RULES.piecesPerSide) {
      problems.push({ code: 'TOO_MANY_PIECES', color, count: counts[color] });
    }
  }
  return problems;
}

/** `boardProblems` as developer-facing English text. */
export function boardIssues(board: BoardState): string[] {
  return boardProblems(board).map((problem) => {
    switch (problem.code) {
      case 'CELL_COUNT':
        return `expected ${SQUARE_COUNT} cells, got ${problem.count}`;
      case 'NOT_A_PIECE':
        return `cell ${problem.square} is not a piece: ${problem.value}`;
      case 'LIGHT_SQUARE':
        return `${problem.piece} on light square ${problem.square}`;
      case 'MAN_ON_PROMOTION_ROW':
        return `${problem.piece} man on its promotion row at ${squareName(problem.square)}`;
      case 'TOO_MANY_PIECES':
        return `${problem.count} ${problem.color} pieces (max ${BRAZILIAN_RULES.piecesPerSide})`;
    }
  });
}

export function assertValidBoard(board: BoardState): void {
  const issues = boardIssues(board);
  if (issues.length > 0) throw new InvalidBoardError(issues);
}

const SYMBOLS: Readonly<Record<Piece, string>> = {
  EMPTY: '.',
  WHITE: 'w',
  BLACK: 'b',
  WHITE_KING: 'W',
  BLACK_KING: 'B',
};
const PIECE_BY_SYMBOL = new Map(
  Object.entries(SYMBOLS).map(([piece, symbol]) => [symbol, piece as Piece]),
);

/** 64 characters, row by row: `.` empty, `w`/`b` men, `W`/`B` kings. */
export function serializeBoard(board: BoardState): string {
  return board.cells.map((cell) => SYMBOLS[cell]).join('');
}

/** Inverse of `serializeBoard`; whitespace is ignored, so boards can be written as 8 lines. */
export function parseBoard(text: string): BoardState {
  const symbols = text.replace(/\s+/g, '');
  const cells = [...symbols].map((symbol, index) => {
    const piece = PIECE_BY_SYMBOL.get(symbol);
    if (!piece) throw new InvalidBoardError([`unknown symbol "${symbol}" at ${index}`]);
    return piece;
  });
  const board = { cells };
  assertValidBoard(board);
  return board;
}
