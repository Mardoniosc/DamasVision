import { ClassifierConfig } from '../classifier.config';
import { chromaDistance, Rgb, SquareFeatures } from '../square-features';
import {
  ColorDecision,
  marginConfidence,
  StageOutcome,
  UNDETERMINED_CONFIDENCE,
} from './stage.models';

/** Log luminance ratio of the piece body to the square background (same lighting). */
export function contrastLogRatio(features: SquareFeatures): number {
  return Math.log(
    Math.max(features.bodyLuminance, 1e-3) / Math.max(features.backgroundLuminance, 1e-3),
  );
}

/**
 * Stage C — white, black or undetermined, for an occupied square. Compares the piece
 * body (piece pixels only) with the background of the same square, which shares its
 * lighting: robust to gradients and shadows.
 */
export function colorStage(
  features: SquareFeatures,
  config: ClassifierConfig,
): StageOutcome<ColorDecision> {
  const { color } = config;
  const logRatio = contrastLogRatio(features);
  const white = Math.log(color.whiteMinContrastRatio);
  const black = Math.log(color.blackMaxContrastRatio);
  if (logRatio >= white) {
    return {
      decision: 'WHITE',
      confidence: marginConfidence(logRatio - white, color.contrastSoftness),
      reason: 'WHITE_CONTRAST',
    };
  }
  if (logRatio <= black) {
    return {
      decision: 'BLACK',
      confidence: marginConfidence(black - logRatio, color.contrastSoftness),
      reason: 'BLACK_CONTRAST',
    };
  }
  return {
    decision: 'UNDETERMINED',
    confidence: UNDETERMINED_CONFIDENCE,
    reason: 'AMBIGUOUS_COLOR',
  };
}

/** Minimum number of pieces of a color before their chromaticity is used as a reference. */
export const MIN_PIECES_FOR_CONSISTENCY = 3;

/**
 * Stage C, board level — light pieces of one board share their chromaticity; a "white
 * piece" with a clearly different body color is something else (a hand, an object), and
 * becomes undetermined. Dark bodies are skipped: their chromaticity is noise.
 */
export function enforceColorConsistency(
  outcomes: readonly (StageOutcome<ColorDecision> | null)[],
  bodyColors: readonly Rgb[],
  bodyLuminances: readonly number[],
  config: ClassifierConfig,
): (StageOutcome<ColorDecision> | null)[] {
  const reliable = (i: number): boolean =>
    (bodyLuminances[i] ?? 0) >= config.color.chromaMinLuminance;
  const whites = outcomes.flatMap((o, i) => (o?.decision === 'WHITE' && reliable(i) ? [i] : []));
  if (whites.length < MIN_PIECES_FOR_CONSISTENCY) return [...outcomes];
  const chroma = whites.map((i) => {
    const c = bodyColors[i] ?? [0, 0, 0];
    const sum = c[0] + c[1] + c[2] || 1;
    return [c[0] / sum, c[1] / sum] as const;
  });
  const reference: Rgb = [
    medianOf(chroma.map((c) => c[0])),
    medianOf(chroma.map((c) => c[1])),
    1 - medianOf(chroma.map((c) => c[0])) - medianOf(chroma.map((c) => c[1])),
  ];
  return outcomes.map((outcome, i) => {
    if (outcome?.decision !== 'WHITE' || !reliable(i)) return outcome;
    return chromaDistance(bodyColors[i] ?? [0, 0, 0], reference) > config.color.pieceChromaTolerance
      ? {
          decision: 'UNDETERMINED',
          confidence: UNDETERMINED_CONFIDENCE,
          reason: 'INCONSISTENT_PIECE_COLOR',
        }
      : outcome;
  });
}

function medianOf(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] as number)
    : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}
