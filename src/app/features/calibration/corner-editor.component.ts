import { Component, computed, ElementRef, input, output, signal, viewChild } from '@angular/core';
import { ProjectedBoardOverlay } from '../../domain/board/board-grid';
import { CalibrationCorners, CORNER_NAMES, CornerName } from '../../domain/board/calibration';
import { Point2D, Size2D } from '../../domain/board/geometry';
import { MediaStreamDirective } from '../../shared/directives/media-stream.directive';
import { CORNER_LABELS } from './calibration-messages';

export interface CornerMove {
  readonly corner: CornerName;
  readonly point: Point2D;
}

export interface CornerNudge {
  readonly corner: CornerName;
  readonly dx: number;
  readonly dy: number;
}

/** Keyboard step in source pixels (Shift = coarse). */
const NUDGE_STEP = 1;
const NUDGE_STEP_COARSE = 10;
/** Handle radius relative to the image width. */
const HANDLE_RADIUS_RATIO = 0.018;

const ARROWS: Readonly<Record<string, readonly [number, number]>> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

/**
 * Live camera image with four draggable corner handles and the projected board grid.
 * Presentational: emits corner moves; the store owns the corners.
 */
@Component({
  selector: 'app-corner-editor',
  imports: [MediaStreamDirective],
  templateUrl: './corner-editor.component.html',
})
export class CornerEditorComponent {
  readonly stream = input<MediaStream | null>(null);
  readonly sourceSize = input<Size2D | null>(null);
  readonly corners = input<CalibrationCorners | null>(null);
  readonly overlay = input<ProjectedBoardOverlay | null>(null);
  readonly valid = input(false);
  readonly invalidCorners = input<readonly CornerName[]>([]);

  readonly sourceSizeChange = output<Size2D>();
  readonly cornerMove = output<CornerMove>();
  readonly cornerNudge = output<CornerNudge>();

  private readonly svg = viewChild<ElementRef<SVGSVGElement>>('overlaySvg');
  protected readonly dragging = signal<CornerName | null>(null);

  protected readonly viewBox = computed(() => {
    const size = this.sourceSize();
    return size ? `0 0 ${size.width} ${size.height}` : null;
  });
  protected readonly handleRadius = computed(
    () => (this.sourceSize()?.width ?? 0) * HANDLE_RADIUS_RATIO,
  );
  protected readonly polygonPoints = computed(() => {
    const corners = this.corners();
    return corners
      ? CORNER_NAMES.map((name) => `${corners[name].x},${corners[name].y}`).join(' ')
      : '';
  });
  protected readonly handles = computed(() => {
    const corners = this.corners();
    const invalid = new Set(this.invalidCorners());
    return corners
      ? CORNER_NAMES.map((name) => ({
          name,
          point: corners[name],
          invalid: invalid.has(name),
          label: `${CORNER_LABELS[name]}: x ${Math.round(corners[name].x)}, y ${Math.round(corners[name].y)}. Arraste ou use as setas.`,
        }))
      : [];
  });
  protected readonly labelFontSize = computed(() => (this.sourceSize()?.width ?? 0) * 0.022);

  protected onVideoSize(event: Event): void {
    const video = event.target as HTMLVideoElement;
    if (video.videoWidth > 0 && video.videoHeight > 0) {
      this.sourceSizeChange.emit({ width: video.videoWidth, height: video.videoHeight });
    }
  }

  protected startDrag(event: PointerEvent, corner: CornerName): void {
    event.preventDefault();
    (event.target as Element).setPointerCapture?.(event.pointerId);
    this.dragging.set(corner);
  }

  protected drag(event: PointerEvent): void {
    const corner = this.dragging();
    if (!corner) {
      return;
    }
    const point = this.toSourcePoint(event);
    if (point) {
      this.cornerMove.emit({ corner, point });
    }
  }

  protected endDrag(): void {
    this.dragging.set(null);
  }

  protected onKeydown(event: KeyboardEvent, corner: CornerName): void {
    const direction = ARROWS[event.key];
    if (!direction) {
      return;
    }
    event.preventDefault();
    const step = event.shiftKey ? NUDGE_STEP_COARSE : NUDGE_STEP;
    this.cornerNudge.emit({ corner, dx: direction[0] * step, dy: direction[1] * step });
  }

  /** Client (screen) coordinates → source image pixels, honouring the letterboxing. */
  private toSourcePoint(event: PointerEvent): Point2D | null {
    const svg = this.svg()?.nativeElement;
    const matrix = svg?.getScreenCTM();
    if (!matrix) {
      return null;
    }
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    return { x: point.x, y: point.y };
  }
}
