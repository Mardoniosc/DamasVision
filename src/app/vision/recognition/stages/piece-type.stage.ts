import { ClassifierConfig } from '../classifier.config';
import { MarkSearch } from '../top-face';
import { marginConfidence, PieceTypeDecision, StageOutcome } from './stage.models';

/**
 * Stage D — man or king, independent of the piece color. Kings carry a *colored* mark
 * (spec §7 standardized pieces) on their top face, which an oblique camera sees displaced
 * away from it: the mark is searched along that line (top-face.ts), and the decision uses
 * how much mark-colored area was found. Grooves, hollows and shadows are achromatic and
 * are not marks. Stacked or achromatic kings are not detected (manual correction / engine).
 */
export function pieceTypeStage(
  mark: MarkSearch,
  config: ClassifierConfig,
): StageOutcome<PieceTypeDecision> {
  const { kingMarkMinCoverage, kingMarkCoverageSoftness } = config.color;
  const confidence = marginConfidence(
    Math.abs(mark.coverage - kingMarkMinCoverage),
    kingMarkCoverageSoftness,
  );
  if (confidence < config.confidence.uncertain) {
    return { decision: 'UNDETERMINED', confidence, reason: 'AMBIGUOUS_MARK' };
  }
  return mark.coverage >= kingMarkMinCoverage
    ? { decision: 'KING', confidence, reason: 'COLORED_MARK' }
    : { decision: 'MAN', confidence, reason: 'NO_MARK' };
}
