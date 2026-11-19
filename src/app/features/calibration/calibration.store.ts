import { computed, DestroyRef, inject, Injectable, signal } from '@angular/core';
import { CameraService } from '../../core/camera/camera.service';
import { FrameCaptureService, SnapshotError } from '../../core/frame-capture/frame-capture.service';
import { releaseFrame } from '../../core/frame-capture/frame-capture.models';
import { CALIBRATION_REPOSITORY } from '../../core/persistence/calibration.repository';
import {
  PersistedCalibration,
  toPersistenceError,
} from '../../core/persistence/persistence.models';
import {
  VISION_CONFIG,
  VisionWorkerClient,
  VisionWorkerError,
} from '../../core/workers/vision-worker.client';
import { projectBoardOverlay } from '../../domain/board/board-grid';
import {
  CalibrationCorners,
  CalibrationOrientation,
  canonicalCorners,
  clampPoint,
  CornerName,
  defaultCorners,
  imageCornersFromCanonical,
  nextOrientation,
  scaleCorners,
  validateCalibrationCorners,
} from '../../domain/board/calibration';
import { Point2D, Size2D } from '../../domain/board/geometry';
import { describeIssue } from './calibration-messages';
import { resolveClassifierConfig } from '../../vision/recognition/classifier.config';

export type PreviewState =
  | { readonly status: 'IDLE' }
  | { readonly status: 'WORKING' }
  | { readonly status: 'READY'; readonly image: ImageBitmap }
  | { readonly status: 'ERROR'; readonly message: string };

export type AdjustState =
  | { readonly status: 'IDLE' }
  | { readonly status: 'WORKING' }
  | { readonly status: 'DONE'; readonly shiftPx: number; readonly gainPercent: number }
  | { readonly status: 'ERROR'; readonly message: string };

export type SaveState =
  | { readonly status: 'IDLE' }
  | { readonly status: 'SAVING' }
  | { readonly status: 'SAVED' }
  | { readonly status: 'ERROR'; readonly message: string };

/**
 * Calibration screen state (E2). Geometry and validation come from the domain,
 * warping from the vision worker, storage from the repository; this store only
 * orchestrates them for the page.
 */
@Injectable()
export class CalibrationStore {
  private readonly camera = inject(CameraService);
  private readonly capture = inject(FrameCaptureService);
  private readonly worker = inject(VisionWorkerClient);
  private readonly repository = inject(CALIBRATION_REPOSITORY);
  private readonly visionConfig = inject(VISION_CONFIG);

  readonly normalizedSize: Size2D = {
    width: this.visionConfig.normalizedBoardWidth,
    height: this.visionConfig.normalizedBoardHeight,
  };
  readonly roiInsetRatio = this.visionConfig.roiInsetRatio;
  /** Classifier geometry, so the preview draws the regions recognition really uses. */
  readonly classifierShape = resolveClassifierConfig(this.visionConfig).shape;

  private readonly sourceSizeState = signal<Size2D | null>(null);
  private readonly cornersState = signal<CalibrationCorners | null>(null);
  private readonly orientationState = signal<CalibrationOrientation>('NORMAL');
  private readonly previewState = signal<PreviewState>({ status: 'IDLE' });
  private readonly saveState = signal<SaveState>({ status: 'IDLE' });
  private readonly savedProfileState = signal<PersistedCalibration | null>(null);
  private readonly loadErrorState = signal<string | null>(null);
  private readonly adjustState = signal<AdjustState>({ status: 'IDLE' });

  readonly sourceSize = this.sourceSizeState.asReadonly();
  readonly corners = this.cornersState.asReadonly();
  readonly orientation = this.orientationState.asReadonly();
  readonly preview = this.previewState.asReadonly();
  readonly save = this.saveState.asReadonly();
  readonly savedProfile = this.savedProfileState.asReadonly();
  readonly loadError = this.loadErrorState.asReadonly();
  readonly adjust = this.adjustState.asReadonly();

  readonly validation = computed(() => {
    const corners = this.cornersState();
    const size = this.sourceSizeState();
    return corners && size ? validateCalibrationCorners(corners, size) : null;
  });
  readonly isValid = computed(() => this.validation()?.valid === true);
  readonly issueMessages = computed(() => (this.validation()?.issues ?? []).map(describeIssue));
  readonly invalidCorners = computed(() => [
    ...new Set((this.validation()?.issues ?? []).flatMap((issue) => issue.corners)),
  ]);
  readonly canonical = computed(() => {
    const corners = this.cornersState();
    return corners ? canonicalCorners(corners, this.orientationState()) : null;
  });
  readonly overlay = computed(() => {
    const canonical = this.canonical();
    return canonical && this.isValid() ? projectBoardOverlay(canonical) : null;
  });

  /** Profile waiting for the video size before its corners can be applied. */
  private pendingProfile: PersistedCalibration | null = null;
  /** Invalidates in-flight preview generations when the user edits the calibration. */
  private editVersion = 0;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.replacePreview({ status: 'IDLE' }));
  }

  /** Restores the active calibration, if any. */
  async load(): Promise<void> {
    try {
      const active = await this.repository.getActive();
      this.loadErrorState.set(null);
      if (!active) {
        return;
      }
      this.savedProfileState.set(active);
      this.orientationState.set(active.orientation);
      this.pendingProfile = active;
      this.applyPendingProfile();
    } catch (error) {
      this.loadErrorState.set(toPersistenceError(error).message);
    }
  }

  /** Called when the camera video reports its intrinsic size. */
  setSourceSize(size: Size2D): void {
    const previous = this.sourceSizeState();
    if (previous && previous.width === size.width && previous.height === size.height) {
      return;
    }
    this.sourceSizeState.set(size);
    const corners = this.cornersState();
    if (this.pendingProfile) {
      this.applyPendingProfile();
    } else if (corners && previous) {
      this.cornersState.set(scaleCorners(corners, previous, size));
      this.markEdited();
    } else if (!corners) {
      this.cornersState.set(defaultCorners(size));
    }
  }

  moveCorner(corner: CornerName, point: Point2D): void {
    const size = this.sourceSizeState();
    const corners = this.cornersState();
    if (!size || !corners) {
      return;
    }
    this.cornersState.set({ ...corners, [corner]: clampPoint(point, size) });
    this.markEdited();
  }

  nudgeCorner(corner: CornerName, dx: number, dy: number): void {
    const current = this.cornersState()?.[corner];
    if (current) {
      this.moveCorner(corner, { x: current.x + dx, y: current.y + dy });
    }
  }

  rotate(): void {
    this.orientationState.update(nextOrientation);
    this.markEdited();
  }

  resetCorners(): void {
    const size = this.sourceSizeState();
    if (!size) {
      return;
    }
    this.cornersState.set(defaultCorners(size));
    this.orientationState.set('NORMAL');
    this.markEdited();
  }

  /** Captures a frame and asks the vision worker for the normalized board image. */
  /**
   * Snaps the corners to the square borders seen by the camera (ADR-027). The search
   * stays within half a square of the handles, so place them roughly first.
   */
  async autoAdjust(): Promise<void> {
    const canonical = this.canonical();
    const size = this.sourceSizeState();
    if (!canonical || !size || !this.isValid()) {
      return;
    }
    const version = this.editVersion;
    this.adjustState.set({ status: 'WORKING' });
    try {
      const frame = await this.capture.captureSnapshot();
      const frameSize = { width: frame.width, height: frame.height };
      const result = await this.worker.refine(scaleCorners(canonical, size, frameSize), frame);
      if (version !== this.editVersion) {
        this.adjustState.set({ status: 'IDLE' });
        return;
      }
      const corners = scaleCorners(
        imageCornersFromCanonical(result.corners, this.orientationState()),
        frameSize,
        size,
      );
      this.cornersState.set(corners);
      this.markEdited();
      this.adjustState.set({
        status: 'DONE',
        shiftPx: Math.round(result.maxShiftPx * (size.width / frameSize.width)),
        gainPercent:
          result.scoreBefore > 0
            ? Math.round((result.scoreAfter / result.scoreBefore - 1) * 100)
            : 0,
      });
    } catch (error) {
      this.adjustState.set({ status: 'ERROR', message: previewErrorMessage(error) });
    }
  }

  async generatePreview(): Promise<void> {
    const canonical = this.canonical();
    const size = this.sourceSizeState();
    if (!canonical || !size || !this.isValid()) {
      return;
    }
    const version = this.editVersion;
    this.replacePreview({ status: 'WORKING' });

    try {
      const frame = await this.capture.captureSnapshot();
      const frameSize = { width: frame.width, height: frame.height };
      const corners =
        frame.width === size.width && frame.height === size.height
          ? canonical
          : scaleCorners(canonical, size, frameSize);

      let image: ImageBitmap;
      try {
        const result = await this.worker.calibrate(corners, frame.width, frame.height);
        if (!result.valid) {
          releaseFrame(frame);
          this.finishPreview(version, {
            status: 'ERROR',
            message: result.issues.map(describeIssue).join(' ') || 'Calibração inválida.',
          });
          return;
        }
        image = await this.worker.rectify(frame);
      } catch (error) {
        releaseFrame(frame);
        throw error;
      }
      this.finishPreview(version, { status: 'READY', image });
    } catch (error) {
      this.finishPreview(version, { status: 'ERROR', message: previewErrorMessage(error) });
    }
  }

  async saveCalibration(): Promise<void> {
    const corners = this.cornersState();
    const size = this.sourceSizeState();
    if (!corners || !size || !this.isValid()) {
      return;
    }
    this.saveState.set({ status: 'SAVING' });
    const existing = this.savedProfileState();
    const now = new Date().toISOString();
    const deviceId = this.camera.selectedDeviceId();
    const profile: PersistedCalibration = {
      id: existing?.id ?? crypto.randomUUID(),
      name: existing?.name ?? `Calibração de ${formatDate(now)}`,
      ...(deviceId ? { cameraDeviceId: deviceId } : {}),
      sourceWidth: size.width,
      sourceHeight: size.height,
      corners,
      normalizedWidth: this.normalizedSize.width,
      normalizedHeight: this.normalizedSize.height,
      orientation: this.orientationState(),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      isActive: true,
    };
    try {
      if (existing) {
        await this.repository.update(profile);
      } else {
        await this.repository.create(profile);
      }
      await this.repository.setActive(profile.id);
      this.savedProfileState.set(profile);
      this.saveState.set({ status: 'SAVED' });
    } catch (error) {
      this.saveState.set({ status: 'ERROR', message: toPersistenceError(error).message });
    }
  }

  private applyPendingProfile(): void {
    const profile = this.pendingProfile;
    const size = this.sourceSizeState();
    if (!profile || !size) {
      return;
    }
    this.pendingProfile = null;
    const from = { width: profile.sourceWidth, height: profile.sourceHeight };
    this.cornersState.set(
      from.width === size.width && from.height === size.height
        ? profile.corners
        : scaleCorners(profile.corners, from, size),
    );
  }

  private markEdited(): void {
    this.editVersion++;
    this.replacePreview({ status: 'IDLE' });
    if (this.adjustState().status !== 'WORKING') {
      this.adjustState.set({ status: 'IDLE' });
    }
    if (this.saveState().status !== 'SAVING') {
      this.saveState.set({ status: 'IDLE' });
    }
  }

  private finishPreview(version: number, state: PreviewState): void {
    if (version !== this.editVersion) {
      if (state.status === 'READY') {
        state.image.close();
      }
      return;
    }
    this.replacePreview(state);
  }

  /** Swaps the preview, closing the previous bitmap. */
  private replacePreview(state: PreviewState): void {
    const previous = this.previewState();
    if (
      previous.status === 'READY' &&
      (state.status !== 'READY' || state.image !== previous.image)
    ) {
      previous.image.close();
    }
    this.previewState.set(state);
  }
}

function previewErrorMessage(error: unknown): string {
  if (error instanceof SnapshotError) {
    return error.message;
  }
  if (error instanceof VisionWorkerError) {
    return error.failure === 'TIMEOUT'
      ? 'O processamento de imagem demorou demais. Tente novamente.'
      : 'O processamento de imagem falhou. Tente novamente; se persistir, recarregue a página.';
  }
  return 'Não foi possível gerar a imagem normalizada. Verifique a câmera e tente novamente.';
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(
    new Date(iso),
  );
}
