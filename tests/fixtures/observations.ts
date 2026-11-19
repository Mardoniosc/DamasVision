import { squareFromName } from '../../src/app/domain/board/board-notation';
import { BoardObservation } from '../../src/app/domain/board/observation';
import { BoardState, ObservedPiece } from '../../src/app/domain/board/piece';

/**
 * Synthetic observations for stabilization and inference tests (E5): what the camera
 * would report for a board, optionally with some squares edited (UNKNOWN for occlusion,
 * a misread piece, a captured piece not yet removed) and per-square confidences.
 */
export function observe(
  board: BoardState,
  options: {
    readonly timestamp?: number;
    readonly edits?: Readonly<Record<string, ObservedPiece>>;
    readonly confidence?: number;
    readonly confidenceAt?: Readonly<Record<string, number>>;
  } = {},
): BoardObservation {
  const cells: ObservedPiece[] = [...board.cells];
  const confidence = cells.map(() => options.confidence ?? 0.95);
  for (const [name, piece] of Object.entries(options.edits ?? {})) {
    cells[squareFromName(name)] = piece;
  }
  for (const [name, value] of Object.entries(options.confidenceAt ?? {})) {
    confidence[squareFromName(name)] = value;
  }
  return { cells, confidenceBySquare: confidence, timestamp: options.timestamp ?? 0 };
}

/** The same observation repeated every `intervalMs` from `start` (a still board). */
export function frames(
  observation: BoardObservation,
  count: number,
  start: number,
  intervalMs = 200,
): BoardObservation[] {
  return Array.from({ length: count }, (_, i) => ({
    ...observation,
    timestamp: start + i * intervalMs,
  }));
}
