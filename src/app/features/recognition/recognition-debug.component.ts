import {
  afterRenderEffect,
  Component,
  computed,
  ElementRef,
  input,
  signal,
  viewChild,
  viewChildren,
} from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { squareName } from '../../domain/board/board-notation';
import { ClassifierConfig } from '../../vision/recognition/classifier.config';
import { FrameAssessment } from '../../vision/recognition/recognize-board';
import { SquareTrace } from '../../vision/recognition/square-trace';
import { StableSquare } from '../../vision/recognition/temporal/observation-stabilizer';

type SquareState = 'EMPTY' | 'PIECE' | 'WARN' | 'UNKNOWN' | 'OBSTRUCTED';

const STATE_COLORS: Readonly<Record<SquareState, string>> = {
  EMPTY: '#22c55e',
  PIECE: '#3b82f6',
  WARN: '#f59e0b',
  UNKNOWN: '#ef4444',
  OBSTRUCTED: '#a8a29e',
};

const STATE_LABELS: Readonly<Record<SquareState, string>> = {
  EMPTY: 'vazia',
  PIECE: 'peça',
  WARN: 'baixa confiança',
  UNKNOWN: 'desconhecida',
  OBSTRUCTED: 'ROI inválido / obstruído',
};

const SHORT: Readonly<Record<string, string>> = {
  EMPTY: '·',
  WHITE: 'B',
  BLACK: 'P',
  WHITE_KING: 'DB',
  BLACK_KING: 'DP',
  UNKNOWN: '?',
};

/** Temporal votes, spelled out. */
const VOTE_NAMES: Readonly<Record<string, string>> = {
  EMPTY: 'vazia',
  WHITE: 'branca',
  BLACK: 'preta',
  WHITE_KING: 'dama branca',
  BLACK_KING: 'dama preta',
  UNKNOWN: '?',
};

/** Corner positions (TL, TR, BR, BL) relative to the center, in units of half a square. */
const CORNER_OFFSETS: readonly (readonly [number, number])[] = [
  [-0.8, -0.8],
  [0.8, -0.8],
  [0.8, 0.8],
  [-0.8, 0.8],
];

/** Crop scale of the inspector. */
const CROP_PX = 160;

function stateOf(trace: SquareTrace): SquareState {
  if (trace.reason === 'ROI_OBSTRUCTED') return 'OBSTRUCTED';
  if (trace.piece === 'UNKNOWN') return 'UNKNOWN';
  if (trace.decision === 'WARN') return 'WARN';
  return trace.piece === 'EMPTY' ? 'EMPTY' : 'PIECE';
}

/**
 * Diagnostic view (G3): the rectified board with the exact regions the classifier used,
 * the state of every square, and an inspector to read — and compare — how any square was
 * classified. Presentational: everything shown comes from the worker's traces.
 */
@Component({
  selector: 'app-recognition-debug',
  imports: [DecimalPipe],
  templateUrl: './recognition-debug.component.html',
})
export class RecognitionDebugComponent {
  readonly image = input<ImageBitmap | null>(null);
  readonly traces = input<readonly SquareTrace[]>([]);
  readonly frame = input<FrameAssessment | null>(null);
  readonly stable = input<readonly StableSquare[]>([]);
  readonly config = input.required<ClassifierConfig>();
  /** Foreground mask of the same image (local vision service, G3.1); null otherwise. */
  readonly mask = input<ImageBitmap | null>(null);
  /** Which recognizer produced the traces (G3.1). */
  readonly provider = input<'browser' | 'local-service'>('browser');

  protected readonly selected = signal<readonly number[]>([]);
  protected readonly legend = (Object.keys(STATE_COLORS) as SquareState[]).map((state) => ({
    color: STATE_COLORS[state],
    label: STATE_LABELS[state],
  }));
  protected readonly cornerOffsets = CORNER_OFFSETS;
  protected readonly cropSize = CROP_PX;

  private readonly canvas = viewChild<ElementRef<HTMLCanvasElement>>('board');
  private readonly crops = viewChildren<ElementRef<HTMLCanvasElement>>('crop');
  private readonly maskCrops = viewChildren<ElementRef<HTMLCanvasElement>>('maskCrop');

  protected readonly size = computed(() => {
    const image = this.image();
    return image ? { width: image.width, height: image.height } : { width: 800, height: 800 };
  });
  protected readonly squares = computed(() =>
    this.traces().map((trace) => {
      const state = stateOf(trace);
      return {
        trace,
        state,
        color: STATE_COLORS[state],
        label: `${SHORT[trace.piece] ?? '?'} ${Math.round(trace.confidence * 100)}`,
        name: squareName(trace.squareIndex),
      };
    }),
  );
  protected readonly inspected = computed(() => {
    const stable = new Map(this.stable().map((s) => [s.squareIndex, s]));
    const traces = new Map(this.traces().map((t) => [t.squareIndex, t]));
    return this.selected().flatMap((index) => {
      const trace = traces.get(index);
      return trace ? [{ trace, name: squareName(index), stable: stable.get(index) ?? null }] : [];
    });
  });
  protected readonly counts = computed(() => {
    const counts: Record<SquareState, number> = {
      EMPTY: 0,
      PIECE: 0,
      WARN: 0,
      UNKNOWN: 0,
      OBSTRUCTED: 0,
    };
    for (const square of this.squares()) counts[square.state]++;
    return counts;
  });

  constructor() {
    afterRenderEffect(() => {
      const image = this.image();
      const canvas = this.canvas()?.nativeElement;
      if (!canvas) return;
      const { width, height } = this.size();
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      const context = canvas.getContext('2d');
      if (!context) return;
      context.clearRect(0, 0, width, height);
      if (image) context.drawImage(image, 0, 0);
    });
    afterRenderEffect(() => this.drawCrops(this.maskCrops(), this.mask()));
    afterRenderEffect(() => {
      const image = this.image();
      const inspected = this.inspected();
      this.crops().forEach((ref, i) => {
        const canvas = ref.nativeElement;
        const trace = inspected[i]?.trace;
        const context = canvas.getContext('2d');
        if (!context || !trace) return;
        canvas.width = CROP_PX;
        canvas.height = CROP_PX;
        context.clearRect(0, 0, CROP_PX, CROP_PX);
        if (!image) return;
        const { centerX, centerY, size } = trace.regions;
        context.drawImage(
          image,
          centerX - size / 2,
          centerY - size / 2,
          size,
          size,
          0,
          0,
          CROP_PX,
          CROP_PX,
        );
      });
    });
  }

  /** Draws each inspected square's region of `source` (the mask) into its crop canvas. */
  private drawCrops(
    canvases: readonly ElementRef<HTMLCanvasElement>[],
    source: ImageBitmap | null,
  ): void {
    const inspected = this.inspected();
    canvases.forEach((ref, i) => {
      const canvas = ref.nativeElement;
      const trace = inspected[i]?.trace;
      const context = canvas.getContext('2d');
      if (!context || !trace) return;
      canvas.width = CROP_PX;
      canvas.height = CROP_PX;
      context.clearRect(0, 0, CROP_PX, CROP_PX);
      if (!source) return;
      const { centerX, centerY, size } = trace.regions;
      context.imageSmoothingEnabled = false;
      context.drawImage(
        source,
        centerX - size / 2,
        centerY - size / 2,
        size,
        size,
        0,
        0,
        CROP_PX,
        CROP_PX,
      );
    });
  }

  /** Click selects a square; Shift/Ctrl + click adds a second one to compare. */
  protected select(index: number, event: Event): void {
    const { shiftKey, ctrlKey, metaKey } = event as MouseEvent;
    const compare = shiftKey || ctrlKey || metaKey;
    const current = this.selected();
    if (current.includes(index)) {
      this.selected.set(current.filter((i) => i !== index));
    } else {
      this.selected.set(compare ? [...current.slice(-1), index] : [index]);
    }
  }

  protected isSelected(index: number): boolean {
    return this.selected().includes(index);
  }

  /** Crop overlay geometry for an inspected square, in crop pixels. */
  protected cropGeometry(trace: SquareTrace) {
    const scale = CROP_PX / trace.regions.size;
    return {
      center: CROP_PX / 2,
      piece: trace.regions.pieceRadius * scale,
      mark: trace.regions.markRadius * scale,
      background: trace.regions.backgroundRadius * scale,
    };
  }

  protected votesText(stable: StableSquare | null): string {
    if (!stable) return '—';
    const votes = Object.entries(stable.votes).map(
      ([piece, count]) => `${VOTE_NAMES[piece] ?? piece} ×${count}`,
    );
    return `${stable.decision} · ${votes.join(', ') || 'sem quadros'}`;
  }
}
