import { PlayerColor } from '../board/piece';

/**
 * Brazilian 64-square checkers: the values behind the adopted rule interpretations
 * (docs/engine/brazilian-checkers-rules.md). Rule *behavior* lives in domain/engine.
 */
export interface BrazilianRules {
  /** White moves first. */
  readonly firstPlayer: PlayerColor;
  readonly piecesPerSide: number;
  /** The same position (cells + player to move) for this many times → draw. */
  readonly repetitionsForDraw: number;
  /** Successive king-only plies, without capture or man move → draw. */
  readonly kingOnlyPliesForDraw: number;
  /** Short endings (2K v 1K, 2K+1M v 1K, 1K+2M v 1K): plies allowed before the draw. */
  readonly shortEndingPliesForDraw: number;
}

export const BRAZILIAN_RULES: BrazilianRules = {
  firstPlayer: 'WHITE',
  piecesPerSide: 12,
  repetitionsForDraw: 3,
  kingOnlyPliesForDraw: 20,
  shortEndingPliesForDraw: 10,
};

/** Row on which a man of `player` is promoted (White moves up, towards row 0). */
export function promotionRow(player: PlayerColor): number {
  return player === 'WHITE' ? 0 : 7;
}

/** Row step of a forward move for `player`. */
export function forwardStep(player: PlayerColor): -1 | 1 {
  return player === 'WHITE' ? -1 : 1;
}
