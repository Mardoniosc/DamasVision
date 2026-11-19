import { Component, computed, input } from '@angular/core';
import { Size2D } from '../../domain/board/geometry';
import { MediaStreamDirective } from '../../shared/directives/media-stream.directive';
import { RecognitionMarker } from './recognition.store';

/** Marker radius relative to the image width. */
const MARKER_RADIUS_RATIO = 0.012;

/**
 * Live camera image with the recognition result drawn on each playable square
 * (E3-T08 overlay): white/black discs, a gold ring for kings, "?" for UNKNOWN,
 * a dashed outline when the confidence is below the acceptable band.
 */
@Component({
  selector: 'app-recognition-preview',
  imports: [MediaStreamDirective],
  template: `
    <div class="relative aspect-video overflow-hidden rounded-lg bg-stone-900">
      @if (stream(); as mediaStream) {
        <video
          [appMediaStream]="mediaStream"
          class="absolute inset-0 h-full w-full object-contain"
          aria-label="Imagem da câmera com o reconhecimento sobreposto"
          autoplay
          muted
          playsinline
        ></video>
      }
      @if (viewBox(); as box) {
        <svg
          class="pointer-events-none absolute inset-0 h-full w-full"
          [attr.viewBox]="box"
          preserveAspectRatio="xMidYMid meet"
          aria-hidden="true"
          data-testid="recognition-overlay"
        >
          @for (marker of markers(); track marker.index) {
            @switch (marker.piece) {
              @case ('EMPTY') {
                <circle
                  [attr.cx]="marker.x"
                  [attr.cy]="marker.y"
                  [attr.r]="radius() * 0.35"
                  fill="#22c55e"
                  fill-opacity="0.7"
                />
              }
              @case ('UNKNOWN') {
                <circle
                  [attr.cx]="marker.x"
                  [attr.cy]="marker.y"
                  [attr.r]="radius()"
                  fill="#f59e0b"
                  fill-opacity="0.85"
                />
                <text
                  [attr.x]="marker.x"
                  [attr.y]="marker.y"
                  text-anchor="middle"
                  dominant-baseline="central"
                  [attr.font-size]="radius() * 1.4"
                  font-weight="700"
                  fill="black"
                >
                  ?
                </text>
              }
              @default {
                <circle
                  [attr.cx]="marker.x"
                  [attr.cy]="marker.y"
                  [attr.r]="radius()"
                  [attr.fill]="isWhite(marker) ? '#fafaf9' : '#1c1917'"
                  [attr.stroke]="
                    isKing(marker)
                      ? '#f59e0b'
                      : marker.confidence < lowConfidenceBelow()
                        ? '#f59e0b'
                        : '#22c55e'
                  "
                  [attr.stroke-dasharray]="marker.confidence < lowConfidenceBelow() ? '3 2' : null"
                  stroke-width="3"
                  vector-effect="non-scaling-stroke"
                />
              }
            }
          }
        </svg>
      }
    </div>
  `,
})
export class RecognitionPreviewComponent {
  readonly stream = input<MediaStream | null>(null);
  readonly frameSize = input<Size2D | null>(null);
  readonly markers = input<readonly RecognitionMarker[]>([]);
  readonly lowConfidenceBelow = input(0.8);

  protected readonly viewBox = computed(() => {
    const size = this.frameSize();
    return size ? `0 0 ${size.width} ${size.height}` : null;
  });
  protected readonly radius = computed(() => (this.frameSize()?.width ?? 0) * MARKER_RADIUS_RATIO);

  protected isWhite(marker: RecognitionMarker): boolean {
    return marker.piece === 'WHITE' || marker.piece === 'WHITE_KING';
  }

  protected isKing(marker: RecognitionMarker): boolean {
    return marker.piece === 'WHITE_KING' || marker.piece === 'BLACK_KING';
  }
}
