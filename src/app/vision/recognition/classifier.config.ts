import type { VisionConfig } from '../vision.config';

/**
 * Recognition thresholds (E3-T01, G3 refactor). They travel inside `VisionConfig.classifier`
 * (spec §14: `Record<string, number>`), so every key has a default and is validated on
 * resolution. All values are initial engineering values, documented in
 * docs/vision/recognition.md — not proven probabilities.
 *
 * References used by the stages:
 * - square background: the median color of the square's corners that look like the
 *   board (corners covered by a piece or an object are ignored);
 * - light reference: light squares never hold pieces, so the median luminance of the
 *   light squares around a playable square measures the local illumination.
 */
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- a type alias (unlike an interface) is assignable to the spec's Record<string, number>.
export type ColorThresholds = {
  /**
   * Pixel RGB distance above which a pixel differs from the square background, as a
   * fraction of the RGB diagonal scaled by the local light reference.
   */
  readonly pixelForegroundDistance: number;
  /**
   * A pixel with the background's chromaticity and a luminance between
   * `shadowMinRatio` and `glareMaxRatio` times the background's is the board in shadow or
   * glare, not an object (shadow-tolerant foreground test).
   */
  readonly shadowMinRatio: number;
  readonly glareMaxRatio: number;
  readonly shadowChromaTolerance: number;
  /** Below this luminance chromaticity is too noisy to be compared. */
  readonly chromaMinLuminance: number;
  /** Piece body / square background luminance ratio at or above which a piece is white. */
  readonly whiteMinContrastRatio: number;
  /** Piece body / square background luminance ratio at or below which a piece is black. */
  readonly blackMaxContrastRatio: number;
  /** Width, in natural-log units, of the soft margin around the contrast-ratio thresholds. */
  readonly contrastSoftness: number;
  /**
   * Chromaticity distance from the piece body at or above which a pixel belongs to a king
   * mark. Kings are recognized by a *colored* mark: grooves, hollows and shadows change
   * luminance, not chromaticity.
   */
  readonly kingMarkMinChroma: number;
  /**
   * Below this luminance, relative to the local light reference, a pixel's chromaticity is
   * too noisy to be a mark pixel (black bodies stay below it).
   */
  readonly kingMarkMinLuminance: number;
  /**
   * A pixel whose chromaticity is this close to a mix of two of {piece body, square
   * background, light square, neutral gray} is a blend (blurred edge, reflection), not a mark.
   */
  readonly kingMarkBlendTolerance: number;
  /**
   * Mark pixels found along the top-face search, relative to the expected mark area
   * (π · kingMarkRadius²), at or above which the piece is a king…
   */
  readonly kingMarkMinCoverage: number;
  /** …with this soft margin (in coverage units) around the threshold. */
  readonly kingMarkCoverageSoftness: number;
  /**
   * Below this background/light-reference ratio a dark square is too dark to tell a black
   * piece from an empty square: "empty" becomes undetermined.
   */
  readonly darkSquareMinRelativeLuminance: number;
  /** A corner belongs to the board when its chromaticity is this close to the board's… */
  readonly backgroundChromaTolerance: number;
  /** …and its luminance/light ratio this close to the board's typical ratio. */
  readonly backgroundRatioTolerance: number;
  /**
   * A "piece" whose body chromaticity differs this much from the median of the other
   * pieces of the same color is not a piece (hand, object): color becomes undetermined.
   */
  readonly pieceChromaTolerance: number;
  /** Chromaticity deviation of a light square that signals an object on it. */
  readonly lightSquareChromaTolerance: number;
  /** Frame mean luminance (0..1) below/above which exposure issues are reported. */
  readonly underexposedMaxLuminance: number;
  readonly overexposedMinLuminance: number;
};

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- a type alias (unlike an interface) is assignable to the spec's Record<string, number>.
export type ShapeThresholds = {
  /** Foreground fraction of the central disk at or above which the square is occupied. */
  readonly presenceMinRatio: number;
  /** Foreground fraction at or below which the square is empty. */
  readonly emptyMaxRatio: number;
  /** Radius of the central disk sampled for the piece, relative to the square size. */
  readonly pieceRadiusRatio: number;
  /** Radius beyond which pixels are square background (corners), relative to the square size. */
  readonly backgroundMinRadiusRatio: number;
  /** Expected king mark radius, relative to the square size (coverage reference). */
  readonly kingMarkRadiusRatio: number;
  /**
   * Foreground fraction of the outer ring of the central disk (0.7 → 1 × pieceRadius) at
   * or above which an occupied-looking disk is a piece: a piece covers its disk up to the
   * edge, a glare spot or a fingertip does not.
   */
  readonly occupancyRingMinRatio: number;
  /** How far (in squares) the top face of a tall piece can be projected away from the camera. */
  readonly topFaceMaxShiftRatio: number;
  /** Half-width of the king-mark search along that line, relative to the square size. */
  readonly markSearchRadiusRatio: number;
  /** Calibration obliquity below which the board is seen from above (no top-face shift). */
  readonly minViewObliquity: number;
  /** Margin excluded along the square edges (grid lines, neighbours), relative to the square size. */
  readonly edgeMarginRatio: number;
  /** Variance of the Laplacian below which the frame is reported as blurry. */
  readonly minSharpness: number;
  /** Odd Gaussian kernel size applied before feature extraction; 1 disables smoothing. */
  readonly denoiseKernelSize: number;
  /** Grid alignment quality (0..1) below which the calibration is reported as misaligned. */
  readonly minAlignmentQuality: number;
};

export interface ClassifierConfig {
  readonly color: ColorThresholds;
  readonly shape: ShapeThresholds;
  /** Inset of the light-square ROI used for the illumination reference. */
  readonly roiInsetRatio: number;
  /** Confidence bands (spec §7): high ≥, acceptable ≥, uncertain ≥; below = UNKNOWN. */
  readonly confidence: VisionConfig['confidenceThresholds'];
}

export const DEFAULT_COLOR_THRESHOLDS: ColorThresholds = {
  pixelForegroundDistance: 0.12,
  shadowMinRatio: 0.45,
  glareMaxRatio: 1.35,
  shadowChromaTolerance: 0.04,
  chromaMinLuminance: 0.12,
  whiteMinContrastRatio: 1.5,
  blackMaxContrastRatio: 0.65,
  contrastSoftness: 0.35,
  kingMarkMinChroma: 0.08,
  kingMarkMinLuminance: 0.22,
  kingMarkBlendTolerance: 0.04,
  kingMarkMinCoverage: 0.4,
  kingMarkCoverageSoftness: 0.25,
  darkSquareMinRelativeLuminance: 0.22,
  backgroundChromaTolerance: 0.06,
  backgroundRatioTolerance: 0.25,
  pieceChromaTolerance: 0.05,
  lightSquareChromaTolerance: 0.05,
  underexposedMaxLuminance: 0.12,
  overexposedMinLuminance: 0.92,
};

export const DEFAULT_SHAPE_THRESHOLDS: ShapeThresholds = {
  presenceMinRatio: 0.45,
  emptyMaxRatio: 0.15,
  pieceRadiusRatio: 0.3,
  backgroundMinRadiusRatio: 0.47,
  kingMarkRadiusRatio: 0.1,
  occupancyRingMinRatio: 0.5,
  topFaceMaxShiftRatio: 0.7,
  markSearchRadiusRatio: 0.22,
  minViewObliquity: 0.05,
  edgeMarginRatio: 0.03,
  minSharpness: 15,
  denoiseKernelSize: 5,
  minAlignmentQuality: 0.5,
};

export class ClassifierConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClassifierConfigError';
  }
}

/** Merges `VisionConfig.classifier` over the defaults and validates the result. */
export function resolveClassifierConfig(config: VisionConfig): ClassifierConfig {
  const color = merge(
    DEFAULT_COLOR_THRESHOLDS,
    config.classifier.colorThresholds,
    'colorThresholds',
  );
  const shape = merge(
    DEFAULT_SHAPE_THRESHOLDS,
    config.classifier.shapeThresholds,
    'shapeThresholds',
  );

  const unitIntervals: [string, number][] = [
    ['pixelForegroundDistance', color.pixelForegroundDistance],
    ['shadowMinRatio', color.shadowMinRatio],
    ['shadowChromaTolerance', color.shadowChromaTolerance],
    ['chromaMinLuminance', color.chromaMinLuminance],
    ['darkSquareMinRelativeLuminance', color.darkSquareMinRelativeLuminance],
    ['kingMarkMinLuminance', color.kingMarkMinLuminance],
    ['backgroundChromaTolerance', color.backgroundChromaTolerance],
    ['lightSquareChromaTolerance', color.lightSquareChromaTolerance],
    ['pieceChromaTolerance', color.pieceChromaTolerance],
    ['presenceMinRatio', shape.presenceMinRatio],
    ['emptyMaxRatio', shape.emptyMaxRatio],
    ['pieceRadiusRatio', shape.pieceRadiusRatio],
    ['backgroundMinRadiusRatio', shape.backgroundMinRadiusRatio],
    ['kingMarkRadiusRatio', shape.kingMarkRadiusRatio],
    ['edgeMarginRatio', shape.edgeMarginRatio],
    ['minAlignmentQuality', shape.minAlignmentQuality],
    ['occupancyRingMinRatio', shape.occupancyRingMinRatio],
    ['topFaceMaxShiftRatio', shape.topFaceMaxShiftRatio],
    ['markSearchRadiusRatio', shape.markSearchRadiusRatio],
    ['minViewObliquity', shape.minViewObliquity],
  ];
  for (const [name, value] of unitIntervals) {
    if (!(value > 0 && value < 1)) {
      throw new ClassifierConfigError(`${name} must be in (0, 1), got ${value}`);
    }
  }
  const positives: [string, number][] = [
    ['contrastSoftness', color.contrastSoftness],
    ['kingMarkMinChroma', color.kingMarkMinChroma],
    ['kingMarkBlendTolerance', color.kingMarkBlendTolerance],
    ['kingMarkMinCoverage', color.kingMarkMinCoverage],
    ['kingMarkCoverageSoftness', color.kingMarkCoverageSoftness],
    ['backgroundRatioTolerance', color.backgroundRatioTolerance],
    ['minSharpness', shape.minSharpness],
  ];
  for (const [name, value] of positives) {
    if (!(value > 0)) {
      throw new ClassifierConfigError(`${name} must be positive, got ${value}`);
    }
  }
  if (!(color.glareMaxRatio > 1)) {
    throw new ClassifierConfigError('glareMaxRatio must be greater than 1');
  }
  if (!(
    Number.isInteger(shape.denoiseKernelSize) &&
    shape.denoiseKernelSize >= 1 &&
    shape.denoiseKernelSize % 2 === 1
  )) {
    throw new ClassifierConfigError('denoiseKernelSize must be an odd integer ≥ 1');
  }
  if (shape.emptyMaxRatio >= shape.presenceMinRatio) {
    throw new ClassifierConfigError('emptyMaxRatio must be lower than presenceMinRatio');
  }
  if (!(
    color.blackMaxContrastRatio > 0 &&
    color.blackMaxContrastRatio < 1 &&
    color.whiteMinContrastRatio > 1
  )) {
    throw new ClassifierConfigError(
      'expected 0 < blackMaxContrastRatio < 1 < whiteMinContrastRatio',
    );
  }
  if (
    shape.kingMarkRadiusRatio >= shape.pieceRadiusRatio ||
    shape.pieceRadiusRatio >= shape.backgroundMinRadiusRatio ||
    shape.backgroundMinRadiusRatio >= Math.SQRT1_2 - shape.edgeMarginRatio
  ) {
    throw new ClassifierConfigError(
      'expected kingMarkRadiusRatio < pieceRadiusRatio < backgroundMinRadiusRatio < corner reach',
    );
  }
  const { high, acceptable, uncertain } = config.confidenceThresholds;
  if (!(uncertain > 0 && uncertain <= acceptable && acceptable <= high && high <= 1)) {
    throw new ClassifierConfigError(
      'confidence thresholds must satisfy 0 < uncertain ≤ acceptable ≤ high ≤ 1',
    );
  }
  return {
    color,
    shape,
    roiInsetRatio: config.roiInsetRatio,
    confidence: config.confidenceThresholds,
  };
}

function merge<T extends Record<string, number>>(
  defaults: T,
  overrides: Readonly<Record<string, number>>,
  section: string,
): T {
  const result: Record<string, number> = { ...defaults };
  for (const [key, value] of Object.entries(overrides)) {
    if (!(key in defaults)) {
      throw new ClassifierConfigError(`unknown ${section} key "${key}"`);
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new ClassifierConfigError(`${section}.${key} must be a finite number`);
    }
    result[key] = value;
  }
  return result as T;
}
