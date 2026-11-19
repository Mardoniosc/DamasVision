import {
  afterRenderEffect,
  Component,
  computed,
  ElementRef,
  input,
  viewChild,
} from '@angular/core';
import { createBoardGrid, squareRoi } from '../../domain/board/board-grid';
import { Size2D } from '../../domain/board/geometry';
import { ShapeThresholds } from '../../vision/recognition/classifier.config';
import { squareRegions } from '../../vision/recognition/square-regions';

/**
 * Normalized (rectified) board image with the canonical 8×8 grid and the regions the
 * classifier actually analyses (E2-T05, G3): on playable squares the piece disk and the
 * radius beyond which the corners are read as board background; on light squares the
 * inset region used as the local illumination reference.
 */
@Component({
  selector: 'app-normalized-board',
  template: `
    <div class="relative aspect-square w-full overflow-hidden rounded-lg bg-stone-900">
      <canvas
        #canvas
        class="absolute inset-0 h-full w-full"
        role="img"
        [attr.aria-label]="description()"
      ></canvas>
      <svg
        class="pointer-events-none absolute inset-0 h-full w-full"
        [attr.viewBox]="'0 0 ' + size().width + ' ' + size().height"
        aria-hidden="true"
      >
        @for (square of squares(); track square.index) {
          @if (square.isPlayable) {
            <rect
              [attr.x]="square.bounds.x"
              [attr.y]="square.bounds.y"
              [attr.width]="square.bounds.width"
              [attr.height]="square.bounds.height"
              fill="#22c55e"
              fill-opacity="0.12"
              data-region="cell"
            />
            <circle
              [attr.cx]="square.center.x"
              [attr.cy]="square.center.y"
              [attr.r]="square.regions.pieceRadius"
              fill="none"
              stroke="#22c55e"
              stroke-width="1.5"
              vector-effect="non-scaling-stroke"
              data-region="piece"
            />
            <circle
              [attr.cx]="square.center.x"
              [attr.cy]="square.center.y"
              [attr.r]="square.regions.backgroundRadius"
              fill="none"
              stroke="#22c55e"
              stroke-dasharray="4 3"
              stroke-width="1"
              vector-effect="non-scaling-stroke"
              data-region="background"
            />
          } @else {
            <rect
              [attr.x]="square.roi.x"
              [attr.y]="square.roi.y"
              [attr.width]="square.roi.width"
              [attr.height]="square.roi.height"
              fill="none"
              stroke="white"
              stroke-opacity="0.4"
              stroke-dasharray="2 4"
              stroke-width="1"
              vector-effect="non-scaling-stroke"
              data-region="light-reference"
            />
          }
        }
        @for (line of gridLines(); track $index) {
          <line
            [attr.x1]="line.x1"
            [attr.y1]="line.y1"
            [attr.x2]="line.x2"
            [attr.y2]="line.y2"
            stroke="white"
            stroke-opacity="0.8"
            stroke-width="1"
            vector-effect="non-scaling-stroke"
          />
        }
      </svg>
    </div>
  `,
})
export class NormalizedBoardComponent {
  readonly image = input<ImageBitmap | null>(null);
  readonly size = input.required<Size2D>();
  readonly roiInsetRatio = input.required<number>();
  readonly shape = input.required<ShapeThresholds>();

  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');

  protected readonly squares = computed(() =>
    createBoardGrid(this.size()).map((square) => ({
      ...square,
      roi: squareRoi(square, this.roiInsetRatio()),
      regions: squareRegions(square, this.shape()),
    })),
  );
  protected readonly gridLines = computed(() => {
    const { width, height } = this.size();
    return Array.from({ length: 9 }, (_, i) => [
      { x1: (width * i) / 8, y1: 0, x2: (width * i) / 8, y2: height },
      { x1: 0, y1: (height * i) / 8, x2: width, y2: (height * i) / 8 },
    ]).flat();
  });
  protected readonly description = computed(
    () =>
      `Tabuleiro normalizado de ${this.size().width} por ${this.size().height} pixels, com as 32 casas jogáveis e as regiões que o classificador analisa destacadas.`,
  );

  constructor() {
    // Runs after rendering; sizing the canvas here (not via a template binding) because
    // assigning width/height clears the canvas and would erase what was just drawn.
    afterRenderEffect(() => {
      const image = this.image();
      const { width, height } = this.size();
      const canvas = this.canvas().nativeElement;
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      const context = canvas.getContext('2d');
      if (!context) {
        return;
      }
      context.clearRect(0, 0, width, height);
      if (image) {
        context.drawImage(image, 0, 0, width, height);
      }
    });
  }
}
