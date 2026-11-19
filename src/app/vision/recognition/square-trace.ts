import { squareName } from '../../domain/board/board-notation';
import { ObservedPiece } from '../../domain/board/piece';
import { ClassifierConfig } from './classifier.config';
import {
  ColorDecision,
  OccupancyDecision,
  PieceTypeDecision,
  ReasonCode,
  SquareDecision,
  StageOutcome,
} from './stages/stage.models';

/**
 * Full, serializable account of how one square was classified (G3 diagnostics): the
 * regions and background used, every stage outcome, the key feature values and a
 * human-readable explanation built from the same numbers the stages used.
 */
export interface SquareTrace {
  readonly squareIndex: number;
  readonly piece: ObservedPiece;
  readonly confidence: number;
  readonly decision: SquareDecision;
  readonly reason: ReasonCode;
  readonly limitingStage: 'OCCUPANCY' | 'COLOR' | 'PIECE_TYPE';
  /** pt-BR explanation shown in the UI. */
  readonly explanation: string;
  readonly regions: {
    readonly centerX: number;
    readonly centerY: number;
    readonly size: number;
    readonly pieceRadius: number;
    readonly markRadius: number;
    readonly backgroundRadius: number;
    /** King-mark search capsule: from the center to (endX, endY), this radius. */
    readonly markSearch: { readonly endX: number; readonly endY: number; readonly radius: number };
  };
  readonly roi: {
    /** Corners (TL, TR, BR, BL) that look like the board. */
    readonly cornerMatches: readonly boolean[];
    readonly visibleCorners: number;
    /** visibleCorners / 4. */
    readonly quality: number;
  };
  readonly occupancy: StageOutcome<OccupancyDecision>;
  readonly color: StageOutcome<ColorDecision> | null;
  readonly pieceType: StageOutcome<PieceTypeDecision> | null;
  readonly features: TraceFeatures;
}

export interface TraceFeatures {
  readonly foregroundRatio: number;
  readonly shadowRatio: number;
  /** Foreground fraction of the disk's outer ring. */
  readonly ringForegroundRatio: number;
  readonly backgroundLuminance: number;
  readonly backgroundRelative: number;
  readonly lightReference: number;
  readonly pieceLuminance: number;
  readonly pieceLuminanceStd: number;
  readonly bodyLuminance: number;
  readonly markLuminance: number;
  /** Body / background luminance ratio (color evidence). */
  readonly contrastRatio: number;
  /** King-mark pixels found / expected mark area (king evidence; 0 when not searched). */
  readonly markCoverage: number;
  /** Where the mark pixels are, relative to the square center, in squares. */
  readonly markOffset: { readonly x: number; readonly y: number } | null;
  readonly backgroundColor: readonly number[];
  readonly bodyColor: readonly number[];
}

const PIECE_TEXT: Readonly<Record<ObservedPiece, string>> = {
  EMPTY: 'Vazia',
  WHITE: 'Branca',
  BLACK: 'Preta',
  WHITE_KING: 'Dama branca',
  BLACK_KING: 'Dama preta',
  UNKNOWN: 'Desconhecida',
};

const pct = (value: number): string => `${Math.round(value * 100)}%`;
const num = (value: number): string => value.toFixed(2);

/** Builds the explanation from the trace values and the thresholds actually used. */
export function explainSquare(
  trace: Omit<SquareTrace, 'explanation'>,
  config: ClassifierConfig,
): string {
  const { shape, color } = config;
  const f = trace.features;
  const name = squareName(trace.squareIndex);
  const head = `${name} — ${PIECE_TEXT[trace.piece]} (${pct(trace.confidence)})`;
  const occupancyText = `${pct(f.foregroundRatio)} da região central difere do fundo (vazia ≤ ${pct(shape.emptyMaxRatio)}, ocupada ≥ ${pct(shape.presenceMinRatio)})`;
  const shadowText =
    f.shadowRatio > 0.05 ? `; ${pct(f.shadowRatio)} descartado como sombra/reflexo` : '';
  const reasonText: Record<ReasonCode, string> = {
    EMPTY_BACKGROUND: `casa vazia: ${occupancyText}${shadowText}`,
    OCCUPIED_FOREGROUND: `ocupada: ${occupancyText}`,
    PARTIAL_OCCUPANCY: `ocupação parcial — peça fora do centro, mão ou cantos desalinhados: ${occupancyText}`,
    NOT_PIECE_SHAPED: `algo cobre o centro mas não tem forma de peça (só ${pct(f.ringForegroundRatio)} da borda do disco; peça ≥ ${pct(shape.occupancyRingMinRatio)}) — reflexo, dedo ou objeto`,
    ROI_OBSTRUCTED:
      'nenhum canto da casa se parece com o tabuleiro — região obstruída (mão, objeto) ou calibração deslocada',
    LOW_BOARD_CONTRAST: `a casa é escura demais (${num(f.backgroundRelative)} da luz local, mínimo ${num(color.darkSquareMinRelativeLuminance)}) para distinguir uma peça preta`,
    WHITE_CONTRAST: `peça mais clara que a casa: razão ${num(f.contrastRatio)} (branca ≥ ${num(color.whiteMinContrastRatio)})`,
    BLACK_CONTRAST: `peça mais escura que a casa: razão ${num(f.contrastRatio)} (preta ≤ ${num(color.blackMaxContrastRatio)})`,
    AMBIGUOUS_COLOR: `cor ambígua: razão peça/casa ${num(f.contrastRatio)} entre ${num(color.blackMaxContrastRatio)} e ${num(color.whiteMinContrastRatio)}`,
    INCONSISTENT_PIECE_COLOR: `a cor do "corpo" (RGB ${f.bodyColor.join(',')}) difere das demais peças claras — provável mão ou objeto, não uma peça`,
    NO_MARK: `sem marca colorida no topo da peça: ${pct(f.markCoverage)} da área de marca esperada (dama ≥ ${pct(color.kingMarkMinCoverage)})`,
    COLORED_MARK: `marca colorida de dama no topo da peça: ${pct(f.markCoverage)} da área esperada (≥ ${pct(color.kingMarkMinCoverage)})`,
    AMBIGUOUS_MARK: `marca de dama ambígua: ${pct(f.markCoverage)} da área esperada, perto do limite ${pct(color.kingMarkMinCoverage)}`,
  };
  const roiText =
    trace.roi.visibleCorners < 4 && trace.roi.visibleCorners > 0
      ? ` Fundo medido em ${trace.roi.visibleCorners} de 4 cantos.`
      : '';
  return `${head}: ${reasonText[trace.reason]}.${roiText}`;
}
