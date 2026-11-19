import type { VisionConfig } from '../vision.config';

/**
 * Typed classifier thresholds (E3-T01). They travel inside `VisionConfig.classifier`
 * (spec §14: `Record<string, number>`), so every key has a default and is validated
 * on resolution. All values are initial tuning values, not proven probabilities.
 *
 * Reference luminances:
 * - square background: the median color of the square's corners (outside the piece
 *   circle), lit exactly like the piece on it;
 * - light reference: light squares never hold pieces, so the median luminance of the
 *   light squares around a playable square measures the local illumination.
 */
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- a type alias (unlike an interface) is assignable to the spec's Record<string, number>.
export type ColorThresholds = {
  /**
   * Pixel RGB distance above which a pixel differs from the square background, as a
   * fraction of the RGB diagonal scaled by the local light reference (so the test keeps
   * the same meaning in dim and bright light).
   */
  readonly pixelForegroundDistance: number;
  /** Piece body / square background luminance ratio at or above which a piece is white. */
  readonly whiteMinContrastRatio: number;
  /** Piece body / square background luminance ratio at or below which a piece is black. */
  readonly blackMaxContrastRatio: number;
  /** Width, in natural-log units, of the soft margin around the contrast-ratio thresholds. */
  readonly contrastSoftness: number;
  /**
   * Chromaticity distance between the king mark and the piece body. Kings are recognized
   * by a *colored* mark: grooves, hollows and shadows on real pieces change luminance but
   * not chromaticity (first real-world samples, 2026-11-19).
   */
  readonly kingMarkMinChroma: number;
  readonly kingMarkChromaSoftness: number;
  /** Below this luminance the mark's chromaticity is too noisy to be trusted. */
  readonly kingMarkMinLuminance: number;
  /**
   * Below this background/light-reference ratio a dark square is too dark to tell a black
   * piece from an empty square: "empty" verdicts become UNKNOWN.
   */
  readonly darkSquareMinRelativeLuminance: number;
  /** Chromaticity distance from the board's typical square color that signals an occluding object. */
  readonly chromaMaxDeviation: number;
  /** Absolute deviation of a square's background/light ratio from the board's typical ratio that signals occlusion. */
  readonly occlusionMaxDeviation: number;
  /** Frame mean luminance (0..1) below/above which exposure warnings are raised. */
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
  /** Radius beyond which pixels are treated as square background (corners), relative to the square size. */
  readonly backgroundMinRadiusRatio: number;
  /** Radius of the king mark sampled at the piece center, relative to the square size. */
  readonly kingMarkRadiusRatio: number;
  /** Variance of the Laplacian below which the frame is reported as blurry. */
  readonly minSharpness: number;
  /** Odd Gaussian kernel size applied before feature extraction; 1 disables smoothing. */
  readonly denoiseKernelSize: number;
};

export interface ClassifierConfig {
  readonly color: ColorThresholds;
  readonly shape: ShapeThresholds;
  readonly roiInsetRatio: number;
  readonly confidence: VisionConfig['confidenceThresholds'];
}

export const DEFAULT_COLOR_THRESHOLDS: ColorThresholds = {
  pixelForegroundDistance: 0.12,
  whiteMinContrastRatio: 1.5,
  blackMaxContrastRatio: 0.65,
  contrastSoftness: 0.35,
  kingMarkMinChroma: 0.08,
  kingMarkChromaSoftness: 0.04,
  kingMarkMinLuminance: 0.2,
  darkSquareMinRelativeLuminance: 0.22,
  chromaMaxDeviation: 0.05,
  occlusionMaxDeviation: 0.25,
  underexposedMaxLuminance: 0.12,
  overexposedMinLuminance: 0.92,
};

export const DEFAULT_SHAPE_THRESHOLDS: ShapeThresholds = {
  presenceMinRatio: 0.45,
  emptyMaxRatio: 0.15,
  pieceRadiusRatio: 0.3,
  backgroundMinRadiusRatio: 0.47,
  kingMarkRadiusRatio: 0.1,
  minSharpness: 15,
  denoiseKernelSize: 5,
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
    ['darkSquareMinRelativeLuminance', color.darkSquareMinRelativeLuminance],
    ['kingMarkMinLuminance', color.kingMarkMinLuminance],
    ['chromaMaxDeviation', color.chromaMaxDeviation],
    ['presenceMinRatio', shape.presenceMinRatio],
    ['emptyMaxRatio', shape.emptyMaxRatio],
    ['pieceRadiusRatio', shape.pieceRadiusRatio],
    ['backgroundMinRadiusRatio', shape.backgroundMinRadiusRatio],
    ['kingMarkRadiusRatio', shape.kingMarkRadiusRatio],
  ];
  for (const [name, value] of unitIntervals) {
    if (!(value > 0 && value < 1)) {
      throw new ClassifierConfigError(`${name} must be in (0, 1), got ${value}`);
    }
  }
  const positives: [string, number][] = [
    ['contrastSoftness', color.contrastSoftness],
    ['kingMarkMinChroma', color.kingMarkMinChroma],
    ['kingMarkChromaSoftness', color.kingMarkChromaSoftness],
    ['occlusionMaxDeviation', color.occlusionMaxDeviation],
    ['minSharpness', shape.minSharpness],
  ];
  for (const [name, value] of positives) {
    if (!(value > 0)) {
      throw new ClassifierConfigError(`${name} must be positive, got ${value}`);
    }
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
    shape.pieceRadiusRatio >= shape.backgroundMinRadiusRatio
  ) {
    throw new ClassifierConfigError(
      'expected kingMarkRadiusRatio < pieceRadiusRatio < backgroundMinRadiusRatio',
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
