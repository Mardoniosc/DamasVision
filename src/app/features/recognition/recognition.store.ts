import { computed, DestroyRef, inject, Injectable, signal } from '@angular/core';
import { CameraService } from '../../core/camera/camera.service';
import { CapturedFrame } from '../../core/frame-capture/frame-capture.models';
import { FrameCaptureService } from '../../core/frame-capture/frame-capture.service';
import { CALIBRATION_REPOSITORY } from '../../core/persistence/calibration.repository';
import {
  PersistedCalibration,
  PersistenceError,
  toPersistenceError,
} from '../../core/persistence/persistence.models';
import { VISION_CONFIG, VisionWorkerClient } from '../../core/workers/vision-worker.client';
import { releaseFrame } from '../../core/frame-capture/frame-capture.models';
import { bitmapToPngDataUrl } from '../../shared/utilities/file-export';
import {
  ObservationStabilizer,
  StableSquare,
} from '../../vision/recognition/temporal/observation-stabilizer';
import { LABELED_SAMPLE_FORMAT, LabeledSample, SampleMetadata } from './labeled-sample';
import { FrameAssessment, SquareTrace } from '../../core/workers/vision-worker.protocol';
import { isPlayableSquare, PLAYABLE_SQUARES, SquareIndex } from '../../domain/board/board';
import { projectBoardOverlay } from '../../domain/board/board-grid';
import {
  canonicalCorners,
  imageCornersFromCanonical,
  scaleCorners,
} from '../../domain/board/calibration';
import { Size2D } from '../../domain/board/geometry';
import {
  applyCorrections,
  BoardObservation,
  BoardRecognitionResult,
} from '../../domain/board/observation';
import { ObservedPiece, Piece, pieceColor } from '../../domain/board/piece';

export type RecognitionPhase =
  'LOADING' | 'NO_CALIBRATION' | 'RECOGNIZING' | 'CORRECTING' | 'CONFIRMED' | 'ERROR';

export interface RecognitionMarker {
  readonly index: SquareIndex;
  readonly x: number;
  readonly y: number;
  readonly piece: ObservedPiece;
  readonly confidence: number;
}

export interface CorrectionMetrics {
  /** Playable squares whose automatic reading matched the user's final board. */
  readonly matched: number;
  readonly total: number;
  readonly corrected: number;
  /** Squares the reader left as UNKNOWN. */
  readonly unknown: number;
}

export type RealignState =
  | { readonly status: 'IDLE' }
  | { readonly status: 'WORKING' }
  | { readonly status: 'DONE'; readonly shiftPx: number }
  | { readonly status: 'ERROR'; readonly message: string };

/** Thrown inside the frame processor when the saved calibration cannot be used. */
class CalibrationMismatchError extends Error {}

/**
 * Recognition step (E3): runs the frame scheduler with the vision worker as processor,
 * exposes the latest recognition, and manages manual correction (spec §10). Recognition
 * never touches game state; the confirmed observation is only handed to the game setup (E6).
 */
@Injectable()
export class RecognitionStore {
  private readonly camera = inject(CameraService);
  private readonly capture = inject(FrameCaptureService);
  private readonly worker = inject(VisionWorkerClient);
  private readonly repository = inject(CALIBRATION_REPOSITORY);
  private readonly visionConfig = inject(VISION_CONFIG);

  private readonly phaseState = signal<RecognitionPhase>('LOADING');
  private readonly profileState = signal<PersistedCalibration | null>(null);
  private readonly latestState = signal<BoardRecognitionResult | null>(null);
  private readonly frameSizeState = signal<Size2D | null>(null);
  private readonly frozenState = signal<BoardRecognitionResult | null>(null);
  private readonly latestTracesState = signal<readonly SquareTrace[]>([]);
  private readonly frozenTracesState = signal<readonly SquareTrace[]>([]);
  private readonly frameAssessmentState = signal<FrameAssessment | null>(null);
  private readonly debugState = signal(false);
  private readonly debugImageState = signal<ImageBitmap | null>(null);
  private readonly stableSquaresState = signal<readonly StableSquare[]>([]);
  private readonly stabilizer = new ObservationStabilizer({
    windowSize: this.visionConfig.stabilityWindowSize,
    minAgreeing: this.visionConfig.stableObservationCount,
    maxAgeMs: this.visionConfig.stabilityWindowSize * this.visionConfig.analysisIntervalMs * 2,
    acceptable: this.visionConfig.confidenceThresholds.acceptable,
  });
  private readonly correctionsState = signal<ReadonlyMap<SquareIndex, Piece>>(new Map());
  private readonly selectedState = signal<SquareIndex | null>(null);
  private readonly confirmedState = signal<BoardObservation | null>(null);
  private readonly errorState = signal<string | null>(null);
  private readonly realignStateSignal = signal<RealignState>({ status: 'IDLE' });

  readonly phase = this.phaseState.asReadonly();
  readonly profile = this.profileState.asReadonly();
  readonly latest = this.latestState.asReadonly();
  readonly frameSize = this.frameSizeState.asReadonly();
  readonly selected = this.selectedState.asReadonly();
  readonly confirmed = this.confirmedState.asReadonly();
  readonly error = this.errorState.asReadonly();
  readonly realignState = this.realignStateSignal.asReadonly();
  readonly framesProcessed = computed(() => this.capture.stats().processed);

  /** Per-square traces of the reading shown (frozen while correcting, live otherwise). */
  readonly traces = computed<readonly SquareTrace[]>(() =>
    this.frozenState() ? this.frozenTracesState() : this.latestTracesState(),
  );
  /** Stage A assessment of the last processed frame. */
  readonly frameAssessment = this.frameAssessmentState.asReadonly();
  /** Diagnostic mode: the worker also returns the rectified image. */
  readonly debug = this.debugState.asReadonly();
  readonly debugImage = this.debugImageState.asReadonly();
  /** Temporal consolidation per square (votes, decision), for the shown reading. */
  readonly stableSquares = this.stableSquaresState.asReadonly();

  /** The recognition shown: frozen while correcting, live otherwise. */
  readonly shown = computed(() => this.frozenState() ?? this.latestState());

  /** Cells shown on the digital board, with corrections applied while correcting. */
  readonly cells = computed<readonly ObservedPiece[] | null>(() => {
    const confirmed = this.confirmedState();
    if (confirmed) return confirmed.cells;
    const frozen = this.frozenState();
    if (frozen) return applyCorrections(frozen.board, this.correctionsState()).cells;
    return this.latestState()?.board.cells ?? null;
  });
  readonly confidence = computed(() => {
    const frozen = this.frozenState();
    if (this.confirmedState()) return this.confirmedState()?.confidenceBySquare ?? null;
    if (frozen) return applyCorrections(frozen.board, this.correctionsState()).confidenceBySquare;
    return this.latestState()?.board.confidenceBySquare ?? null;
  });
  readonly changedSquares = computed(() => {
    const frozen = this.frozenState();
    if (!frozen) return [];
    return [...this.correctionsState()]
      .filter(([index, piece]) => frozen.board.cells[index] !== piece)
      .map(([index]) => index);
  });
  readonly unknownCount = computed(
    () => PLAYABLE_SQUARES.filter((index) => this.cells()?.[index] === 'UNKNOWN').length,
  );
  readonly pieceCounts = computed(() => {
    const cells = this.cells() ?? [];
    return {
      white: cells.filter((piece) => pieceColor(piece) === 'WHITE').length,
      black: cells.filter((piece) => pieceColor(piece) === 'BLACK').length,
    };
  });
  readonly canConfirm = computed(
    () => this.phaseState() === 'CORRECTING' && this.unknownCount() === 0,
  );

  /** How well the automatic reading matched the corrected board (Gate G3: measurable). */
  readonly metrics = computed<CorrectionMetrics | null>(() => {
    const frozen = this.frozenState();
    const cells = this.cells();
    if (!frozen || !cells) return null;
    const matched = PLAYABLE_SQUARES.filter(
      (index) => frozen.board.cells[index] === cells[index],
    ).length;
    return {
      matched,
      total: PLAYABLE_SQUARES.length,
      corrected: this.changedSquares().length,
      unknown: PLAYABLE_SQUARES.filter((index) => frozen.board.cells[index] === 'UNKNOWN').length,
    };
  });

  /** Recognition markers projected onto the camera image. */
  readonly markers = computed<readonly RecognitionMarker[]>(() => {
    const profile = this.profileState();
    const size = this.frameSizeState();
    const result = this.shown();
    if (!profile || !size || !result) return [];
    const overlay = projectBoardOverlay(this.canonicalFor(profile, size));
    if (!overlay) return [];
    return PLAYABLE_SQUARES.map((index, i) => {
      const point = overlay.playableCenters[i] ?? { x: 0, y: 0 };
      return {
        index,
        x: point.x,
        y: point.y,
        piece: result.board.cells[index] ?? 'UNKNOWN',
        confidence: result.board.confidenceBySquare[index] ?? 0,
      };
    });
  });

  private calibratedFor: Size2D | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.capture.stop();
      this.replaceDebugImage(null);
    });
  }

  /** Loads the active calibration, opens the camera and starts recognizing. */
  async start(): Promise<void> {
    this.phaseState.set('LOADING');
    this.errorState.set(null);
    this.resetStabilization();
    let profile: PersistedCalibration | undefined;
    try {
      profile = await this.repository.getActive();
    } catch (error) {
      this.fail(toPersistenceError(error).message);
      return;
    }
    if (!profile) {
      this.phaseState.set('NO_CALIBRATION');
      return;
    }
    this.profileState.set(profile);

    if (!this.camera.isStreaming()) {
      await this.camera.start(this.camera.selectedDeviceId() ?? profile.cameraDeviceId);
    }
    if (!this.camera.isStreaming()) {
      this.fail(this.camera.status().error?.message ?? 'Não foi possível abrir a câmera.');
      return;
    }
    try {
      await this.worker.init();
    } catch {
      this.fail('O processamento de imagem não pôde ser iniciado. Recarregue a página.');
      return;
    }
    this.phaseState.set('RECOGNIZING');
    await this.capture.start((frame) => this.processFrame(frame));
  }

  /**
   * Re-snaps the saved calibration to the square borders in a fresh frame (ADR-027) and
   * saves it — for a board that moved slightly or corners placed imprecisely.
   */
  async realign(): Promise<void> {
    const profile = this.profileState();
    if (!profile || this.phaseState() !== 'RECOGNIZING') return;
    this.realignStateSignal.set({ status: 'WORKING' });
    this.capture.pause();
    try {
      const frame = await this.capture.captureSnapshot();
      const size = { width: frame.width, height: frame.height };
      const result = await this.worker.refine(this.canonicalFor(profile, size), frame);
      const source = { width: profile.sourceWidth, height: profile.sourceHeight };
      const updated: PersistedCalibration = {
        ...profile,
        corners: scaleCorners(
          imageCornersFromCanonical(result.corners, profile.orientation),
          size,
          source,
        ),
        updatedAt: new Date().toISOString(),
      };
      await this.repository.update(updated);
      this.profileState.set(updated);
      this.calibratedFor = null;
      this.resetStabilization();
      this.realignStateSignal.set({ status: 'DONE', shiftPx: Math.round(result.maxShiftPx) });
    } catch (error) {
      const message =
        error instanceof PersistenceError
          ? error.message
          : 'Não foi possível reajustar os cantos. Verifique a câmera e tente novamente.';
      this.realignStateSignal.set({ status: 'ERROR', message });
    } finally {
      if (this.phaseState() === 'RECOGNIZING') {
        this.capture.resume();
      }
    }
  }

  private resetStabilization(): void {
    this.stabilizer.reset();
    this.stableSquaresState.set([]);
  }

  /** Turns the diagnostic view on or off (rectified image + per-square traces). */
  setDebug(enabled: boolean): void {
    this.debugState.set(enabled);
    if (!enabled) this.replaceDebugImage(null);
  }

  private replaceDebugImage(image: ImageBitmap | null): void {
    const previous = this.debugImageState();
    if (previous && previous !== image) previous.close();
    this.debugImageState.set(image);
  }

  /** Freezes the current reading so the user can correct it. */
  pauseForCorrection(): void {
    const latest = this.latestState();
    if (this.phaseState() !== 'RECOGNIZING' || !latest) return;
    this.capture.pause();
    this.frozenState.set(latest);
    this.frozenTracesState.set(this.latestTracesState());
    this.correctionsState.set(new Map());
    this.selectedState.set(null);
    this.phaseState.set('CORRECTING');
  }

  /** Discards corrections and returns to live recognition. */
  resume(): void {
    if (this.phaseState() !== 'CORRECTING' && this.phaseState() !== 'CONFIRMED') return;
    this.frozenState.set(null);
    this.confirmedState.set(null);
    this.correctionsState.set(new Map());
    this.selectedState.set(null);
    this.resetStabilization();
    this.phaseState.set('RECOGNIZING');
    this.capture.resume();
  }

  selectSquare(index: SquareIndex): void {
    if (this.phaseState() === 'CORRECTING' && isPlayableSquare(index)) {
      this.selectedState.set(this.selectedState() === index ? null : index);
    }
  }

  /** Sets the piece of the selected square (spec §10 manual correction). */
  setSelectedPiece(piece: Piece): void {
    const index = this.selectedState();
    const frozen = this.frozenState();
    if (index === null || !frozen || this.phaseState() !== 'CORRECTING') return;
    const corrections = new Map(this.correctionsState());
    if (frozen.board.cells[index] === piece) {
      corrections.delete(index);
    } else {
      corrections.set(index, piece);
    }
    this.correctionsState.set(corrections);
  }

  undoCorrections(): void {
    this.correctionsState.set(new Map());
  }

  /** Accepts the corrected observation. Requires every square to be known. */
  confirm(): void {
    const frozen = this.frozenState();
    if (!this.canConfirm() || !frozen) return;
    this.confirmedState.set(applyCorrections(frozen.board, this.correctionsState()));
    this.selectedState.set(null);
    this.phaseState.set('CONFIRMED');
  }

  /**
   * Builds a labeled sample from the confirmed position and a fresh camera frame, for
   * validating recognition on real boards (ADR-028). Requires a confirmed position.
   */
  async buildLabeledSample(metadata: SampleMetadata = {}): Promise<LabeledSample> {
    const confirmed = this.confirmedState();
    const frozen = this.frozenState();
    const profile = this.profileState();
    if (!confirmed || !frozen || !profile) {
      throw new Error('Confirme a posição antes de exportar a amostra.');
    }
    const labels = confirmed.cells.map((cell) => {
      if (cell === 'UNKNOWN')
        throw new Error('A posição confirmada não pode ter casas desconhecidas.');
      return cell;
    });
    const frame = await this.capture.captureSnapshot();
    try {
      const size = { width: frame.width, height: frame.height };
      return {
        format: LABELED_SAMPLE_FORMAT,
        version: 1,
        createdAt: new Date().toISOString(),
        frame: { ...size, png: bitmapToPngDataUrl(frame.bitmap) },
        calibration: {
          corners: scaleCorners(
            profile.corners,
            { width: profile.sourceWidth, height: profile.sourceHeight },
            size,
          ),
          orientation: profile.orientation,
        },
        labels,
        recognized: {
          cells: frozen.board.cells,
          confidenceBySquare: frozen.board.confidenceBySquare,
          diagnostics: this.frozenTracesState(),
        },
        visionConfig: this.visionConfig,
        ...(metadata.description?.trim() ? { description: metadata.description.trim() } : {}),
        ...(metadata.conditions?.length ? { conditions: [...metadata.conditions] } : {}),
      };
    } finally {
      releaseFrame(frame);
    }
  }

  private async processFrame(frame: CapturedFrame): Promise<void> {
    const profile = this.profileState();
    if (!profile) return;
    const size = { width: frame.width, height: frame.height };
    if (this.calibratedFor?.width !== size.width || this.calibratedFor.height !== size.height) {
      const result = await this.worker.calibrate(
        this.canonicalFor(profile, size),
        size.width,
        size.height,
      );
      if (!result.valid) {
        this.fail(
          'A calibração salva não serve para a imagem atual da câmera. Refaça a calibração.',
        );
        this.capture.stop();
        throw new CalibrationMismatchError('saved calibration invalid for frame size');
      }
      this.calibratedFor = size;
      this.frameSizeState.set(size);
    }
    const output = await this.worker.process(frame, { debug: this.debugState() });
    if (this.phaseState() === 'RECOGNIZING') {
      // The board shows the temporally consolidated reading, never a single frame.
      this.stabilizer.push(output.result, output.frame);
      this.latestState.set(this.stabilizer.stableResult(output.result));
      this.stableSquaresState.set(this.stabilizer.squares());
      this.latestTracesState.set(output.traces);
      this.frameAssessmentState.set(output.frame);
      this.replaceDebugImage(output.debugImage);
    } else {
      output.debugImage?.close();
    }
  }

  private canonicalFor(profile: PersistedCalibration, size: Size2D) {
    const from = { width: profile.sourceWidth, height: profile.sourceHeight };
    const corners =
      from.width === size.width && from.height === size.height
        ? profile.corners
        : scaleCorners(profile.corners, from, size);
    return canonicalCorners(corners, profile.orientation);
  }

  private fail(message: string): void {
    this.errorState.set(message);
    this.phaseState.set('ERROR');
  }
}
