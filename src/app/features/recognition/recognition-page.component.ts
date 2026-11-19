import { Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CameraService } from '../../core/camera/camera.service';
import { VISION_CONFIG, VisionWorkerClient } from '../../core/workers/vision-worker.client';
import { Piece } from '../../domain/board/piece';
import {
  BoardViewComponent,
  squareName,
} from '../../shared/components/board-view/board-view.component';
import { downloadJson } from '../../shared/utilities/file-export';
import {
  SAMPLE_CONDITION_LABELS,
  SAMPLE_CONDITIONS,
  SampleCondition,
  sampleFileName,
} from './labeled-sample';
import { RecognitionPreviewComponent } from './recognition-preview.component';
import { RecognitionDebugComponent } from './recognition-debug.component';
import { resolveClassifierConfig } from '../../vision/recognition/classifier.config';
import { StableSquare } from '../../vision/recognition/temporal/observation-stabilizer';
import { RecognitionStore } from './recognition.store';

interface PieceOption {
  readonly piece: Piece;
  readonly label: string;
}

type ExportState =
  | { readonly status: 'IDLE' }
  | { readonly status: 'WORKING' }
  | { readonly status: 'DONE' }
  | { readonly status: 'ERROR'; readonly message: string };

function stableText(square: StableSquare): string {
  const votes = Object.entries(square.votes)
    .map(([piece, count]) => `${PIECE_NAMES[piece as keyof typeof PIECE_NAMES]} ${count}`)
    .join(', ');
  const verdict =
    square.decision === 'MANUAL'
      ? 'sem consenso — corrija manualmente'
      : square.decision === 'RETRY'
        ? 'aguardando mais quadros'
        : 'estável';
  return `${verdict} (${votes || 'sem quadros'})`;
}

const PIECE_NAMES = {
  EMPTY: 'vazia',
  WHITE: 'branca',
  BLACK: 'preta',
  WHITE_KING: 'dama branca',
  BLACK_KING: 'dama preta',
  UNKNOWN: '?',
} as const;

const STATUS_LABELS = {
  SUCCESS: 'Leitura confiável',
  UNCERTAIN: 'Leitura com incertezas',
  ERROR: 'Erro de leitura',
} as const;

/**
 * Recognition step (E3): live piece recognition over the calibrated board, with
 * confidence/UNKNOWN display and manual correction. The vision worker is scoped to
 * this route; the camera is opened on entry and released on exit.
 */
@Component({
  selector: 'app-recognition-page',
  imports: [BoardViewComponent, RecognitionDebugComponent, RecognitionPreviewComponent, RouterLink],
  providers: [RecognitionStore, VisionWorkerClient],
  templateUrl: './recognition-page.component.html',
})
export class RecognitionPageComponent {
  protected readonly store = inject(RecognitionStore);
  protected readonly camera = inject(CameraService);
  private readonly visionConfig = inject(VISION_CONFIG);
  protected readonly acceptable = this.visionConfig.confidenceThresholds.acceptable;
  /** Thresholds the worker classifies with, shown next to each measured feature. */
  protected readonly classifierConfig = resolveClassifierConfig(this.visionConfig);

  protected readonly pieceOptions: readonly PieceOption[] = [
    { piece: 'EMPTY', label: 'Vazia' },
    { piece: 'WHITE', label: 'Branca' },
    { piece: 'BLACK', label: 'Preta' },
    { piece: 'WHITE_KING', label: 'Dama branca' },
    { piece: 'BLACK_KING', label: 'Dama preta' },
  ];

  protected readonly statusLabel = computed(() => {
    const status = this.store.shown()?.status;
    return status ? STATUS_LABELS[status] : 'Aguardando a primeira leitura…';
  });
  protected readonly confidencePercent = computed(() => {
    const value = this.store.shown()?.overallConfidence;
    return value === undefined ? null : Math.round(value * 100);
  });
  protected readonly selectedName = computed(() => {
    const index = this.store.selected();
    return index === null ? null : squareName(index);
  });
  protected readonly selectedPiece = computed(() => {
    const index = this.store.selected();
    return index === null ? null : (this.store.cells()?.[index] ?? null);
  });
  /** Explanation of every square: last frame's trace + temporal consolidation. */
  protected readonly notes = computed(() => {
    const stable = new Map(this.store.stableSquares().map((s) => [s.squareIndex, s]));
    return new Map(
      this.store.traces().map((trace) => {
        const square = stable.get(trace.squareIndex);
        const temporal = square ? ` Estabilização: ${stableText(square)}.` : '';
        return [trace.squareIndex, trace.explanation + temporal];
      }),
    );
  });
  protected readonly exportState = signal<ExportState>({ status: 'IDLE' });
  /** Dataset metadata for the exported sample (G3). */
  protected readonly conditionOptions = SAMPLE_CONDITIONS.map((condition) => ({
    condition,
    label: SAMPLE_CONDITION_LABELS[condition],
  }));
  protected readonly sampleConditions = signal<readonly SampleCondition[]>([]);
  protected readonly sampleDescription = signal('');

  protected toggleCondition(condition: SampleCondition, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.sampleConditions.update((current) =>
      checked
        ? [...current.filter((c) => c !== condition), condition]
        : current.filter((c) => c !== condition),
    );
  }

  protected setDescription(event: Event): void {
    this.sampleDescription.set((event.target as HTMLTextAreaElement).value);
  }

  protected readonly metricsPercent = computed(() => {
    const metrics = this.store.metrics();
    return metrics ? Math.round((metrics.matched / metrics.total) * 100) : null;
  });

  protected toggleDebug(event: Event): void {
    this.store.setDebug((event.target as HTMLInputElement).checked);
  }

  protected async exportSample(): Promise<void> {
    this.exportState.set({ status: 'WORKING' });
    try {
      const sample = await this.store.buildLabeledSample({
        description: this.sampleDescription(),
        conditions: this.sampleConditions(),
      });
      downloadJson(sampleFileName(sample.createdAt), sample);
      this.exportState.set({ status: 'DONE' });
    } catch (error) {
      this.exportState.set({
        status: 'ERROR',
        message: error instanceof Error ? error.message : 'Não foi possível exportar a amostra.',
      });
    }
  }

  constructor() {
    void this.store.start();
    inject(DestroyRef).onDestroy(() => this.camera.stop());
  }
}
