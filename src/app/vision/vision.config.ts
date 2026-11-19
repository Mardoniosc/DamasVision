/**
 * Vision configuration (docs/execution-specification.md §14). Experimental defaults,
 * to be tuned with physical tests. Recognition fields are consumed from E3 onwards.
 */
export interface VisionConfig {
  readonly normalizedBoardWidth: number;
  readonly normalizedBoardHeight: number;
  readonly analysisIntervalMs: number;
  readonly stabilityWindowSize: number;
  readonly stableObservationCount: number;
  readonly confidenceThresholds: {
    readonly high: number;
    readonly acceptable: number;
    readonly uncertain: number;
  };
  readonly roiInsetRatio: number;
  readonly classifier: {
    readonly colorThresholds: Readonly<Record<string, number>>;
    readonly shapeThresholds: Readonly<Record<string, number>>;
  };
}

export const DEFAULT_VISION_CONFIG: VisionConfig = {
  normalizedBoardWidth: 800,
  normalizedBoardHeight: 800,
  analysisIntervalMs: 200,
  stabilityWindowSize: 5,
  stableObservationCount: 3,
  confidenceThresholds: { high: 0.95, acceptable: 0.8, uncertain: 0.6 },
  roiInsetRatio: 0.15,
  classifier: { colorThresholds: {}, shapeThresholds: {} },
};

/** Structural check for configs received over postMessage. */
export function isVisionConfig(value: unknown): value is VisionConfig {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const config = value as Partial<Record<keyof VisionConfig, unknown>>;
  const positive = (v: unknown): boolean => typeof v === 'number' && Number.isFinite(v) && v > 0;
  const thresholds = config.confidenceThresholds as Record<string, unknown> | undefined;
  return (
    positive(config.normalizedBoardWidth) &&
    positive(config.normalizedBoardHeight) &&
    positive(config.analysisIntervalMs) &&
    positive(config.stabilityWindowSize) &&
    positive(config.stableObservationCount) &&
    typeof config.roiInsetRatio === 'number' &&
    config.roiInsetRatio >= 0 &&
    config.roiInsetRatio < 0.5 &&
    typeof thresholds === 'object' &&
    thresholds !== null &&
    ['high', 'acceptable', 'uncertain'].every((key) => typeof thresholds[key] === 'number') &&
    typeof config.classifier === 'object' &&
    config.classifier !== null
  );
}
