import { ObservedPiece } from '../../domain/board/piece';
import { ClassifierConfig } from './classifier.config';
import { chromaDistance, SquareFeatures } from './square-features';

export interface SquareContext {
  /** Local illumination reference: luminance of the surrounding light squares. */
  readonly lightReference: number;
  /** The square background does not look like a dark square (hand, object, misalignment). */
  readonly occluded: boolean;
}

export interface SquareClassification {
  readonly piece: ObservedPiece;
  /** Heuristic 0..1 (spec §7: initial tuning values, not proven probabilities). */
  readonly confidence: number;
  /** The decision that limited the confidence; for diagnostics and tuning. */
  readonly limitedBy: 'OCCLUSION' | 'BOARD_CONTRAST' | 'PRESENCE' | 'COLOR' | 'KING' | 'NONE';
}

/** Confidence reported when the features fall between two decision regions. */
export const AMBIGUOUS_CONFIDENCE = 0.3;

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/** 0.5 on the decision threshold, rising linearly to 1 at `softness` beyond it. */
function marginConfidence(distancePastThreshold: number, softness: number): number {
  return clamp01(0.5 + (0.5 * distancePastThreshold) / softness);
}

/**
 * Classifies one playable square (E3-T04/T05/T06):
 * 0. occlusion — an occluded square is UNKNOWN;
 * 1. presence — fraction of the central disk that differs from the square background;
 *    on a board too dark to distinguish black pieces, "empty" is UNKNOWN;
 * 2. color — piece body vs square background luminance (same local lighting);
 * 3. king — chromaticity of the central mark vs the piece body (assumes standardized
 *    kings with a distinct *colored* mark, spec §7; achromatic marks are not detected).
 * The confidence is the weakest decision; below `confidence.uncertain` the square is
 * UNKNOWN (prefer explicit uncertainty to false certainty).
 */
export function classifySquare(
  features: SquareFeatures,
  context: SquareContext,
  config: ClassifierConfig,
): SquareClassification {
  const { color, shape } = config;
  if (context.occluded) {
    return { piece: 'UNKNOWN', confidence: AMBIGUOUS_CONFIDENCE, limitedBy: 'OCCLUSION' };
  }
  const occupancy = features.foregroundRatio;

  // 1. Presence
  if (occupancy <= shape.emptyMaxRatio) {
    const backgroundRelative =
      context.lightReference > 0 ? features.backgroundLuminance / context.lightReference : 0;
    if (backgroundRelative < color.darkSquareMinRelativeLuminance) {
      return { piece: 'UNKNOWN', confidence: AMBIGUOUS_CONFIDENCE, limitedBy: 'BOARD_CONTRAST' };
    }
    return finalize(
      'EMPTY',
      marginConfidence(shape.emptyMaxRatio - occupancy, shape.emptyMaxRatio),
      'PRESENCE',
      config,
    );
  }
  if (occupancy < shape.presenceMinRatio) {
    return { piece: 'UNKNOWN', confidence: AMBIGUOUS_CONFIDENCE, limitedBy: 'PRESENCE' };
  }
  const presenceConfidence = marginConfidence(
    occupancy - shape.presenceMinRatio,
    1 - shape.presenceMinRatio,
  );

  // 2. Color, from the piece/background luminance ratio (log scale).
  const logRatio = Math.log(
    Math.max(features.bodyLuminance, 1e-3) / Math.max(features.backgroundLuminance, 1e-3),
  );
  const whiteThreshold = Math.log(color.whiteMinContrastRatio);
  const blackThreshold = Math.log(color.blackMaxContrastRatio);
  let isWhite: boolean;
  let colorConfidence: number;
  if (logRatio >= whiteThreshold) {
    isWhite = true;
    colorConfidence = marginConfidence(logRatio - whiteThreshold, color.contrastSoftness);
  } else if (logRatio <= blackThreshold) {
    isWhite = false;
    colorConfidence = marginConfidence(blackThreshold - logRatio, color.contrastSoftness);
  } else {
    return { piece: 'UNKNOWN', confidence: AMBIGUOUS_CONFIDENCE, limitedBy: 'COLOR' };
  }

  // 3. King mark: a colored central mark (chromaticity), bright enough to have a color.
  const markChroma =
    Math.max(features.markLuminance, features.bodyLuminance) >= color.kingMarkMinLuminance
      ? chromaDistance(features.markColor, features.bodyColor)
      : 0;
  const isKing = markChroma >= color.kingMarkMinChroma;
  const kingConfidence = marginConfidence(
    Math.abs(markChroma - color.kingMarkMinChroma),
    color.kingMarkChromaSoftness,
  );

  const piece: ObservedPiece = isWhite
    ? isKing
      ? 'WHITE_KING'
      : 'WHITE'
    : isKing
      ? 'BLACK_KING'
      : 'BLACK';
  const confidence = Math.min(presenceConfidence, colorConfidence, kingConfidence);
  const limitedBy =
    confidence === presenceConfidence
      ? 'PRESENCE'
      : confidence === colorConfidence
        ? 'COLOR'
        : 'KING';
  return finalize(piece, confidence, limitedBy, config);
}

function finalize(
  piece: ObservedPiece,
  confidence: number,
  limitedBy: SquareClassification['limitedBy'],
  config: ClassifierConfig,
): SquareClassification {
  return confidence < config.confidence.uncertain
    ? { piece: 'UNKNOWN', confidence, limitedBy }
    : { piece, confidence, limitedBy: confidence >= 1 ? 'NONE' : limitedBy };
}
