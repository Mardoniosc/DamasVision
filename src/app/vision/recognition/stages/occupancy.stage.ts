import { ClassifierConfig } from '../classifier.config';
import { SquareFeatures } from '../square-features';
import {
  marginConfidence,
  OccupancyDecision,
  StageOutcome,
  UNDETERMINED_CONFIDENCE,
} from './stage.models';

export interface OccupancyContext {
  /** Corners that look like the board (0 = obstructed ROI). */
  readonly visibleCorners: number;
  /** Background luminance divided by the local light reference. */
  readonly backgroundRelative: number;
}

/**
 * Stage B — is the square empty, occupied or undetermined? Decided only from the
 * foreground of the central disk against a board background — how much of it differs and
 * whether that reaches the disk edge all around, as a piece does — before (and
 * independently of) color and king evidence, so those can never spoil an "empty".
 */
export function occupancyStage(
  features: SquareFeatures,
  context: OccupancyContext,
  config: ClassifierConfig,
): StageOutcome<OccupancyDecision> {
  const { shape, color } = config;
  if (context.visibleCorners === 0) {
    return {
      decision: 'UNDETERMINED',
      confidence: UNDETERMINED_CONFIDENCE,
      reason: 'ROI_OBSTRUCTED',
    };
  }
  const occupancy = features.foregroundRatio;
  if (occupancy <= shape.emptyMaxRatio) {
    if (context.backgroundRelative < color.darkSquareMinRelativeLuminance) {
      // A black piece on a near-black square would also show no foreground.
      return {
        decision: 'UNDETERMINED',
        confidence: UNDETERMINED_CONFIDENCE,
        reason: 'LOW_BOARD_CONTRAST',
      };
    }
    return {
      decision: 'EMPTY',
      confidence: marginConfidence(shape.emptyMaxRatio - occupancy, shape.emptyMaxRatio),
      reason: 'EMPTY_BACKGROUND',
    };
  }
  if (occupancy < shape.presenceMinRatio) {
    return {
      decision: 'UNDETERMINED',
      confidence: UNDETERMINED_CONFIDENCE,
      reason: 'PARTIAL_OCCUPANCY',
    };
  }
  if (features.ringForegroundRatio < shape.occupancyRingMinRatio) {
    // Enough foreground, but not reaching the disk edge all around: a glare spot, a
    // fingertip or an object — not a piece (G3: never invent a piece on an empty square).
    return {
      decision: 'UNDETERMINED',
      confidence: UNDETERMINED_CONFIDENCE,
      reason: 'NOT_PIECE_SHAPED',
    };
  }
  return {
    decision: 'OCCUPIED',
    confidence: marginConfidence(occupancy - shape.presenceMinRatio, 1 - shape.presenceMinRatio),
    reason: 'OCCUPIED_FOREGROUND',
  };
}
