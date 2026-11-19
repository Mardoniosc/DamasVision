import { Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { CameraState } from '../../core/camera/camera.models';
import { CameraService } from '../../core/camera/camera.service';
import {
  FrameCaptureService,
  FrameCaptureState,
} from '../../core/frame-capture/frame-capture.service';
import { MediaStreamDirective } from '../../shared/directives/media-stream.directive';

const CAMERA_STATE_LABELS: Readonly<Record<CameraState, string>> = {
  IDLE: 'Câmera desligada',
  REQUESTING_PERMISSION: 'Aguardando permissão…',
  READY: 'Câmera disponível',
  STREAMING: 'Transmitindo',
  ERROR: 'Erro',
};

const CAMERA_STATE_STYLES: Readonly<Record<CameraState, string>> = {
  IDLE: 'bg-stone-100 text-stone-700',
  REQUESTING_PERMISSION: 'bg-amber-100 text-amber-800',
  READY: 'bg-stone-100 text-stone-700',
  STREAMING: 'bg-brand-100 text-brand-700',
  ERROR: 'bg-red-100 text-red-800',
};

const CAPTURE_STATE_LABELS: Readonly<Record<FrameCaptureState, string>> = {
  STOPPED: 'Parada',
  STARTING: 'Iniciando…',
  RUNNING: 'Em execução',
  PAUSED: 'Pausada',
  ERROR: 'Erro',
};

/**
 * Setup step 1 (E1): camera selection, preview and capture diagnostics.
 * Thin orchestration only; camera and capture state live in core services.
 */
@Component({
  selector: 'app-game-setup-page',
  imports: [MediaStreamDirective],
  templateUrl: './game-setup-page.component.html',
})
export class GameSetupPageComponent {
  protected readonly camera = inject(CameraService);
  protected readonly capture = inject(FrameCaptureService);

  protected readonly cameraState = computed(() => this.camera.status().state);
  protected readonly cameraStateLabel = computed(() => CAMERA_STATE_LABELS[this.cameraState()]);
  protected readonly cameraStateStyle = computed(() => CAMERA_STATE_STYLES[this.cameraState()]);
  protected readonly cameraError = computed(() => this.camera.status().error ?? null);
  protected readonly requestingPermission = computed(
    () => this.cameraState() === 'REQUESTING_PERMISSION',
  );
  protected readonly captureStateLabel = computed(() => CAPTURE_STATE_LABELS[this.capture.state()]);
  protected readonly canStartCapture = computed(
    () =>
      this.camera.isStreaming() &&
      (this.capture.state() === 'STOPPED' || this.capture.state() === 'ERROR'),
  );
  protected readonly canStopCapture = computed(() =>
    ['STARTING', 'RUNNING', 'PAUSED'].includes(this.capture.state()),
  );
  protected readonly previewFailed = signal(false);

  constructor() {
    void this.camera.listDevices();
    // Route lifecycle cleanup: never leave the camera or the capture loop running.
    inject(DestroyRef).onDestroy(() => {
      this.capture.stop();
      this.camera.stop();
    });
  }

  protected startCamera(): void {
    this.previewFailed.set(false);
    void this.camera.start(this.camera.selectedDeviceId() ?? undefined);
  }

  protected stopCamera(): void {
    this.capture.stop();
    this.camera.stop();
  }

  protected refreshDevices(): void {
    void this.camera.listDevices();
  }

  protected selectDevice(event: Event): void {
    const { value } = event.target as HTMLSelectElement;
    if (value) {
      this.previewFailed.set(false);
      void this.camera.selectDevice(value);
    }
  }

  protected startCapture(): void {
    void this.capture.start();
  }
}
