import { Component, computed, DestroyRef, inject } from '@angular/core';
import { CameraService } from '../../core/camera/camera.service';
import { VisionWorkerClient } from '../../core/workers/vision-worker.client';
import { ORIENTATION_LABELS } from './calibration-messages';
import { CalibrationStore } from './calibration.store';
import { CornerEditorComponent } from './corner-editor.component';
import { NormalizedBoardComponent } from './normalized-board.component';

/**
 * Calibration step (E2): mark the four board corners, check the projected grid,
 * generate the normalized board image and save the calibration.
 *
 * The vision worker is provided here, so it (and OpenCV's memory) is terminated
 * when the route is left. The camera is opened on entry and released on exit.
 */
@Component({
  selector: 'app-calibration-page',
  imports: [CornerEditorComponent, NormalizedBoardComponent],
  providers: [CalibrationStore, VisionWorkerClient],
  templateUrl: './calibration-page.component.html',
})
export class CalibrationPageComponent {
  protected readonly store = inject(CalibrationStore);
  protected readonly camera = inject(CameraService);
  private readonly worker = inject(VisionWorkerClient);

  protected readonly orientationLabel = computed(
    () => ORIENTATION_LABELS[this.store.orientation()],
  );
  protected readonly cameraError = computed(() => this.camera.status().error ?? null);
  protected readonly workerStatus = computed(() => {
    switch (this.worker.state()) {
      case 'STARTING':
        return 'Carregando o processamento de imagem…';
      case 'READY':
        return 'Processamento de imagem pronto.';
      case 'ERROR':
        return 'O processamento de imagem não pôde ser iniciado.';
      default:
        return null;
    }
  });
  protected readonly canGenerate = computed(
    () =>
      this.store.isValid() &&
      this.camera.isStreaming() &&
      this.store.preview().status !== 'WORKING',
  );

  constructor() {
    void this.store.load();
    this.startCamera();
    // Warm up OpenCV while the user adjusts the corners; failures surface in workerStatus.
    this.worker.init().catch(() => undefined);
    inject(DestroyRef).onDestroy(() => this.camera.stop());
  }

  protected startCamera(): void {
    if (!this.camera.isStreaming()) {
      void this.camera.start(this.camera.selectedDeviceId() ?? undefined);
    }
  }
}
