import { SQUARE_COUNT } from '../../domain/board/board';
import {
  CalibrationCorners,
  CalibrationOrientation,
  ORIENTATIONS,
} from '../../domain/board/calibration';
import { isObservedPiece, isPiece, ObservedPiece, Piece } from '../../domain/board/piece';
import { isVisionConfig, VisionConfig } from '../../vision/vision.config';

export const LABELED_SAMPLE_FORMAT = 'damas-vision/labeled-sample';

/**
 * A real camera frame with the position confirmed by the user (ground truth), exported
 * from the recognition screen to validate and tune recognition on real boards
 * (tests/integration/real-samples.spec.ts). Contains no personal data beyond the image.
 */
export interface LabeledSample {
  readonly format: typeof LABELED_SAMPLE_FORMAT;
  readonly version: 1;
  readonly createdAt: string;
  /** Raw camera frame as a PNG data URL. */
  readonly frame: { readonly width: number; readonly height: number; readonly png: string };
  /** Calibration in the frame's pixels: corners in screen order + orientation. */
  readonly calibration: {
    readonly corners: CalibrationCorners;
    readonly orientation: CalibrationOrientation;
  };
  /** 64 cells confirmed by the user. */
  readonly labels: readonly Piece[];
  /** What the recognizer reported before the user's corrections. */
  readonly recognized: {
    readonly cells: readonly ObservedPiece[];
    readonly confidenceBySquare: readonly number[];
    /** Worker diagnostics at export time (per-square traces; shape varies by app version). */
    readonly diagnostics: readonly unknown[];
  };
  readonly visionConfig: VisionConfig;
  /** Free text: setup, lighting, anything notable (dataset metadata, G3). */
  readonly description?: string;
  /** Condition tags, see SAMPLE_CONDITIONS. */
  readonly conditions?: readonly SampleCondition[];
}

/** Conditions used to slice the evaluation metrics (G3 dataset). */
export const SAMPLE_CONDITIONS = [
  'LUZ_NATURAL',
  'LUZ_ARTIFICIAL',
  'SOMBRAS',
  'REFLEXOS',
  'DAMAS',
  'OBSTRUCAO',
  'PECAS_DESLOCADAS',
  'TABULEIRO_VAZIO',
  'POUCAS_PECAS',
  'MUITAS_PECAS',
  'ANGULO_ALTERNATIVO',
] as const;
export type SampleCondition = (typeof SAMPLE_CONDITIONS)[number];

/** pt-BR labels of the conditions, for the export form. */
export const SAMPLE_CONDITION_LABELS: Readonly<Record<SampleCondition, string>> = {
  LUZ_NATURAL: 'Luz natural',
  LUZ_ARTIFICIAL: 'Luz artificial',
  SOMBRAS: 'Sombras',
  REFLEXOS: 'Reflexos',
  DAMAS: 'Damas',
  OBSTRUCAO: 'Obstrução (mão, objeto)',
  PECAS_DESLOCADAS: 'Peças fora do centro',
  TABULEIRO_VAZIO: 'Tabuleiro vazio',
  POUCAS_PECAS: 'Poucas peças',
  MUITAS_PECAS: 'Muitas peças',
  ANGULO_ALTERNATIVO: 'Ângulo diferente',
};

/** Dataset metadata the user adds before exporting a sample. */
export interface SampleMetadata {
  readonly description?: string;
  readonly conditions?: readonly SampleCondition[];
}

export function isLabeledSample(value: unknown): value is LabeledSample {
  if (typeof value !== 'object' || value === null) return false;
  const sample = value as Record<string, unknown>;
  const frame = sample['frame'] as Record<string, unknown> | undefined;
  const calibration = sample['calibration'] as Record<string, unknown> | undefined;
  const recognized = sample['recognized'] as Record<string, unknown> | undefined;
  const labels = sample['labels'];
  return (
    sample['format'] === LABELED_SAMPLE_FORMAT &&
    sample['version'] === 1 &&
    typeof frame?.['png'] === 'string' &&
    frame['png'].startsWith('data:image/png;base64,') &&
    typeof frame['width'] === 'number' &&
    typeof frame['height'] === 'number' &&
    typeof calibration?.['corners'] === 'object' &&
    ORIENTATIONS.includes(calibration['orientation'] as CalibrationOrientation) &&
    Array.isArray(labels) &&
    labels.length === SQUARE_COUNT &&
    labels.every(isPiece) &&
    Array.isArray(recognized?.['cells']) &&
    (recognized['cells'] as unknown[]).every(isObservedPiece) &&
    Array.isArray(recognized['diagnostics']) &&
    isVisionConfig(sample['visionConfig'])
  );
}

export function sampleFileName(createdAt: string): string {
  return `damas-vision-amostra-${createdAt.replace(/[:.]/g, '-')}.json`;
}
