import { PlayerColor } from '../board/piece';

/** Why a game ended (docs/engine/brazilian-checkers-rules.md, "End of the game"). */
export type GameResultReason =
  | 'NO_PIECES'
  | 'NO_LEGAL_MOVES'
  | 'THREEFOLD_REPETITION'
  | 'TWENTY_KING_MOVES'
  | 'ENDGAME_FIVE_MOVES'
  /** Ended by the players from the UI (E6). */
  | 'AGREEMENT'
  | 'RESIGNATION';

/** Spec §5 `GameResult`; `reason` uses the codes above. */
export interface GameResult {
  readonly status: 'WIN' | 'DRAW';
  readonly winner?: PlayerColor;
  readonly reason: GameResultReason;
}

export function opponentOf(player: PlayerColor): PlayerColor {
  return player === 'WHITE' ? 'BLACK' : 'WHITE';
}
