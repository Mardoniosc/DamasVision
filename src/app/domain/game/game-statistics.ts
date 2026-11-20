import { GameSession } from './game-session';

/**
 * How a game was recorded (E8-T02 physical tests): moves inferred from the camera vs.
 * entered or confirmed by hand, and explicit adjustments. On a real board this is the
 * measured move-inference rate (spec §16 targets: simple moves ≥ 95 %, captures ≥ 90 %).
 */
export interface GameStatistics {
  readonly moves: number;
  readonly byCamera: number;
  readonly manual: number;
  readonly captures: number;
  readonly capturesByCamera: number;
  readonly promotions: number;
  readonly undos: number;
  readonly corrections: number;
  /** byCamera / moves (null without moves). */
  readonly cameraRate: number | null;
  readonly captureCameraRate: number | null;
}

export function gameStatistics(
  session: Pick<GameSession, 'moves' | 'adjustments'>,
): GameStatistics {
  const moves = session.moves;
  const captures = moves.filter((record) => record.move.capturedSquares.length > 0);
  const byCamera = moves.filter((record) => record.source === 'VISION').length;
  const capturesByCamera = captures.filter((record) => record.source === 'VISION').length;
  return {
    moves: moves.length,
    byCamera,
    manual: moves.length - byCamera,
    captures: captures.length,
    capturesByCamera,
    promotions: moves.filter((record) => record.move.promotion).length,
    undos: session.adjustments.filter((adjustment) => adjustment.kind === 'UNDO').length,
    corrections: session.adjustments.filter((a) => a.kind === 'POSITION_CORRECTION').length,
    cameraRate: moves.length > 0 ? byCamera / moves.length : null,
    captureCameraRate: captures.length > 0 ? capturesByCamera / captures.length : null,
  };
}
