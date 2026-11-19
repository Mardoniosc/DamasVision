import { PLAYABLE_SQUARES, SquareIndex } from '../board/board';
import { BoardObservation } from '../board/observation';
import { BoardState, PlayerColor } from '../board/piece';
import { CheckersEngine } from '../engine/checkers-engine';
import { changedSquaresBetween, compareObservedBoard } from './board-diff';
import { DEFAULT_INFERENCE_CONFIG, InferenceConfig } from './inference.config';
import { Move } from './move';

/**
 * How a legal move's outcome matches the observation:
 * - EXACT: every square the move changes is observed as expected; nothing contradicts it.
 * - PENDING_REMOVAL: as EXACT, except captured pieces still on the board (not removed yet).
 * - OCCLUDED: nothing contradicts it, but some changed squares are UNKNOWN (hand, object).
 * - PARTIAL: the changed squares match, but a few other squares contradict the board.
 */
export type CandidateMatch = 'EXACT' | 'PENDING_REMOVAL' | 'OCCLUDED' | 'PARTIAL';

/** Spec §5 `MoveCandidate`, plus how and where it matches. */
export interface MoveCandidate {
  readonly move: Move;
  readonly matchScore: number;
  /** Squares where the observation differs from the expected board (known pieces only). */
  readonly mismatchedSquares: readonly SquareIndex[];
  readonly expectedBoard: BoardState;
  readonly match: CandidateMatch;
  /** Captured squares still showing the captured piece. */
  readonly pendingRemoval: readonly SquareIndex[];
  /** Squares changed by the move but observed as UNKNOWN. */
  readonly unknownChangedSquares: readonly SquareIndex[];
  /** Lowest observation confidence over the squares the move changes. */
  readonly changedConfidence: number;
  /** A promoting man observed on the back row still as a man (crown not placed yet). */
  readonly promotionUnmarked: boolean;
}

export type MoveInferenceStatus =
  'MATCHED' | 'AMBIGUOUS' | 'NO_MATCH' | 'WAITING_FOR_STABILITY' | 'REQUIRES_MANUAL_CORRECTION';

export type InferenceWarning =
  | 'BOARD_UNCHANGED'
  | 'PIECES_REMOVED_ONLY'
  | 'PROMOTION_NOT_MARKED'
  | 'NO_LEGAL_MOVES'
  | 'CAPTURED_PIECES_NOT_REMOVED'
  | 'DECISIVE_SQUARES_UNKNOWN'
  | 'LOW_CONFIDENCE'
  | 'PARTIAL_MATCH'
  | 'SEVERAL_MOVES_MATCH'
  | 'NO_LEGAL_MOVE_MATCHES';

/** Spec §5 `MoveInferenceResult`. */
export interface MoveInferenceResult {
  readonly status: MoveInferenceStatus;
  /** Best first: match quality, then fewer mismatches, then score. */
  readonly candidates: readonly MoveCandidate[];
  readonly selected?: MoveCandidate;
  readonly observedBoard: BoardObservation;
  readonly warnings: readonly InferenceWarning[];
}

const MATCH_ORDER: Readonly<Record<CandidateMatch, number>> = {
  EXACT: 0,
  PENDING_REMOVAL: 1,
  OCCLUDED: 2,
  PARTIAL: 3,
};

/**
 * Infers the move that turned the authoritative board into the (stable) observed one
 * (E5-T04/T05, spec §8): simulate every legal move, compare each outcome with the
 * observation, then resolve. Only a single exact, confident candidate is MATCHED; anything
 * less waits, asks for confirmation or requires reconciliation — a false commit is worse
 * than a question. The observation is never used to change the board directly.
 */
export function inferMove(
  authoritativeBoard: BoardState,
  player: PlayerColor,
  observation: BoardObservation,
  engine: CheckersEngine,
  config: InferenceConfig = DEFAULT_INFERENCE_CONFIG,
): MoveInferenceResult {
  const result = (
    status: MoveInferenceStatus,
    candidates: readonly MoveCandidate[],
    warnings: InferenceWarning[],
    selected?: MoveCandidate,
  ): MoveInferenceResult => ({
    status,
    candidates,
    observedBoard: observation,
    warnings,
    ...(selected ? { selected } : {}),
  });

  if (compareObservedBoard(authoritativeBoard, observation).consistent) {
    return result('NO_MATCH', [], ['BOARD_UNCHANGED']);
  }
  const legalMoves = engine.getLegalMoves(authoritativeBoard, player);
  if (legalMoves.length === 0) return result('NO_MATCH', [], ['NO_LEGAL_MOVES']);

  const candidates = legalMoves
    .map((move) => evaluateCandidate(authoritativeBoard, move, observation, engine, config))
    .filter((candidate): candidate is MoveCandidate => candidate !== null)
    .sort(
      (a, b) =>
        MATCH_ORDER[a.match] - MATCH_ORDER[b.match] ||
        a.mismatchedSquares.length - b.mismatchedSquares.length ||
        b.matchScore - a.matchScore,
    );
  const of = (match: CandidateMatch) => candidates.filter((c) => c.match === match);
  const exact = of('EXACT');
  const pending = of('PENDING_REMOVAL');
  const occluded = of('OCCLUDED');

  if (exact.length === 1 && pending.length === 0 && occluded.length === 0) {
    const [single] = exact as [MoveCandidate];
    const notes: InferenceWarning[] = single.promotionUnmarked ? ['PROMOTION_NOT_MARKED'] : [];
    return single.changedConfidence >= config.acceptableConfidence
      ? result('MATCHED', candidates, notes, single)
      : result('REQUIRES_MANUAL_CORRECTION', candidates, ['LOW_CONFIDENCE', ...notes], single);
  }
  if (exact.length + pending.length + occluded.length > 1 && exact.length > 0) {
    return result('AMBIGUOUS', candidates, ['SEVERAL_MOVES_MATCH']);
  }
  if (pending.length > 0) {
    const single = pending.length === 1 && occluded.length === 0 ? pending[0] : undefined;
    return result('WAITING_FOR_STABILITY', candidates, ['CAPTURED_PIECES_NOT_REMOVED'], single);
  }
  if (occluded.length > 0) {
    return result('WAITING_FOR_STABILITY', candidates, ['DECISIVE_SQUARES_UNKNOWN']);
  }
  if (onlyRemovals(authoritativeBoard, observation)) {
    // A piece in the player's hand, or captured pieces taken off first: the move is not
    // finished yet.
    return result('WAITING_FOR_STABILITY', candidates, ['PIECES_REMOVED_ONLY']);
  }
  if (candidates.length > 0) {
    return result('REQUIRES_MANUAL_CORRECTION', candidates, ['PARTIAL_MATCH']);
  }
  return result('NO_MATCH', [], ['NO_LEGAL_MOVE_MATCHES']);
}

function evaluateCandidate(
  before: BoardState,
  move: Move,
  observation: BoardObservation,
  engine: CheckersEngine,
  config: InferenceConfig,
): MoveCandidate | null {
  const expectedBoard = engine.simulateMove(before, move);
  const changed = changedSquaresBetween(before, expectedBoard);
  const captured = new Set(move.capturedSquares);
  const pendingRemoval: SquareIndex[] = [];
  const unknownChangedSquares: SquareIndex[] = [];
  let confirmed = 0;
  let promotionUnmarked = false;

  for (const square of changed) {
    const observed = observation.cells[square] ?? 'UNKNOWN';
    if (observed === expectedBoard.cells[square]) {
      confirmed++;
    } else if (move.promotion && square === move.to && observed === move.pieceBefore) {
      // The promotion is mandatory: the man on the back row proves the move.
      confirmed++;
      promotionUnmarked = true;
    } else if (observed === 'UNKNOWN') {
      unknownChangedSquares.push(square);
    } else if (captured.has(square) && observed === before.cells[square]) {
      pendingRemoval.push(square);
    } else {
      return null; // A square the move changes contradicts it.
    }
  }
  // At least one changed square must show the move happened.
  if (confirmed === 0) return null;

  const changedSet = new Set(changed);
  const outside = PLAYABLE_SQUARES.filter((square) => {
    if (changedSet.has(square)) return false;
    const observed = observation.cells[square] ?? 'UNKNOWN';
    return observed !== 'UNKNOWN' && observed !== expectedBoard.cells[square];
  });
  if (outside.length > config.maxPartialMismatches) return null;

  const match: CandidateMatch =
    outside.length > 0
      ? 'PARTIAL'
      : unknownChangedSquares.length > 0
        ? 'OCCLUDED'
        : pendingRemoval.length > 0
          ? 'PENDING_REMOVAL'
          : 'EXACT';
  return {
    move,
    matchScore: compareObservedBoard(expectedBoard, observation).score,
    mismatchedSquares: [...pendingRemoval, ...outside].sort((a, b) => a - b),
    expectedBoard,
    match,
    pendingRemoval,
    unknownChangedSquares,
    changedConfidence: Math.min(
      ...changed
        .filter((square) => !unknownChangedSquares.includes(square))
        .map((square) => observation.confidenceBySquare[square] ?? 0),
    ),
    promotionUnmarked,
  };
}

/** Every known difference from the board is a piece gone (nothing appeared or changed). */
function onlyRemovals(before: BoardState, observation: BoardObservation): boolean {
  let removed = 0;
  for (const square of PLAYABLE_SQUARES) {
    const observed = observation.cells[square] ?? 'UNKNOWN';
    if (observed === 'UNKNOWN' || observed === before.cells[square]) continue;
    if (observed !== 'EMPTY') return false;
    removed++;
  }
  return removed > 0;
}
