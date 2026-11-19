import { BoardState, isKing, pieceColor, PlayerColor } from '../board/piece';
import { GameResult } from '../game/game-result';
import { isCapture, Move } from '../move/move';
import { BRAZILIAN_RULES, BrazilianRules } from '../rules/brazilian-rules';
import { serializeBoard } from './board-state';

/** One position of a game: the board, who is to move, and the move that led to it. */
export interface PositionRecord {
  readonly board: BoardState;
  readonly playerToMove: PlayerColor;
  /** null for the starting position of the record. */
  readonly lastMove: Move | null;
}

interface Material {
  readonly men: number;
  readonly kings: number;
}

/**
 * Draw rules that need the game history (docs/engine/brazilian-checkers-rules.md,
 * "End of the game"), evaluated on the latest position of `history` (chronological, the
 * first record being the starting position). Call it after every move, once
 * `getResult` has found no winner — a win always takes precedence.
 */
export function evaluateDraw(
  history: readonly PositionRecord[],
  rules: BrazilianRules = BRAZILIAN_RULES,
): GameResult | null {
  const latest = history[history.length - 1];
  if (!latest) return null;

  const key = positionKey(latest);
  const repetitions = history.filter((record) => positionKey(record) === key).length;
  if (repetitions >= rules.repetitionsForDraw) {
    return { status: 'DRAW', reason: 'THREEFOLD_REPETITION' };
  }

  let kingOnly = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const move = history[i]?.lastMove;
    if (!move || isCapture(move) || !isKing(move.pieceBefore)) break;
    kingOnly++;
  }
  if (kingOnly >= rules.kingOnlyPliesForDraw) {
    return { status: 'DRAW', reason: 'TWENTY_KING_MOVES' };
  }

  const signature = materialSignature(latest.board);
  if (isShortEnding(latest.board)) {
    let plies = 0;
    for (let i = history.length - 1; i > 0; i--) {
      const previous = history[i - 1];
      if (!previous || materialSignature(previous.board) !== signature) break;
      plies++;
    }
    if (plies >= rules.shortEndingPliesForDraw) {
      return { status: 'DRAW', reason: 'ENDGAME_FIVE_MOVES' };
    }
  }
  return null;
}

function positionKey(record: PositionRecord): string {
  return `${record.playerToMove}:${serializeBoard(record.board)}`;
}

function material(board: BoardState, color: PlayerColor): Material {
  let men = 0;
  let kings = 0;
  for (const cell of board.cells) {
    if (pieceColor(cell) !== color) continue;
    if (isKing(cell)) kings++;
    else men++;
  }
  return { men, kings };
}

function materialSignature(board: BoardState): string {
  const white = material(board, 'WHITE');
  const black = material(board, 'BLACK');
  return `${white.men},${white.kings}/${black.men},${black.kings}`;
}

/** 2K v 1K, 2K+1M v 1K or 1K+2M v 1K, with either color on the stronger side. */
function isShortEnding(board: BoardState): boolean {
  const white = material(board, 'WHITE');
  const black = material(board, 'BLACK');
  const lone = (side: Material): boolean => side.kings === 1 && side.men === 0;
  const stronger = (side: Material): boolean =>
    (side.kings === 2 && side.men <= 1) || (side.kings === 1 && side.men === 2);
  return (lone(white) && stronger(black)) || (lone(black) && stronger(white));
}
