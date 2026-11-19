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
import { boardBackground, median, squareBackground } from './background-model';
import { ClassifierConfig } from './classifier.config';
import { gridAlignmentQuality } from './grid-alignment';
import { lightSquareRoi, squareRegions } from './square-regions';
import {
  chromaDistance,
  extractSquareFeatures,
  luminance,
  measureCorners,
  medianColor,
  Rgb,
  SquareFeatures,
} from './square-features';
import { explainSquare, SquareTrace } from './square-trace';
import { colorStage, contrastLogRatio, enforceColorConsistency } from './stages/color.stage';
import { consolidate } from './stages/consolidate';
import { occupancyStage } from './stages/occupancy.stage';
import { pieceTypeStage } from './stages/piece-type.stage';
import { searchKingMark } from './top-face';
import { Point2D } from '../../domain/board/geometry';

/** Pieces per side in Brazilian 64-square checkers; more is physically implausible. */
const MAX_PIECES_PER_SIDE = 12;
/** A light square brighter/darker than this factor of the board median is suspicious. */
const LIGHT_SQUARE_MAX_FACTOR = 2;

export type FrameIssue =
  'LOW_SHARPNESS' | 'UNDEREXPOSED' | 'OVEREXPOSED' | 'CALIBRATION_MISALIGNED';

/** Stage A result: advisory frame quality (spec §7: never a hard rejection). */
export interface FrameAssessment {
  readonly sharpness: number | null;
  readonly meanLuminance: number | null;
  /** Grid alignment, 0..1 (1 = square borders on the grid). */
  readonly alignmentQuality: number;
  readonly issues: readonly FrameIssue[];
}

export interface RecognizeBoardOptions {
  readonly timestamp: number;
  readonly frameId?: string;
  /** Sharpness/exposure measured on the raw rectified image (OpenCV, worker). */
  readonly quality?: { readonly sharpness: number; readonly meanLuminance: number };
  /**
   * Unit vector pointing away from the camera on the rectified board (top-face.ts
   * `awayFromCamera`, from the calibration); null or absent = seen from above.
   */
  readonly awayFromCamera?: Point2D | null;
}

export interface BoardRecognitionDetails {
  readonly result: BoardRecognitionResult;
  readonly traces: readonly SquareTrace[];
  readonly frame: FrameAssessment;
  /** Raw features per playable square (tests, tuning). */
  readonly features: readonly SquareFeatures[];
}

const ISSUE_MESSAGES: Readonly<Record<FrameIssue, string>> = {
  LOW_SHARPNESS: 'A imagem parece desfocada ou tremida.',
  UNDEREXPOSED: 'A imagem está escura demais; melhore a iluminação.',
  OVEREXPOSED: 'A imagem está clara demais (reflexo ou luz direta).',
  CALIBRATION_MISALIGNED:
    'As bordas das casas não coincidem com a grade: a calibração parece deslocada. Use "Reajustar cantos".',
};

/**
 * Recognition pipeline on a rectified board (G3):
 *  A. frame assessment — sharpness, exposure, grid alignment;
 *  then per playable square: background model (corners that look like the board),
 *  features, B. occupancy, C. color, D. piece type, E. consolidation — with a trace.
 * Light squares never hold pieces: they give the local illumination reference.
 */
export function recognizeBoard(
  image: RgbaImage,
  config: ClassifierConfig,
  options: RecognizeBoardOptions,
): BoardRecognitionDetails {
  const frame = assessFrame(image, config, options);
  const grid = createBoardGrid(image);
  const lightSquares = grid.filter((square) => !square.isPlayable);
  const playable = grid.filter((square) => square.isPlayable);

  // Light squares: illumination reference and suspicious squares.
  const lightColor = new Map<SquareIndex, Rgb>(
    lightSquares.map((square) => [
      square.index,
      medianColor(image, lightSquareRoi(square, config.roiInsetRatio)),
    ]),
  );
  const lightLuma = new Map([...lightColor].map(([index, color]) => [index, luminance(...color)]));
  const globalLight = median([...lightLuma.values()]);
  const typicalLight: Rgb = [
    median([...lightColor.values()].map((c) => c[0])),
    median([...lightColor.values()].map((c) => c[1])),
    median([...lightColor.values()].map((c) => c[2])),
  ];
  const suspiciousLight = new Set(
    [...lightColor]
      .filter(([index, color]) => {
        const luma = lightLuma.get(index) ?? 0;
        const factor =
          globalLight > 0 && luma > 0 ? Math.max(luma / globalLight, globalLight / luma) : Infinity;
        return (
          factor > LIGHT_SQUARE_MAX_FACTOR ||
          chromaDistance(color, typicalLight) > config.color.lightSquareChromaTolerance
        );
      })
      .map(([index]) => index),
  );

  // Background model over every playable square's corners.
  const regions = playable.map((square) => squareRegions(square, config.shape));
  const references = playable.map(
    (square) => localLightReference(square, lightLuma, suspiciousLight) ?? globalLight,
  );
  const corners = regions.map((region) => measureCorners(image, region));
  const board = boardBackground(corners, references);

  const cells: ObservedPiece[] = Array.from({ length: SQUARE_COUNT }, () => 'EMPTY');
  const confidenceBySquare: number[] = Array.from({ length: SQUARE_COUNT }, () => 1);
  const squares: SquareRecognition[] = [];
  const traces: SquareTrace[] = [];
  const features: SquareFeatures[] = [];

  // Per square: background, features, stage B (occupancy), stage C (color).
  const measured = playable.map((square, i) => {
    const reference = references[i] ?? globalLight;
    const background = squareBackground(corners[i] ?? [], reference, board, config.color);
    const squareFeatures = extractSquareFeatures(
      image,
      square.index,
      regions[i]!,
      background.color,
      {
        distance: config.color.pixelForegroundDistance * reference,
        color: config.color,
      },
    );
    const backgroundRelative = reference > 0 ? squareFeatures.backgroundLuminance / reference : 0;
    const occupancy = occupancyStage(
      squareFeatures,
      { visibleCorners: background.visibleCorners, backgroundRelative },
      config,
    );
    const color = occupancy.decision === 'OCCUPIED' ? colorStage(squareFeatures, config) : null;
    return { reference, background, squareFeatures, backgroundRelative, occupancy, color };
  });
  // Stage C, board level: light pieces must share their chromaticity.
  const consistentColors = enforceColorConsistency(
    measured.map((m) => m.color),
    measured.map((m) => m.squareFeatures.bodyColor),
    measured.map((m) => m.squareFeatures.bodyLuminance),
    config,
  );

  playable.forEach((square, i) => {
    const region = regions[i]!;
    const { reference, background, squareFeatures, backgroundRelative, occupancy } = measured[i]!;
    const color = consistentColors[i] ?? null;
    const away = options.awayFromCamera ?? null;
    const mark =
      occupancy.decision === 'OCCUPIED'
        ? searchKingMark(
            image,
            region,
            away,
            {
              body: squareFeatures.bodyColor,
              background: background.color,
              light: typicalLight,
              lightLuminance: reference,
            },
            config,
          )
        : null;
    const pieceType = mark ? pieceTypeStage(mark, config) : null;
    const searchLength = away ? config.shape.topFaceMaxShiftRatio * region.size : 0;
    const result = consolidate(occupancy, color, pieceType, config);
    const confidence = round(result.confidence);

    const traceWithoutText: Omit<SquareTrace, 'explanation'> = {
      squareIndex: square.index,
      piece: result.piece,
      confidence,
      decision: result.decision,
      reason: result.reason,
      limitingStage: result.limitingStage,
      regions: {
        centerX: round(region.center.x),
        centerY: round(region.center.y),
        size: round(region.size),
        pieceRadius: round(region.pieceRadius),
        markRadius: round(region.markRadius),
        backgroundRadius: round(region.backgroundRadius),
        markSearch: {
          endX: round(region.center.x + (away?.x ?? 0) * searchLength),
          endY: round(region.center.y + (away?.y ?? 0) * searchLength),
          radius: round(config.shape.markSearchRadiusRatio * region.size),
        },
      },
      roi: {
        cornerMatches: background.cornerMatches,
        visibleCorners: background.visibleCorners,
        quality: background.visibleCorners / 4,
      },
      occupancy: roundOutcome(occupancy),
      color: color ? roundOutcome(color) : null,
      pieceType: pieceType ? roundOutcome(pieceType) : null,
      features: {
        foregroundRatio: round(squareFeatures.foregroundRatio),
        shadowRatio: round(squareFeatures.shadowRatio),
        ringForegroundRatio: round(squareFeatures.ringForegroundRatio),
        backgroundLuminance: round(squareFeatures.backgroundLuminance),
        backgroundRelative: round(backgroundRelative),
        lightReference: round(reference),
        pieceLuminance: round(squareFeatures.pieceLuminance),
        pieceLuminanceStd: round(squareFeatures.pieceLuminanceStd),
        bodyLuminance: round(squareFeatures.bodyLuminance),
        markLuminance: round(squareFeatures.markLuminance),
        contrastRatio: round(Math.exp(contrastLogRatio(squareFeatures))),
        markCoverage: mark ? round(mark.coverage) : 0,
        markOffset: mark?.offset ? { x: round(mark.offset.x), y: round(mark.offset.y) } : null,
        backgroundColor: squareFeatures.backgroundColor.map(Math.round),
        bodyColor: squareFeatures.bodyColor.map(Math.round),
      },
    };
    const trace: SquareTrace = {
      ...traceWithoutText,
      explanation: explainSquare(traceWithoutText, config),
    };

    cells[square.index] = result.piece;
    confidenceBySquare[square.index] = confidence;
    squares.push({ squareIndex: square.index, piece: result.piece, confidence });
    traces.push(trace);
    features.push(squareFeatures);
  });

  const obstructed = traces
    .filter((t) => t.reason === 'ROI_OBSTRUCTED' || t.reason === 'INCONSISTENT_PIECE_COLOR')
    .map((t) => t.squareIndex);
  const warnings = buildWarnings(squares, traces, frame, [...suspiciousLight, ...obstructed]);
  const overallConfidence = round(
    squares.reduce((sum, s) => sum + s.confidence, 0) / squares.length,
  );
  const status: RecognitionStatus = traces.some((t) => t.decision !== 'ACCEPT')
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
    traces,
    frame,
    features,
  };
}

/** Stage A: advisory frame assessment. */
export function assessFrame(
  image: RgbaImage,
  config: ClassifierConfig,
  options: Pick<RecognizeBoardOptions, 'quality'>,
): FrameAssessment {
  const alignmentQuality = round(gridAlignmentQuality(image));
  const issues: FrameIssue[] = [];
  const quality = options.quality;
  if (quality && quality.sharpness < config.shape.minSharpness) issues.push('LOW_SHARPNESS');
  if (quality && quality.meanLuminance < config.color.underexposedMaxLuminance)
    issues.push('UNDEREXPOSED');
  if (quality && quality.meanLuminance > config.color.overexposedMinLuminance)
    issues.push('OVEREXPOSED');
  if (alignmentQuality < config.shape.minAlignmentQuality) issues.push('CALIBRATION_MISALIGNED');
  return {
    sharpness: quality ? round(quality.sharpness) : null,
    meanLuminance: quality ? round(quality.meanLuminance) : null,
    alignmentQuality,
    issues,
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
  traces: readonly SquareTrace[],
  frame: FrameAssessment,
  unexpected: readonly SquareIndex[],
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
  const low = traces.filter((t) => t.decision === 'WARN').map((t) => t.squareIndex);
  if (low.length > 0) {
    warnings.push({
      code: 'LOW_CONFIDENCE',
      message: `${low.length} casa(s) foram identificadas com baixa confiança.`,
      affectedSquares: low,
    });
  }
  if (unexpected.length > 0) {
    warnings.push({
      code: 'UNEXPECTED_OBJECTS',
      message:
        'Há algo sobre o tabuleiro (mão, objeto ou peça fora do lugar) ou a calibração se deslocou.',
      affectedSquares: [...new Set(unexpected)].sort((a, b) => a - b),
    });
  }
  const lowContrast = traces
    .filter((t) => t.reason === 'LOW_BOARD_CONTRAST')
    .map((t) => t.squareIndex);
  if (lowContrast.length > 0) {
    warnings.push({
      code: 'LOW_BOARD_CONTRAST',
      message:
        'As casas escuras estão escuras demais para distinguir peças pretas; confira essas casas.',
      affectedSquares: lowContrast,
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
  for (const issue of frame.issues) {
    warnings.push({ code: issue, message: ISSUE_MESSAGES[issue] });
  }
  return warnings;
}

function roundOutcome<T extends { confidence: number }>(outcome: T): T {
  return { ...outcome, confidence: round(outcome.confidence) };
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
