/** Results of the recognition stages (G3 pipeline: A image → B occupancy → C color → D type → E consolidation). */

export type OccupancyDecision = 'EMPTY' | 'OCCUPIED' | 'UNDETERMINED';
export type ColorDecision = 'WHITE' | 'BLACK' | 'UNDETERMINED';
export type PieceTypeDecision = 'MAN' | 'KING' | 'UNDETERMINED';

/**
 * What the system does with a square's result:
 * - ACCEPT: confidence ≥ `acceptable`;
 * - WARN: known piece but confidence between `uncertain` and `acceptable`;
 * - RETRY: UNKNOWN on this frame — wait for more frames (the temporal buffer escalates to
 *   manual correction when it persists).
 */
export type SquareDecision = 'ACCEPT' | 'WARN' | 'RETRY';

/** Machine-readable reason codes; texts live in reasons.ts. */
export type ReasonCode =
  | 'EMPTY_BACKGROUND'
  | 'OCCUPIED_FOREGROUND'
  | 'PARTIAL_OCCUPANCY'
  | 'NOT_PIECE_SHAPED'
  | 'ROI_OBSTRUCTED'
  | 'LOW_BOARD_CONTRAST'
  | 'WHITE_CONTRAST'
  | 'BLACK_CONTRAST'
  | 'AMBIGUOUS_COLOR'
  | 'INCONSISTENT_PIECE_COLOR'
  | 'NO_MARK'
  | 'COLORED_MARK'
  | 'AMBIGUOUS_MARK';

export interface StageOutcome<D extends string> {
  readonly decision: D;
  /** Heuristic 0..1: 0.5 on the decision threshold, 1 at its soft margin (docs/vision/recognition.md). */
  readonly confidence: number;
  readonly reason: ReasonCode;
}

/** Confidence reported when the evidence falls between two decision regions. */
export const UNDETERMINED_CONFIDENCE = 0.3;

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/** 0.5 on the decision threshold, rising linearly to 1 at `softness` beyond it. */
export function marginConfidence(distancePastThreshold: number, softness: number): number {
  return clamp01(0.5 + (0.5 * distancePastThreshold) / softness);
}
