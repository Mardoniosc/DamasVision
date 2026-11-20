import { Piece } from '../../src/app/domain/board/piece';
import {
  midgamePosition,
  REAL_SET_BLUE_BOARD,
  RenderOptions,
  startingPosition,
} from './synthetic-board';

/**
 * Synthetic regression boards of the recognition metrics report (G3). They guard known
 * failure modes (lighting, noise, off-center pieces, shadows, tall pieces and kings); they
 * do not measure field accuracy. Shared with the vision service's parity tests (G3.1).
 */
export interface SyntheticScenario {
  readonly name: string;
  readonly position: () => Piece[];
  readonly options: RenderOptions;
}

export const SYNTHETIC_SCENARIOS: readonly SyntheticScenario[] = [
  { name: 'wood, ideal, start', position: startingPosition, options: {} },
  { name: 'wood, ideal, mid-game + kings', position: midgamePosition, options: {} },
  { name: 'wood, dim', position: midgamePosition, options: { brightness: 0.55 } },
  { name: 'wood, bright', position: midgamePosition, options: { brightness: 1.2 } },
  { name: 'wood, gradient', position: startingPosition, options: { gradient: [0.6, 1.15] } },
  { name: 'wood, noise', position: midgamePosition, options: { noise: 10, seed: 3 } },
  { name: 'wood, off-center', position: startingPosition, options: { jitter: 0.08, seed: 5 } },
  {
    name: 'wood, local shadow',
    position: midgamePosition,
    options: { shadow: { x: 300, y: 420, radius: 220, factor: 0.6 } },
  },
  { name: 'wood, tall + kings', position: midgamePosition, options: { pieceHeight: 0.3 } },
  { name: 'blue model, start', position: startingPosition, options: REAL_SET_BLUE_BOARD },
  { name: 'blue model, kings', position: midgamePosition, options: REAL_SET_BLUE_BOARD },
  {
    name: 'blue model, kings, dim + noise',
    position: midgamePosition,
    options: { ...REAL_SET_BLUE_BOARD, brightness: 0.6, noise: 8 },
  },
];
