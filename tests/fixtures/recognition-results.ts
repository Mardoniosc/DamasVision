import { isPlayableSquare, SQUARE_COUNT } from '../../src/app/domain/board/board';
import { BoardRecognitionResult } from '../../src/app/domain/board/observation';
import { ObservedPiece } from '../../src/app/domain/board/piece';

/** Builds a well-formed recognition result from 64 cells (UNKNOWN squares get 0.3). */
export function recognitionResultFrom(
  cells: readonly ObservedPiece[],
  options: { timestamp?: number; frameId?: string } = {},
): BoardRecognitionResult {
  const confidenceBySquare = cells.map((piece) => (piece === 'UNKNOWN' ? 0.3 : 0.97));
  const squares = cells.flatMap((piece, squareIndex) =>
    isPlayableSquare(squareIndex)
      ? [{ squareIndex, piece, confidence: confidenceBySquare[squareIndex] ?? 0 }]
      : [],
  );
  const hasUnknown = cells.includes('UNKNOWN');
  if (cells.length !== SQUARE_COUNT) {
    throw new RangeError('expected 64 cells');
  }
  return {
    board: {
      cells,
      confidenceBySquare,
      timestamp: options.timestamp ?? 1,
      ...(options.frameId ? { sourceFrameId: options.frameId } : {}),
    },
    squares,
    status: hasUnknown ? 'UNCERTAIN' : 'SUCCESS',
    overallConfidence: squares.reduce((sum, s) => sum + s.confidence, 0) / squares.length,
    warnings: hasUnknown
      ? [
          {
            code: 'UNKNOWN_SQUARES',
            message: 'casas incertas',
            affectedSquares: squares.filter((s) => s.piece === 'UNKNOWN').map((s) => s.squareIndex),
          },
        ]
      : [],
    timestamp: options.timestamp ?? 1,
  };
}
