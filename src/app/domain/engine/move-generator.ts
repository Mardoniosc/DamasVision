import { BOARD_SIZE, isOnBoard, PLAYABLE_SQUARES, SquareIndex } from '../board/board';
import { squareName } from '../board/board-notation';
import { isKing, Piece, pieceColor, PlayerColor } from '../board/piece';
import { opponentOf } from '../game/game-result';
import { Move, moveKey } from '../move/move';
import { forwardStep, promotionRow } from '../rules/brazilian-rules';

/** The four diagonal directions as [row step, column step], in a fixed order (determinism). */
const DIAGONALS: readonly (readonly [number, number])[] = [
  [-1, -1],
  [-1, 1],
  [1, -1],
  [1, 1],
];

const KING_OF: Readonly<Record<PlayerColor, Piece>> = { WHITE: 'WHITE_KING', BLACK: 'BLACK_KING' };

interface CaptureSequence {
  readonly path: readonly SquareIndex[];
  readonly captured: readonly SquareIndex[];
}

const rowOf = (index: SquareIndex): number => Math.floor(index / BOARD_SIZE);
const columnOf = (index: SquareIndex): number => index % BOARD_SIZE;
const at = (row: number, column: number): SquareIndex => row * BOARD_SIZE + column;

/**
 * Every legal move of `player` (docs/engine/brazilian-checkers-rules.md):
 * captures are mandatory and only the sequences capturing the most pieces are legal
 * (majority rule); otherwise simple moves. Order: by `from`, then generation order.
 * Assumes a valid board (the engine validates it).
 */
export function generateLegalMoves(cells: readonly Piece[], player: PlayerColor): Move[] {
  const own = PLAYABLE_SQUARES.filter((square) => pieceColor(cells[square] ?? 'EMPTY') === player);

  const captures = own.flatMap((from) =>
    captureSequences(cells, from).map((sequence) =>
      toMove(cells, sequence.path, sequence.captured),
    ),
  );
  if (captures.length > 0) {
    const most = Math.max(...captures.map((move) => move.capturedSquares.length));
    return unique(captures.filter((move) => move.capturedSquares.length === most));
  }
  return own.flatMap((from) => simpleMoves(cells, from));
}

/** Non-capturing moves of the piece on `from`. */
function simpleMoves(cells: readonly Piece[], from: SquareIndex): Move[] {
  const piece = cells[from] ?? 'EMPTY';
  const color = pieceColor(piece);
  if (!color) return [];
  const king = isKing(piece);
  const moves: Move[] = [];
  for (const [dr, dc] of DIAGONALS) {
    if (!king && dr !== forwardStep(color)) continue;
    let row = rowOf(from) + dr;
    let column = columnOf(from) + dc;
    while (isOnBoard(row, column) && cells[at(row, column)] === 'EMPTY') {
      moves.push(toMove(cells, [from, at(row, column)], []));
      if (!king) break;
      row += dr;
      column += dc;
    }
  }
  return moves;
}

/**
 * All maximal capture sequences of the piece on `from`. During a sequence the piece's
 * starting square is empty, captured pieces stay on the board (they block and cannot be
 * jumped twice), and a man stays a man even when it passes its promotion row.
 */
function captureSequences(cells: readonly Piece[], from: SquareIndex): CaptureSequence[] {
  const piece = cells[from] ?? 'EMPTY';
  const color = pieceColor(piece);
  if (!color) return [];
  const king = isKing(piece);
  const board = [...cells];
  board[from] = 'EMPTY';
  const results: CaptureSequence[] = [];

  const extend = (square: SquareIndex, path: SquareIndex[], captured: SquareIndex[]): void => {
    let continued = false;
    for (const [dr, dc] of DIAGONALS) {
      for (const { landing, victim } of jumps(board, square, dr, dc, king, color, captured)) {
        continued = true;
        extend(landing, [...path, landing], [...captured, victim]);
      }
    }
    if (!continued && captured.length > 0) results.push({ path, captured });
  };
  extend(from, [from], []);
  return results;
}

/** Captures available from `square` in one direction: each landing square and its victim. */
function jumps(
  board: readonly Piece[],
  square: SquareIndex,
  dr: number,
  dc: number,
  king: boolean,
  color: PlayerColor,
  captured: readonly SquareIndex[],
): { landing: SquareIndex; victim: SquareIndex }[] {
  let row = rowOf(square) + dr;
  let column = columnOf(square) + dc;
  if (king) {
    // A flying king may pass any number of empty squares before the piece it jumps.
    while (isOnBoard(row, column) && board[at(row, column)] === 'EMPTY') {
      row += dr;
      column += dc;
    }
  }
  if (!isOnBoard(row, column)) return [];
  const victim = at(row, column);
  if (pieceColor(board[victim] ?? 'EMPTY') !== opponentOf(color) || captured.includes(victim)) {
    return [];
  }
  const landings: { landing: SquareIndex; victim: SquareIndex }[] = [];
  row += dr;
  column += dc;
  while (isOnBoard(row, column) && board[at(row, column)] === 'EMPTY') {
    landings.push({ landing: at(row, column), victim });
    if (!king) break;
    row += dr;
    column += dc;
  }
  return landings;
}

function toMove(
  cells: readonly Piece[],
  path: readonly SquareIndex[],
  captured: readonly SquareIndex[],
): Move {
  const from = path[0] as SquareIndex;
  const to = path[path.length - 1] as SquareIndex;
  const pieceBefore = cells[from] ?? 'EMPTY';
  const color = pieceColor(pieceBefore) as PlayerColor;
  const promotion = !isKing(pieceBefore) && rowOf(to) === promotionRow(color);
  const id =
    captured.length > 0 ? path.map(squareName).join('x') : `${squareName(from)}-${squareName(to)}`;
  return {
    id,
    from,
    to,
    path,
    capturedSquares: captured,
    promotion,
    pieceBefore,
    pieceAfter: promotion ? KING_OF[color] : pieceBefore,
  };
}

/** Keeps the first of moves with the same from, to and captured set (different king paths). */
function unique(moves: readonly Move[]): Move[] {
  const seen = new Set<string>();
  return moves.filter((move) => {
    const key = moveKey(move);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
