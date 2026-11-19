import { SquareIndex } from '../board/board';
import { Piece } from '../board/piece';

/**
 * A move (spec §5 "Move and inference").
 * - `path`: every square the piece stands on, from `from` to `to` inclusive.
 * - `capturedSquares`: captured pieces in capture order (empty for a simple move).
 * - `pieceBefore` / `pieceAfter` differ only on promotion.
 * - `id`: the move's notation, e.g. `c3-d4` or `c3xe5xc7` (docs/engine/brazilian-checkers-rules.md).
 */
export interface Move {
  readonly id: string;
  readonly from: SquareIndex;
  readonly to: SquareIndex;
  readonly path: readonly SquareIndex[];
  readonly capturedSquares: readonly SquareIndex[];
  readonly promotion: boolean;
  readonly pieceBefore: Piece;
  readonly pieceAfter: Piece;
}

export function isCapture(move: Move): boolean {
  return move.capturedSquares.length > 0;
}

/**
 * Identity of a move regardless of the landing path: `from`, `to` and the *set* of
 * captured squares. Two flying-king paths capturing the same pieces are the same move.
 */
export function moveKey(move: Pick<Move, 'from' | 'to' | 'capturedSquares'>): string {
  const captured = [...move.capturedSquares].sort((a, b) => a - b).join(',');
  return `${move.from}>${move.to}[${captured}]`;
}
