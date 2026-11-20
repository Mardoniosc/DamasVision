import { BoardState, Piece, PlayerColor } from '../../../src/app/domain/board/piece';
import { initialBoard } from '../../../src/app/domain/engine/board-state';
import { BrazilianCheckersEngine } from '../../../src/app/domain/engine/checkers-engine';

const engine = new BrazilianCheckersEngine();

function after(board: BoardState, player: PlayerColor, id: string): BoardState {
  const move = engine.getLegalMoves(board, player).find((m) => m.id === id);
  if (!move) throw new Error(`${id} is not legal`);
  return engine.applyMove(board, move);
}

const opening = initialBoard();
const first = after(opening, 'WHITE', 'c3-d4');
const second = after(first, 'BLACK', 'f6-e5');

/** The moves the camera video shows, in order. */
export const VIDEO_MOVES = ['c3-d4', 'f6-e5'] as const;

/** The opening long enough to calibrate, confirm and start; then two moves. */
export const MOVE_VIDEO_SEGMENTS: readonly { position: readonly Piece[]; seconds: number }[] = [
  { position: opening.cells, seconds: 30 },
  { position: first.cells, seconds: 20 },
  { position: second.cells, seconds: 60 },
];
