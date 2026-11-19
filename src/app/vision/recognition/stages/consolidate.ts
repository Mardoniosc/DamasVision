import { ObservedPiece } from '../../../domain/board/piece';
import { ClassifierConfig } from '../classifier.config';
import {
  ColorDecision,
  OccupancyDecision,
  PieceTypeDecision,
  ReasonCode,
  SquareDecision,
  StageOutcome,
} from './stage.models';

export interface Consolidated {
  readonly piece: ObservedPiece;
  /** min of the stage confidences that were needed (never an average). */
  readonly confidence: number;
  readonly decision: SquareDecision;
  /** Reason of the stage that limited the result. */
  readonly reason: ReasonCode;
  readonly limitingStage: 'OCCUPANCY' | 'COLOR' | 'PIECE_TYPE';
}

/**
 * Stage E — combines the stage outcomes into the square's piece. Any undetermined stage
 * makes the square UNKNOWN; the final confidence is the weakest needed stage; below
 * `uncertain` the square is UNKNOWN, below `acceptable` it is a warning.
 */
export function consolidate(
  occupancy: StageOutcome<OccupancyDecision>,
  color: StageOutcome<ColorDecision> | null,
  pieceType: StageOutcome<PieceTypeDecision> | null,
  config: ClassifierConfig,
): Consolidated {
  const stages: [Consolidated['limitingStage'], StageOutcome<string>][] = [
    ['OCCUPANCY', occupancy],
  ];
  if (occupancy.decision === 'OCCUPIED') {
    if (color) stages.push(['COLOR', color]);
    if (pieceType) stages.push(['PIECE_TYPE', pieceType]);
  }
  const [limitingStage, weakest] = stages.reduce((min, entry) =>
    entry[1].confidence < min[1].confidence ? entry : min,
  );
  const undetermined = stages.find(([, s]) => s.decision === 'UNDETERMINED');
  const confidence = weakest.confidence;

  if (undetermined || confidence < config.confidence.uncertain) {
    const [stage, outcome] = undetermined ?? [limitingStage, weakest];
    return {
      piece: 'UNKNOWN',
      confidence,
      decision: 'RETRY',
      reason: outcome.reason,
      limitingStage: stage,
    };
  }
  const piece = pieceOf(occupancy.decision, color?.decision, pieceType?.decision);
  return {
    piece,
    confidence,
    decision: confidence >= config.confidence.acceptable ? 'ACCEPT' : 'WARN',
    reason: weakest.reason,
    limitingStage,
  };
}

function pieceOf(
  occupancy: OccupancyDecision,
  color: ColorDecision | undefined,
  pieceType: PieceTypeDecision | undefined,
): ObservedPiece {
  if (occupancy === 'EMPTY') return 'EMPTY';
  if (color === 'WHITE') return pieceType === 'KING' ? 'WHITE_KING' : 'WHITE';
  if (color === 'BLACK') return pieceType === 'KING' ? 'BLACK_KING' : 'BLACK';
  return 'UNKNOWN';
}
