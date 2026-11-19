import { InjectionToken } from '@angular/core';
import { DEFAULT_VISION_CONFIG } from '../../vision/vision.config';
import { FrameCaptureConfig, FrameSource } from './frame-capture.models';
import { VideoFrameSource } from './video-frame-source';

/** Experimental defaults (spec §7/§14); tune against physical tests. */
export const DEFAULT_FRAME_CAPTURE_CONFIG: FrameCaptureConfig = {
  intervalMs: DEFAULT_VISION_CONFIG.analysisIntervalMs,
  maxInFlight: 1,
  maxFrameAgeMs: 500,
};

export interface SnapshotOptions {
  /** Maximum wait for the video to deliver its first frame. */
  readonly timeoutMs: number;
  readonly pollIntervalMs: number;
}

export const DEFAULT_SNAPSHOT_OPTIONS: SnapshotOptions = { timeoutMs: 3000, pollIntervalMs: 50 };

export const FRAME_CAPTURE_CONFIG = new InjectionToken<FrameCaptureConfig>('FRAME_CAPTURE_CONFIG', {
  providedIn: 'root',
  factory: () => DEFAULT_FRAME_CAPTURE_CONFIG,
});

export type FrameSourceFactory = (stream: MediaStream) => FrameSource;

export const FRAME_SOURCE_FACTORY = new InjectionToken<FrameSourceFactory>('FRAME_SOURCE_FACTORY', {
  providedIn: 'root',
  factory: () => (stream: MediaStream) => new VideoFrameSource(stream),
});
