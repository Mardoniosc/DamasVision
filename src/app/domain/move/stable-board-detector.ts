import { SQUARE_COUNT } from '../board/board';
import { BoardObservation } from '../board/observation';
import {
  DEFAULT_INFERENCE_CONFIG,
  InferenceConfig,
  validateInferenceConfig,
} from './inference.config';
import { ObservationWindow } from './observation-window';

export type StabilityStatus = 'WAITING' | 'UNSTABLE' | 'STABLE';

export interface StabilityUpdate {
  readonly status: StabilityStatus;
  /**
   * STABLE: the consolidated observation — the stable cells, each square's lowest
   * confidence over the stable run, and the latest timestamp.
   */
  readonly observation?: BoardObservation;
  /** True only the first time this board becomes stable (E5-T07: no repeated events). */
  readonly isNew: boolean;
}

/**
 * Stable board detector (E5-T02). The board is stable when the latest
 * `stableObservationCount` observations in the window have identical cells (UNKNOWN
 * included: an occluded square must stay occluded to be stable) and span at least
 * `minStableMs`. Unstable observations are never forwarded, so they can never reach game
 * state. A stable board is reported as new once; it is new again only after a different
 * board was stable in between.
 */
export class StableBoardDetector {
  private readonly window: ObservationWindow<BoardObservation>;
  private lastStableKey: string | null = null;

  constructor(private readonly config: InferenceConfig = DEFAULT_INFERENCE_CONFIG) {
    validateInferenceConfig(config);
    this.window = new ObservationWindow(config.windowSize, config.maxAgeMs);
  }

  push(observation: BoardObservation): StabilityUpdate {
    if (observation.cells.length !== SQUARE_COUNT) {
      throw new RangeError(`expected ${SQUARE_COUNT} cells`);
    }
    if (!this.window.push(observation)) return { status: this.status(), isNew: false };

    const items = this.window.toArray();
    const run = this.trailingRun(items);
    if (run.length < this.config.stableObservationCount) {
      return {
        status: items.length < this.config.stableObservationCount ? 'WAITING' : 'UNSTABLE',
        isNew: false,
      };
    }
    const first = run[0] as BoardObservation;
    const last = run[run.length - 1] as BoardObservation;
    if (last.timestamp - first.timestamp < this.config.minStableMs) {
      return { status: 'WAITING', isNew: false };
    }
    const key = last.cells.join(',');
    const isNew = key !== this.lastStableKey;
    this.lastStableKey = key;
    return {
      status: 'STABLE',
      isNew,
      observation: {
        cells: [...last.cells],
        confidenceBySquare: last.cells.map((_, i) =>
          Math.min(...run.map((o) => o.confidenceBySquare[i] ?? 0)),
        ),
        timestamp: last.timestamp,
        ...(last.sourceFrameId ? { sourceFrameId: last.sourceFrameId } : {}),
      },
    };
  }

  /**
   * Forgets the window and the last stable board (after a commit, a correction or a
   * pause): the next stable board is new.
   */
  reset(): void {
    this.window.clear();
    this.lastStableKey = null;
  }

  /** Stale observations dropped. */
  get dropped(): number {
    return this.window.dropped;
  }

  private status(): StabilityStatus {
    return this.window.size < this.config.stableObservationCount ? 'WAITING' : 'UNSTABLE';
  }

  /** The newest observations whose cells equal the newest one's. */
  private trailingRun(items: readonly BoardObservation[]): BoardObservation[] {
    const newest = items[items.length - 1];
    if (!newest) return [];
    const run: BoardObservation[] = [];
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i] as BoardObservation;
      if (!item.cells.every((cell, square) => cell === newest.cells[square])) break;
      run.unshift(item);
    }
    return run;
  }
}
