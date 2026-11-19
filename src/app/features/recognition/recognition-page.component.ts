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
import { SquareReason } from '../../core/workers/vision-worker.protocol';
import { sampleFileName } from './labeled-sample';
import { RecognitionPreviewComponent } from './recognition-preview.component';
import { RecognitionStore } from './recognition.store';

interface PieceOption {
  readonly piece: Piece;
  readonly label: string;
}

const REASON_LABELS: Readonly<Record<SquareReason, string | null>> = {
  OCCLUSION: 'algo cobre a casa ou os cantos estão desalinhados',
  BOARD_CONTRAST: 'casa escura demais para distinguir peça preta',
  PRESENCE: 'ocupação ambígua: peça fora do centro, sombra ou cantos desalinhados',
  COLOR: 'cor da peça ambígua',
  KING: 'marca de dama ambígua',
  NONE: null,
};

type ExportState =
  | { readonly status: 'IDLE' }
  | { readonly status: 'WORKING' }
  | { readonly status: 'DONE' }
  | { readonly status: 'ERROR'; readonly message: string };

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
  imports: [BoardViewComponent, RecognitionPreviewComponent, RouterLink],
  providers: [RecognitionStore, VisionWorkerClient],
  templateUrl: './recognition-page.component.html',
})
export class RecognitionPageComponent {
  protected readonly store = inject(RecognitionStore);
  protected readonly camera = inject(CameraService);
  protected readonly acceptable = inject(VISION_CONFIG).confidenceThresholds.acceptable;

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
  /** Explanation for UNKNOWN or low-confidence squares. */
  protected readonly notes = computed(() => {
    const cells = this.store.cells();
    const confidence = this.store.confidence();
    const notes = new Map<number, string>();
    for (const [index, reason] of this.store.reasons()) {
      const label = REASON_LABELS[reason];
      const uncertain =
        cells?.[index] === 'UNKNOWN' || (confidence?.[index] ?? 1) < this.acceptable;
      if (label && uncertain) notes.set(index, label);
    }
    return notes;
  });
  protected readonly exportState = signal<ExportState>({ status: 'IDLE' });

  protected readonly metricsPercent = computed(() => {
    const metrics = this.store.metrics();
    return metrics ? Math.round((metrics.matched / metrics.total) * 100) : null;
  });

  protected async exportSample(): Promise<void> {
    this.exportState.set({ status: 'WORKING' });
    try {
      const sample = await this.store.buildLabeledSample();
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
