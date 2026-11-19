import { isPlayableSquare, SQUARE_COUNT, SquareIndex } from './board';
import { isObservedPiece, ObservedPiece, Piece } from './piece';

/** Contracts from docs/execution-specification.md §5 (Board conventions, Recognition). */
export interface BoardObservation {
  readonly cells: readonly ObservedPiece[];
  readonly confidenceBySquare: readonly number[];
  readonly timestamp: number;
  readonly sourceFrameId?: string;
}

export type RecognitionStatus = 'SUCCESS' | 'UNCERTAIN' | 'ERROR';

export interface SquareRecognition {
  readonly squareIndex: SquareIndex;
  readonly piece: ObservedPiece;
  /** 0..1, heuristic unless calibrated statistically (spec §5). */
  readonly confidence: number;
}

export type RecognitionWarningCode =
  | 'UNKNOWN_SQUARES'
  | 'LOW_CONFIDENCE'
  | 'UNEXPECTED_OBJECTS'
  | 'LOW_SHARPNESS'
  | 'UNDEREXPOSED'
  | 'OVEREXPOSED'
  | 'LOW_BOARD_CONTRAST'
  | 'TOO_MANY_PIECES';

export interface RecognitionWarning {
  readonly code: RecognitionWarningCode | string;
  readonly message: string;
  readonly affectedSquares?: readonly SquareIndex[];
}

export interface BoardRecognitionResult {
  readonly board: BoardObservation;
  /** One entry per playable square, in square-index order. */
  readonly squares: readonly SquareRecognition[];
  readonly status: RecognitionStatus;
  readonly overallConfidence: number;
  readonly warnings: readonly RecognitionWarning[];
  readonly timestamp: number;
}

/** Structural check for observations received over postMessage or from storage. */
export function isBoardObservation(value: unknown): value is BoardObservation {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const observation = value as Record<string, unknown>;
  const cells = observation['cells'];
  const confidence = observation['confidenceBySquare'];
  return (
    Array.isArray(cells) &&
    cells.length === SQUARE_COUNT &&
    cells.every(isObservedPiece) &&
    Array.isArray(confidence) &&
    confidence.length === SQUARE_COUNT &&
    confidence.every((c) => typeof c === 'number' && c >= 0 && c <= 1) &&
    typeof observation['timestamp'] === 'number'
  );
}

/** Squares whose observed piece differs between two observations. */
export function changedSquares(
  a: readonly ObservedPiece[],
  b: readonly ObservedPiece[],
): SquareIndex[] {
  const changed: SquareIndex[] = [];
  for (let index = 0; index < SQUARE_COUNT; index++) {
    if (a[index] !== b[index]) {
      changed.push(index);
    }
  }
  return changed;
}

/**
 * Applies manual corrections to an observation. Corrected squares become certain
 * (confidence 1). Corrections on non-playable squares are rejected: pieces only
 * stand on playable squares (spec §5).
 */
export function applyCorrections(
  observation: BoardObservation,
  corrections: ReadonlyMap<SquareIndex, Piece>,
): BoardObservation {
  const cells = [...observation.cells];
  const confidence = [...observation.confidenceBySquare];
  for (const [index, piece] of corrections) {
    if (!isPlayableSquare(index) && piece !== 'EMPTY') {
      throw new RangeError(`square ${index} is not playable`);
    }
    cells[index] = piece;
    confidence[index] = 1;
  }
  return { ...observation, cells, confidenceBySquare: confidence };
}

export function unknownSquares(observation: BoardObservation): SquareIndex[] {
  return observation.cells.flatMap((piece, index) => (piece === 'UNKNOWN' ? [index] : []));
}
