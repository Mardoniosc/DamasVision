import { DestroyRef, Directive, ElementRef, effect, inject, input, output } from '@angular/core';

/**
 * Binds a `MediaStream` to a `<video>` element and detaches it on destroy.
 * Presentation only: it never opens or stops streams (that belongs to core/camera).
 */
@Directive({
  selector: 'video[appMediaStream]',
})
export class MediaStreamDirective {
  readonly appMediaStream = input<MediaStream | null>(null);
  /** Emitted when playback cannot start (e.g. autoplay blocked). */
  readonly playbackFailed = output<void>();

  private readonly video = inject<ElementRef<HTMLVideoElement>>(ElementRef).nativeElement;

  constructor() {
    this.video.muted = true;
    this.video.playsInline = true;
    effect(() => this.attach(this.appMediaStream()));
    inject(DestroyRef).onDestroy(() => {
      this.video.srcObject = null;
    });
  }

  private attach(stream: MediaStream | null): void {
    if (this.video.srcObject === stream) {
      return;
    }
    this.video.srcObject = stream;
    if (stream) {
      void this.play();
    }
  }

  private async play(): Promise<void> {
    try {
      await this.video.play();
    } catch (error) {
      // AbortError = interrupted by a newer srcObject (device switch); not a failure.
      const aborted = error instanceof DOMException && error.name === 'AbortError';
      if (!aborted && this.video.srcObject !== null) {
        this.playbackFailed.emit();
      }
    }
  }
}
