import { isOnBoard, SQUARE_COUNT, SquareIndex, squareIndex } from '../../domain/board/board';
import { createBoardGrid, SquareGeometry } from '../../domain/board/board-grid';
import {
  BoardRecognitionResult,
  RecognitionStatus,
  RecognitionWarning,
  SquareRecognition,
} from '../../domain/board/observation';
import { ObservedPiece, pieceColor } from '../../domain/board/piece';
import { RgbaImage } from '../perspective';
import { ClassifierConfig } from './classifier.config';
import { classifySquare, SquareClassification } from './square-classifier';
import {
  chromaDistance,
  extractSquareFeatures,
  luminance,
  Rgb,
  roiColor,
  SquareFeatures,
} from './square-features';

/** Pieces per side in Brazilian 64-square checkers; more is physically implausible. */
const MAX_PIECES_PER_SIDE = 12;
/** A light square brighter/darker than this factor of the board median is suspicious. */
const LIGHT_SQUARE_MAX_FACTOR = 2;

export interface FrameQualityWarning {
  readonly code: 'LOW_SHARPNESS' | 'UNDEREXPOSED' | 'OVEREXPOSED';
  readonly message: string;
}

export interface RecognizeBoardOptions {
  readonly timestamp: number;
  readonly frameId?: string;
  /** Advisory frame-quality warnings to attach (spec §7: never a hard rejection). */
  readonly qualityWarnings?: readonly FrameQualityWarning[];
}

export interface SquareDiagnostics {
  readonly features: SquareFeatures;
  readonly lightReference: number;
  readonly occluded: boolean;
  readonly classification: SquareClassification;
}

export interface BoardRecognitionDetails {
  readonly result: BoardRecognitionResult;
  /** Per playable square, for diagnostics and tuning. */
  readonly diagnostics: readonly SquareDiagnostics[];
}

/**
 * Builds a {@link BoardRecognitionResult} from a normalized (rectified) board image
 * (E3-T07). Light squares never hold pieces: they provide the local illumination
 * reference and, together with each square's background, reveal occluding objects.
 */
export function recognizeBoard(
  image: RgbaImage,
  config: ClassifierConfig,
  options: RecognizeBoardOptions,
): BoardRecognitionDetails {
  const grid = createBoardGrid(image);
  const lightSquares = grid.filter((square) => !square.isPlayable);
  const playableSquares = grid.filter((square) => square.isPlayable);

  // Light squares: color, global references, and the ones that look wrong.
  const lightColor = new Map<SquareIndex, Rgb>(
    lightSquares.map((square) => [square.index, roiColor(image, square, config.roiInsetRatio)]),
  );
  const lightLuma = new Map([...lightColor].map(([index, color]) => [index, luminance(...color)]));
  const globalLight = median([...lightLuma.values()]);
  const typicalLightColor = medianRgb([...lightColor.values()]);
  const suspiciousLight = new Set(
    [...lightColor]
      .filter(([index, color]) => {
        const luma = lightLuma.get(index) ?? 0;
        const factor =
          globalLight > 0 && luma > 0 ? Math.max(luma / globalLight, globalLight / luma) : Infinity;
        return (
          factor > LIGHT_SQUARE_MAX_FACTOR ||
          chromaDistance(color, typicalLightColor) > config.color.chromaMaxDeviation
        );
      })
      .map(([index]) => index),
  );

  // Playable squares: features, then the board's typical background, then occlusion.
  const references = playableSquares.map(
    (square) => localLightReference(square, lightLuma, suspiciousLight) ?? globalLight,
  );
  // The foreground threshold scales with the local illumination: in dim light a black
  // piece and a dark square differ by few gray levels, but by the same relative amount.
  const features = playableSquares.map((square, i) =>
    extractSquareFeatures(
      image,
      square,
      config.shape,
      config.color.pixelForegroundDistance * (references[i] ?? globalLight),
    ),
  );
  const backgroundRatios = features.map((f, i) => {
    const reference = references[i] ?? 0;
    return reference > 0 ? f.backgroundLuminance / reference : 0;
  });
  const typicalBackgroundRatio = median(backgroundRatios);
  const typicalBackgroundColor = medianRgb(features.map((f) => f.backgroundColor));

  const cells: ObservedPiece[] = Array.from({ length: SQUARE_COUNT }, () => 'EMPTY');
  const confidenceBySquare: number[] = Array.from({ length: SQUARE_COUNT }, () => 1);
  const squares: SquareRecognition[] = [];
  const diagnostics: SquareDiagnostics[] = [];
  const occludedSquares: SquareIndex[] = [];
  const lowContrastSquares: SquareIndex[] = [];

  playableSquares.forEach((square, i) => {
    const squareFeatures = features[i] as SquareFeatures;
    const lightReference = references[i] ?? globalLight;
    const occluded =
      Math.abs((backgroundRatios[i] ?? 0) - typicalBackgroundRatio) >
        config.color.occlusionMaxDeviation ||
      chromaDistance(squareFeatures.backgroundColor, typicalBackgroundColor) >
        config.color.chromaMaxDeviation;
    const classification = classifySquare(squareFeatures, { lightReference, occluded }, config);
    const confidence = round(classification.confidence);

    cells[square.index] = classification.piece;
    confidenceBySquare[square.index] = confidence;
    squares.push({ squareIndex: square.index, piece: classification.piece, confidence });
    diagnostics.push({ features: squareFeatures, lightReference, occluded, classification });
    if (occluded) occludedSquares.push(square.index);
    if (classification.limitedBy === 'BOARD_CONTRAST') lowContrastSquares.push(square.index);
  });

  const warnings = buildWarnings(squares, {
    unexpected: [...suspiciousLight, ...occludedSquares].sort((a, b) => a - b),
    lowContrast: lowContrastSquares,
    config,
    quality: options.qualityWarnings ?? [],
  });
  const overallConfidence = round(
    squares.reduce((sum, s) => sum + s.confidence, 0) / squares.length,
  );
  const status: RecognitionStatus =
    squares.some((s) => s.piece === 'UNKNOWN') ||
    squares.some((s) => s.confidence < config.confidence.acceptable)
      ? 'UNCERTAIN'
      : 'SUCCESS';

  return {
    result: {
      board: {
        cells,
        confidenceBySquare,
        timestamp: options.timestamp,
        ...(options.frameId ? { sourceFrameId: options.frameId } : {}),
      },
      squares,
      status,
      overallConfidence,
      warnings,
      timestamp: options.timestamp,
    },
    diagnostics,
  };
}

/** Median luminance of the orthogonally adjacent light squares (always non-playable). */
function localLightReference(
  square: SquareGeometry,
  lightLuma: ReadonlyMap<SquareIndex, number>,
  excluded: ReadonlySet<SquareIndex>,
): number | null {
  const neighbours: number[] = [];
  for (const [dr, dc] of [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ] as const) {
    const row = square.row + dr;
    const column = square.column + dc;
    if (!isOnBoard(row, column)) continue;
    const index = squareIndex(row, column);
    const luma = lightLuma.get(index);
    if (luma !== undefined && !excluded.has(index)) neighbours.push(luma);
  }
  return neighbours.length > 0 ? median(neighbours) : null;
}

function buildWarnings(
  squares: readonly SquareRecognition[],
  context: {
    unexpected: readonly SquareIndex[];
    lowContrast: readonly SquareIndex[];
    config: ClassifierConfig;
    quality: readonly FrameQualityWarning[];
  },
): RecognitionWarning[] {
  const warnings: RecognitionWarning[] = [];
  const unknown = squares.filter((s) => s.piece === 'UNKNOWN').map((s) => s.squareIndex);
  if (unknown.length > 0) {
    warnings.push({
      code: 'UNKNOWN_SQUARES',
      message: `${unknown.length} casa(s) não puderam ser identificadas com segurança.`,
      affectedSquares: unknown,
    });
  }
  const low = squares
    .filter((s) => s.piece !== 'UNKNOWN' && s.confidence < context.config.confidence.acceptable)
    .map((s) => s.squareIndex);
  if (low.length > 0) {
    warnings.push({
      code: 'LOW_CONFIDENCE',
      message: `${low.length} casa(s) foram identificadas com baixa confiança.`,
      affectedSquares: low,
    });
  }
  if (context.unexpected.length > 0) {
    warnings.push({
      code: 'UNEXPECTED_OBJECTS',
      message:
        'Há algo sobre o tabuleiro (mão, objeto ou peça fora do lugar) ou a calibração se deslocou.',
      affectedSquares: context.unexpected,
    });
  }
  if (context.lowContrast.length > 0) {
    warnings.push({
      code: 'LOW_BOARD_CONTRAST',
      message:
        'As casas escuras estão escuras demais para distinguir peças pretas; confira essas casas.',
      affectedSquares: context.lowContrast,
    });
  }
  for (const color of ['WHITE', 'BLACK'] as const) {
    const count = squares.filter((s) => pieceColor(s.piece) === color).length;
    if (count > MAX_PIECES_PER_SIDE) {
      warnings.push({
        code: 'TOO_MANY_PIECES',
        message: `Foram vistas ${count} peças ${color === 'WHITE' ? 'brancas' : 'pretas'}; o máximo é ${MAX_PIECES_PER_SIDE}.`,
      });
    }
  }
  warnings.push(...context.quality);
  return warnings;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] as number)
    : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

function medianRgb(colors: readonly Rgb[]): Rgb {
  return [
    median(colors.map((c) => c[0])),
    median(colors.map((c) => c[1])),
    median(colors.map((c) => c[2])),
  ];
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
