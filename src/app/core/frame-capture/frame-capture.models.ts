/**
 * A single captured camera frame. The bitmap is a GPU/CPU resource and must be released
 * with {@link releaseFrame} (closing a bitmap already transferred to a worker is a no-op).
 */
export interface CapturedFrame {
  readonly frameId: string;
  /** Capture time on the monotonic clock (`performance.now()`), in milliseconds. */
  readonly capturedAt: number;
  readonly width: number;
  readonly height: number;
  readonly bitmap: ImageBitmap;
}

export function releaseFrame(frame: CapturedFrame): void {
  frame.bitmap.close();
}

/** Produces frames on demand from a live stream. */
export interface FrameSource {
  /** Prepares the source (e.g. starts video playback). May reject. */
  start(): Promise<void>;
  /** Returns the freshest frame, or `null` when no frame is available yet. */
  capture(): Promise<CapturedFrame | null>;
  /** Releases every resource held by the source. Idempotent. */
  dispose(): void;
}

/** Consumes a frame. The scheduler releases the frame after the returned promise settles. */
export type FrameProcessor = (frame: CapturedFrame) => Promise<void>;

export interface FrameCaptureConfig {
  /** Time between capture attempts. Spec §7: 150–250 ms (experimental). */
  readonly intervalMs: number;
  /** Maximum frames being captured/processed at once. Spec §9: one by default. */
  readonly maxInFlight: number;
  /** Frames older than this when ready for processing are dropped instead of processed. */
  readonly maxFrameAgeMs: number;
}

export type FrameSchedulerState = 'STOPPED' | 'RUNNING' | 'PAUSED';

export interface FrameSchedulerStats {
  /** Frames obtained from the source. */
  readonly captured: number;
  /** Frames handed to the processor that completed successfully. */
  readonly processed: number;
  /** Ticks skipped because `maxInFlight` frames were still in flight (backpressure). */
  readonly skippedBusy: number;
  /** Ticks where the source had no frame yet (e.g. video still loading). */
  readonly skippedNotReady: number;
  /** Frames dropped because they exceeded `maxFrameAgeMs`. */
  readonly droppedStale: number;
  /** Frames dropped because the scheduler was paused or stopped while they were captured. */
  readonly droppedInactive: number;
  /** Captures or processing runs that threw. */
  readonly failed: number;
}

export const EMPTY_FRAME_SCHEDULER_STATS: FrameSchedulerStats = {
  captured: 0,
  processed: 0,
  skippedBusy: 0,
  skippedNotReady: 0,
  droppedStale: 0,
  droppedInactive: 0,
  failed: 0,
};
