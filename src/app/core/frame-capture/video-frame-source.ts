import { CapturedFrame, FrameSource } from './frame-capture.models';

/** `HTMLMediaElement.HAVE_CURRENT_DATA`: data for the current playback position is available. */
const HAVE_CURRENT_DATA = 2;

export interface VideoFrameSourceDependencies {
  readonly createVideoElement: () => HTMLVideoElement;
  readonly createBitmap: (video: HTMLVideoElement) => Promise<ImageBitmap>;
  readonly now: () => number;
}

const DEFAULT_DEPENDENCIES: VideoFrameSourceDependencies = {
  createVideoElement: () => document.createElement('video'),
  createBitmap: (video) => createImageBitmap(video),
  now: () => performance.now(),
};

/**
 * Captures frames from a `MediaStream` through a private, detached `<video>` element,
 * so capture never depends on the preview element rendered by the UI.
 */
export class VideoFrameSource implements FrameSource {
  private readonly video: HTMLVideoElement;
  private sequence = 0;
  private disposed = false;

  constructor(
    stream: MediaStream,
    private readonly dependencies: VideoFrameSourceDependencies = DEFAULT_DEPENDENCIES,
  ) {
    this.video = dependencies.createVideoElement();
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.srcObject = stream;
  }

  async start(): Promise<void> {
    await this.video.play();
  }

  async capture(): Promise<CapturedFrame | null> {
    const { video } = this;
    if (
      this.disposed ||
      video.readyState < HAVE_CURRENT_DATA ||
      video.videoWidth === 0 ||
      video.videoHeight === 0
    ) {
      return null;
    }

    const capturedAt = this.dependencies.now();
    const bitmap = await this.dependencies.createBitmap(video);
    if (this.disposed) {
      bitmap.close();
      return null;
    }

    this.sequence++;
    return {
      frameId: `frame-${this.sequence}`,
      capturedAt,
      width: bitmap.width,
      height: bitmap.height,
      bitmap,
    };
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.video.pause();
    this.video.srcObject = null;
  }
}
