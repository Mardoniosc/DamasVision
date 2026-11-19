import { SquareIndex } from '../board/board';
import { BoardObservation } from '../board/observation';
import { BoardState } from '../board/piece';
import { compareObservedBoard } from './board-diff';
import { Move } from './move';

export type ReconciliationStatus =
  'RECONCILED' | 'PENDING_REMOVAL' | 'PENDING_PROMOTION_MARK' | 'OCCLUDED' | 'MISMATCH';

export interface Reconciliation {
  readonly status: ReconciliationStatus;
  /** Captured squares still showing the captured piece. */
  readonly pendingRemoval: readonly SquareIndex[];
  /** The promoted piece, still observed as a man (crown not placed yet). */
  readonly pendingPromotion: SquareIndex | null;
  /** Squares contradicting the expected board, other than the pending ones. */
  readonly mismatchedSquares: readonly SquareIndex[];
  readonly unknownSquares: readonly SquareIndex[];
}

/**
 * Reconciles the physical board with the authoritative one after a commit (E5-T06, spec
 * §8 "Commit protocol"). Captured pieces are often removed after the capturing piece has
 * moved: while the only differences are captured squares still holding the piece that was
 * there before the move, the status is PENDING_REMOVAL (wait, ask the player to remove
 * them). A promoted man still observed as a man is PENDING_PROMOTION_MARK (ask the player
 * to crown it). UNKNOWN squares give OCCLUDED (wait). Any other difference is a MISMATCH:
 * the controller enters RECONCILIATION_REQUIRED (E6).
 */
export function reconcileObservation(
  expected: BoardState,
  observation: BoardObservation,
  lastMove: Move | null = null,
  boardBeforeMove: BoardState | null = null,
): Reconciliation {
  const comparison = compareObservedBoard(expected, observation);
  const captured = new Set(lastMove?.capturedSquares ?? []);
  const pendingRemoval = comparison.mismatchedSquares.filter(
    (square) =>
      captured.has(square) &&
      boardBeforeMove !== null &&
      observation.cells[square] === boardBeforeMove.cells[square],
  );
  const pendingPromotion =
    lastMove?.promotion && observation.cells[lastMove.to] === lastMove.pieceBefore
      ? lastMove.to
      : null;
  const mismatchedSquares = comparison.mismatchedSquares.filter(
    (square) => !pendingRemoval.includes(square) && square !== pendingPromotion,
  );
  const status: ReconciliationStatus =
    mismatchedSquares.length > 0
      ? 'MISMATCH'
      : pendingRemoval.length > 0
        ? 'PENDING_REMOVAL'
        : pendingPromotion !== null
          ? 'PENDING_PROMOTION_MARK'
          : comparison.unknownSquares.length > 0
            ? 'OCCLUDED'
            : 'RECONCILED';
  return {
    status,
    pendingRemoval,
    pendingPromotion,
    mismatchedSquares,
    unknownSquares: comparison.unknownSquares,
  };
}
