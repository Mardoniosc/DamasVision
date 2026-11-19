import { PLAYABLE_SQUARES, SquareIndex } from '../board/board';
import { BoardObservation } from '../board/observation';
import { BoardState } from '../board/piece';

/** Comparison of an expected (engine) board with an observed one (E5-T03, spec §8). */
export interface BoardComparison {
  /** Playable squares observed with the expected piece. */
  readonly matchedSquares: readonly SquareIndex[];
  /** Playable squares observed with a *different* known piece. */
  readonly mismatchedSquares: readonly SquareIndex[];
  /** Playable squares observed as UNKNOWN: uncertainty, not a mismatch. */
  readonly unknownSquares: readonly SquareIndex[];
  /** No mismatch on any known square (UNKNOWN allowed). */
  readonly consistent: boolean;
  /** Consistent and nothing unknown. */
  readonly exact: boolean;
  /** Σ confidence of the matched squares / 32, in 0..1. */
  readonly score: number;
}

export function compareObservedBoard(
  expected: BoardState,
  observation: BoardObservation,
): BoardComparison {
  const matchedSquares: SquareIndex[] = [];
  const mismatchedSquares: SquareIndex[] = [];
  const unknownSquares: SquareIndex[] = [];
  let weight = 0;
  for (const square of PLAYABLE_SQUARES) {
    const observed = observation.cells[square] ?? 'UNKNOWN';
    if (observed === 'UNKNOWN') {
      unknownSquares.push(square);
    } else if (observed === expected.cells[square]) {
      matchedSquares.push(square);
      weight += observation.confidenceBySquare[square] ?? 0;
    } else {
      mismatchedSquares.push(square);
    }
  }
  return {
    matchedSquares,
    mismatchedSquares,
    unknownSquares,
    consistent: mismatchedSquares.length === 0,
    exact: mismatchedSquares.length === 0 && unknownSquares.length === 0,
    score: Math.round((weight / PLAYABLE_SQUARES.length) * 1000) / 1000,
  };
}

/** Playable squares whose piece differs between two boards. */
export function changedSquaresBetween(before: BoardState, after: BoardState): SquareIndex[] {
  return PLAYABLE_SQUARES.filter((square) => before.cells[square] !== after.cells[square]);
}
