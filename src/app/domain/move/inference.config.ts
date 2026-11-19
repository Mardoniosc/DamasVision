/**
 * Tunable values of stabilization and move inference (E5, spec §7 "Temporal
 * stabilization", §8, §14). Experimental initial values, to tune with real games
 * (docs/vision/move-inference.md).
 */
export interface InferenceConfig {
  /** Observations kept in the window (spec: 3–5). */
  readonly windowSize: number;
  /** Observations older than this, relative to the newest, are dropped. */
  readonly maxAgeMs: number;
  /** Identical consecutive observations needed for a stable board (spec: 3–5)… */
  readonly stableObservationCount: number;
  /** …spanning at least this long (spec: 500–1000 ms). */
  readonly minStableMs: number;
  /** Confidence a changed square needs for a move to be accepted without confirmation. */
  readonly acceptableConfidence: number;
  /** Mismatches allowed outside a move's changed squares for a partial (manual) match. */
  readonly maxPartialMismatches: number;
}

export const DEFAULT_INFERENCE_CONFIG: InferenceConfig = {
  windowSize: 5,
  maxAgeMs: 2000,
  stableObservationCount: 3,
  minStableMs: 500,
  acceptableConfidence: 0.8,
  maxPartialMismatches: 2,
};

/**
 * Values for the app's chain, where observations are already consolidated per square by
 * the recognition stabilizer (G3: ≥ 3 agreeing frames out of 5, ADR-035). Requiring 3
 * identical consolidated boards over 500 ms on top of that doubles the latency. Measured on
 * 1356 synthetic moves (tests/integration/move-inference.spec.ts): 2 boards over 200 ms
 * infer every move with zero false commits in a median 0.8 s after the board settles,
 * against 1.2 s and 11 missed moves with the generic defaults.
 */
export const PIPELINE_INFERENCE_CONFIG: InferenceConfig = {
  ...DEFAULT_INFERENCE_CONFIG,
  stableObservationCount: 2,
  minStableMs: 200,
};

export class InferenceConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InferenceConfigError';
  }
}

export function validateInferenceConfig(config: InferenceConfig): InferenceConfig {
  const integer = (value: number) => Number.isInteger(value) && value >= 1;
  if (!integer(config.windowSize) || !integer(config.stableObservationCount)) {
    throw new InferenceConfigError('windowSize and stableObservationCount must be integers ≥ 1');
  }
  if (config.stableObservationCount > config.windowSize) {
    throw new InferenceConfigError('stableObservationCount must not exceed windowSize');
  }
  if (
    !(config.maxAgeMs > 0) ||
    !(config.minStableMs >= 0) ||
    config.minStableMs > config.maxAgeMs
  ) {
    throw new InferenceConfigError('expected 0 ≤ minStableMs ≤ maxAgeMs and maxAgeMs > 0');
  }
  if (!(config.acceptableConfidence > 0 && config.acceptableConfidence <= 1)) {
    throw new InferenceConfigError('acceptableConfidence must be in (0, 1]');
  }
  if (!(Number.isInteger(config.maxPartialMismatches) && config.maxPartialMismatches >= 0)) {
    throw new InferenceConfigError('maxPartialMismatches must be an integer ≥ 0');
  }
  return config;
}
