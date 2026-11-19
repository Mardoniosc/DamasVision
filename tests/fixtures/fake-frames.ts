import { CapturedFrame, FrameSource } from '../../src/app/core/frame-capture/frame-capture.models';

export interface FakeBitmap {
  readonly width: number;
  readonly height: number;
  closed: boolean;
  close(): void;
}

export function fakeBitmap(width = 640, height = 480): FakeBitmap {
  return {
    width,
    height,
    closed: false,
    close() {
      this.closed = true;
    },
  };
}

export function fakeFrame(
  frameId: string,
  capturedAt: number,
): CapturedFrame & { bitmap: FakeBitmap } {
  const bitmap = fakeBitmap();
  return {
    frameId,
    capturedAt,
    width: bitmap.width,
    height: bitmap.height,
    // FakeBitmap implements the part of ImageBitmap the app uses (width/height/close).
    bitmap: bitmap as FakeBitmap & ImageBitmap,
  };
}

/** Frame source whose frames are stamped with `Date.now()` (driven by fake timers). */
export class FakeFrameSource implements FrameSource {
  readonly frames: (CapturedFrame & { bitmap: FakeBitmap })[] = [];
  started = false;
  disposed = false;
  startError: unknown = null;
  ready = true;
  /** Number of capture() calls, including those returning null. */
  captureCalls = 0;

  async start(): Promise<void> {
    if (this.startError) {
      throw this.startError;
    }
    this.started = true;
  }

  async capture(): Promise<CapturedFrame | null> {
    this.captureCalls++;
    if (!this.ready || this.disposed) {
      return null;
    }
    const frame = fakeFrame(`frame-${this.frames.length + 1}`, Date.now());
    this.frames.push(frame);
    return frame;
  }

  dispose(): void {
    this.disposed = true;
  }

  unreleasedFrames(): CapturedFrame[] {
    return this.frames.filter((frame) => !frame.bitmap.closed);
  }
}
