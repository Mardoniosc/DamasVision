import {
  CapturedFrame,
  EMPTY_FRAME_SCHEDULER_STATS,
  FrameCaptureConfig,
  FrameProcessor,
  FrameSchedulerState,
  FrameSchedulerStats,
  releaseFrame,
} from './frame-capture.models';

export interface FrameSchedulerOptions {
  readonly config: FrameCaptureConfig;
  readonly captureFrame: () => Promise<CapturedFrame | null>;
  readonly processFrame: FrameProcessor;
  /** Monotonic clock in ms; must match the clock used for `CapturedFrame.capturedAt`. */
  readonly now?: () => number;
  readonly onStats?: (stats: FrameSchedulerStats) => void;
  readonly onError?: (error: unknown) => void;
}

/**
 * Periodically captures and processes frames with bounded concurrency.
 *
 * - Never queues: when `maxInFlight` frames are busy the tick is skipped, so the next
 *   frame processed is always freshly captured (prefer freshest frame, drop stale ones).
 * - Frames older than `maxFrameAgeMs`, or captured across a pause/stop, are dropped.
 * - Every frame obtained from the source is released exactly once, whatever happens.
 */
export class FrameScheduler {
  private stateValue: FrameSchedulerState = 'STOPPED';
  private statsValue: FrameSchedulerStats = EMPTY_FRAME_SCHEDULER_STATS;
  private timer: ReturnType<typeof setInterval> | null = null;
  private inFlight = 0;
  /** Incremented on pause/stop so frames captured before can be recognized as inactive. */
  private generation = 0;
  private readonly now: () => number;

  constructor(private readonly options: FrameSchedulerOptions) {
    validateConfig(options.config);
    this.now = options.now ?? (() => performance.now());
  }

  get state(): FrameSchedulerState {
    return this.stateValue;
  }

  get stats(): FrameSchedulerStats {
    return this.statsValue;
  }

  get framesInFlight(): number {
    return this.inFlight;
  }

  start(): void {
    if (this.stateValue !== 'STOPPED') {
      return;
    }
    this.run();
  }

  pause(): void {
    if (this.stateValue !== 'RUNNING') {
      return;
    }
    this.halt('PAUSED');
  }

  resume(): void {
    if (this.stateValue !== 'PAUSED') {
      return;
    }
    this.run();
  }

  stop(): void {
    if (this.stateValue === 'STOPPED') {
      return;
    }
    this.halt('STOPPED');
  }

  private run(): void {
    this.stateValue = 'RUNNING';
    this.tick();
    this.timer = setInterval(() => this.tick(), this.options.config.intervalMs);
  }

  private halt(state: FrameSchedulerState): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.generation++;
    this.stateValue = state;
  }

  private tick(): void {
    if (this.stateValue !== 'RUNNING') {
      return;
    }
    if (this.inFlight >= this.options.config.maxInFlight) {
      this.count('skippedBusy');
      return;
    }
    void this.cycle(this.generation);
  }

  private async cycle(generation: number): Promise<void> {
    this.inFlight++;
    let frame: CapturedFrame | null = null;
    try {
      frame = await this.options.captureFrame();
      if (!frame) {
        this.count('skippedNotReady');
        return;
      }
      this.count('captured');

      if (generation !== this.generation || this.stateValue !== 'RUNNING') {
        this.count('droppedInactive');
        return;
      }
      if (this.now() - frame.capturedAt > this.options.config.maxFrameAgeMs) {
        this.count('droppedStale');
        return;
      }

      await this.options.processFrame(frame);
      this.count('processed');
    } catch (error) {
      this.count('failed');
      this.options.onError?.(error);
    } finally {
      if (frame) {
        releaseFrame(frame);
      }
      this.inFlight--;
    }
  }

  private count(key: keyof FrameSchedulerStats): void {
    this.statsValue = { ...this.statsValue, [key]: this.statsValue[key] + 1 };
    this.options.onStats?.(this.statsValue);
  }
}

function validateConfig(config: FrameCaptureConfig): void {
  if (!Number.isFinite(config.intervalMs) || config.intervalMs <= 0) {
    throw new RangeError(`intervalMs must be a positive number, got ${config.intervalMs}`);
  }
  if (!Number.isInteger(config.maxInFlight) || config.maxInFlight < 1) {
    throw new RangeError(`maxInFlight must be an integer >= 1, got ${config.maxInFlight}`);
  }
  if (!Number.isFinite(config.maxFrameAgeMs) || config.maxFrameAgeMs <= 0) {
    throw new RangeError(`maxFrameAgeMs must be a positive number, got ${config.maxFrameAgeMs}`);
  }
}
