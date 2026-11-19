import { DEFAULT_VISION_CONFIG, VisionConfig } from '../vision.config';
import {
  ClassifierConfigError,
  DEFAULT_COLOR_THRESHOLDS,
  DEFAULT_SHAPE_THRESHOLDS,
  resolveClassifierConfig,
} from './classifier.config';

function withClassifier(
  colorThresholds: Record<string, number>,
  shapeThresholds: Record<string, number> = {},
): VisionConfig {
  return { ...DEFAULT_VISION_CONFIG, classifier: { colorThresholds, shapeThresholds } };
}

describe('resolveClassifierConfig (E3-T01)', () => {
  it('uses the documented defaults', () => {
    const config = resolveClassifierConfig(DEFAULT_VISION_CONFIG);

    expect(config.color).toEqual(DEFAULT_COLOR_THRESHOLDS);
    expect(config.shape).toEqual(DEFAULT_SHAPE_THRESHOLDS);
    expect(config.roiInsetRatio).toBe(0.15);
    expect(config.confidence).toEqual({ high: 0.95, acceptable: 0.8, uncertain: 0.6 });
  });

  it('fills missing keys from the defaults (spec shape: Record<string, number>)', () => {
    const config = resolveClassifierConfig(withClassifier({ whiteMinContrastRatio: 1.8 }));

    expect(config.color.whiteMinContrastRatio).toBe(1.8);
    expect(config.color.blackMaxContrastRatio).toBe(DEFAULT_COLOR_THRESHOLDS.blackMaxContrastRatio);
  });

  it.each([
    ['an unknown key', withClassifier({ typo: 1 })],
    ['a non-finite value', withClassifier({ contrastSoftness: Number.NaN })],
    ['a ratio outside (0, 1)', withClassifier({ pixelForegroundDistance: 1.5 })],
    ['empty ≥ presence', withClassifier({}, { emptyMaxRatio: 0.6 })],
    ['white ratio ≤ 1', withClassifier({ whiteMinContrastRatio: 0.9 })],
    ['king mark larger than the piece', withClassifier({}, { kingMarkRadiusRatio: 0.35 })],
    ['an even denoise kernel', withClassifier({}, { denoiseKernelSize: 4 })],
    [
      'unordered confidence bands',
      {
        ...DEFAULT_VISION_CONFIG,
        confidenceThresholds: { high: 0.7, acceptable: 0.8, uncertain: 0.6 },
      },
    ],
  ])('rejects %s', (_label, config) => {
    expect(() => resolveClassifierConfig(config)).toThrow(ClassifierConfigError);
  });
});
