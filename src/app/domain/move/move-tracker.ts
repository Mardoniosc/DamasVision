import { BoardObservation } from '../board/observation';
import { BoardState, PlayerColor } from '../board/piece';
import { CheckersEngine } from '../engine/checkers-engine';
import { DEFAULT_INFERENCE_CONFIG, InferenceConfig } from './inference.config';
import { inferMove, MoveInferenceResult } from './move-inference';
import { StabilityStatus, StableBoardDetector } from './stable-board-detector';

export interface TrackerUpdate {
  readonly stability: StabilityStatus;
  /** Present only when a new stable board was inferred against a new authoritative position. */
  readonly inference?: MoveInferenceResult;
}

/**
 * Observation → stable board → inference, once (E5-T07). Frames repeat the same board
 * many times; the tracker infers at most once per (authoritative position, player to
 * move, stable board). After a commit the authoritative board changes and the same
 * physical board now matches it (BOARD_UNCHANGED), so a repeated frame can never commit
 * the move twice. The tracker only proposes: committing belongs to the game-session
 * controller (E6).
 */
export class MoveTracker {
  private readonly detector: StableBoardDetector;
  private lastKey: string | null = null;

  constructor(
    private readonly engine: CheckersEngine,
    private readonly config: InferenceConfig = DEFAULT_INFERENCE_CONFIG,
  ) {
    this.detector = new StableBoardDetector(config);
  }

  observe(
    authoritative: BoardState,
    player: PlayerColor,
    observation: BoardObservation,
  ): TrackerUpdate {
    const update = this.detector.push(observation);
    if (update.status !== 'STABLE' || !update.observation) return { stability: update.status };

    const key = `${player}|${authoritative.cells.join(',')}|${update.observation.cells.join(',')}`;
    if (key === this.lastKey) return { stability: 'STABLE' };
    this.lastKey = key;
    return {
      stability: 'STABLE',
      inference: inferMove(authoritative, player, update.observation, this.engine, this.config),
    };
  }

  /** Starts over (pause/resume, recalibration, correction): the next stable board is inferred. */
  reset(): void {
    this.detector.reset();
    this.lastKey = null;
  }
}
