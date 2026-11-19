import { isPlayableSquare, SQUARE_COUNT, SquareIndex } from '../../../domain/board/board';
import { BoardRecognitionResult, SquareRecognition } from '../../../domain/board/observation';
import { ObservedPiece } from '../../../domain/board/piece';
import type { FrameAssessment, FrameIssue } from '../recognize-board';

export interface StabilizerConfig {
  /** Frames kept per square (spec §14 `stabilityWindowSize`). */
  readonly windowSize: number;
  /** Agreeing frames needed to accept a piece (spec §14 `stableObservationCount`). */
  readonly minAgreeing: number;
  /** Frames older than this (relative to the newest) are dropped. */
  readonly maxAgeMs: number;
  /** Confidence bands (same as the classifier). */
  readonly acceptable: number;
}

/** Frame issues that make a frame unfit to vote (alignment is reported, not excluded). */
const EXCLUDING_ISSUES: readonly FrameIssue[] = ['LOW_SHARPNESS', 'UNDEREXPOSED', 'OVEREXPOSED'];

export type StableDecision = 'ACCEPT' | 'WARN' | 'RETRY' | 'MANUAL';

export interface StableSquare {
  readonly squareIndex: SquareIndex;
  readonly piece: ObservedPiece;
  readonly confidence: number;
  readonly decision: StableDecision;
  /** Votes of the frames in the window, per observed piece (UNKNOWN included). */
  readonly votes: Readonly<Partial<Record<ObservedPiece, number>>>;
  readonly frames: number;
}

interface Entry {
  readonly timestamp: number;
  readonly squares: ReadonlyMap<SquareIndex, SquareRecognition>;
}

/**
 * Temporal consolidation of per-frame readings (G3; the stable-board detector for move
 * inference remains E5). Per square, over a bounded window of usable frames:
 * - a piece is accepted only when ≥ `minAgreeing` frames agree and it has at least twice
 *   the votes of every other known reading — no decision from a single frame, and a single
 *   noisy frame cannot flip a stable square;
 * - its confidence is the median of the agreeing frames' confidences (no boosting);
 * - UNKNOWN frames do not vote against a piece, so occasional uncertainty does not keep a
 *   square UNKNOWN forever; a full window without a majority becomes MANUAL.
 * Blurry or badly exposed frames are not added; stale frames expire.
 */
export class ObservationStabilizer {
  private entries: Entry[] = [];
  private skippedFrames = 0;

  constructor(private readonly config: StabilizerConfig) {
    if (!(config.minAgreeing >= 1 && config.minAgreeing <= config.windowSize)) {
      throw new RangeError('expected 1 ≤ minAgreeing ≤ windowSize');
    }
  }

  get size(): number {
    return this.entries.length;
  }

  /** Frames rejected for quality since the last reset. */
  get skipped(): number {
    return this.skippedFrames;
  }

  /** Adds a frame's reading; returns false when the frame was not fit to vote. */
  push(result: BoardRecognitionResult, frame: FrameAssessment | null): boolean {
    if (frame && frame.issues.some((issue) => EXCLUDING_ISSUES.includes(issue))) {
      this.skippedFrames++;
      return false;
    }
    this.entries.push({
      timestamp: result.timestamp,
      squares: new Map(result.squares.map((square) => [square.squareIndex, square])),
    });
    const newest = result.timestamp;
    this.entries = this.entries
      .filter((entry) => newest - entry.timestamp <= this.config.maxAgeMs)
      .slice(-this.config.windowSize);
    return true;
  }

  reset(): void {
    this.entries = [];
    this.skippedFrames = 0;
  }

  /** Stable reading of every playable square. */
  squares(): StableSquare[] {
    const result: StableSquare[] = [];
    for (let index = 0; index < SQUARE_COUNT; index++) {
      if (isPlayableSquare(index)) result.push(this.square(index));
    }
    return result;
  }

  /** The stable reading as a recognition result (same contract as a single frame). */
  stableResult(template: BoardRecognitionResult): BoardRecognitionResult {
    const squares = this.squares();
    const cells: ObservedPiece[] = [...template.board.cells];
    const confidence = [...template.board.confidenceBySquare];
    for (const square of squares) {
      cells[square.squareIndex] = square.piece;
      confidence[square.squareIndex] = square.confidence;
    }
    const recognitions = squares.map(({ squareIndex, piece, confidence: c }) => ({
      squareIndex,
      piece,
      confidence: c,
    }));
    return {
      ...template,
      board: { ...template.board, cells, confidenceBySquare: confidence },
      squares: recognitions,
      status: squares.every((s) => s.decision === 'ACCEPT') ? 'SUCCESS' : 'UNCERTAIN',
      overallConfidence:
        Math.round(
          (recognitions.reduce((sum, s) => sum + s.confidence, 0) / recognitions.length) * 1000,
        ) / 1000,
    };
  }

  private square(index: SquareIndex): StableSquare {
    const readings = this.entries.flatMap((entry) => {
      const square = entry.squares.get(index);
      return square ? [square] : [];
    });
    const votes: Partial<Record<ObservedPiece, number>> = {};
    for (const reading of readings) votes[reading.piece] = (votes[reading.piece] ?? 0) + 1;

    const known = Object.entries(votes).filter(([piece]) => piece !== 'UNKNOWN') as [
      ObservedPiece,
      number,
    ][];
    known.sort((a, b) => b[1] - a[1]);
    const [leader, leaderVotes] = known[0] ?? ['UNKNOWN', 0];
    const others = known.slice(1).reduce((sum, [, count]) => sum + count, 0);

    if (
      leader !== 'UNKNOWN' &&
      leaderVotes >= this.config.minAgreeing &&
      leaderVotes >= 2 * others
    ) {
      const confidences = readings.filter((r) => r.piece === leader).map((r) => r.confidence);
      const confidence = median(confidences);
      return {
        squareIndex: index,
        piece: leader,
        confidence,
        decision: confidence >= this.config.acceptable ? 'ACCEPT' : 'WARN',
        votes,
        frames: readings.length,
      };
    }
    const windowFull = readings.length >= this.config.windowSize;
    return {
      squareIndex: index,
      piece: 'UNKNOWN',
      confidence: 0,
      decision: windowFull ? 'MANUAL' : 'RETRY',
      votes,
      frames: readings.length,
    };
  }
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] as number)
    : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}
