import { DestroyRef, effect, inject, Injectable, signal, untracked } from '@angular/core';
import { CameraService } from '../camera/camera.service';
import {
  DEFAULT_SNAPSHOT_OPTIONS,
  FRAME_CAPTURE_CONFIG,
  FRAME_SOURCE_FACTORY,
  SnapshotOptions,
} from './frame-capture.config';
import {
  CapturedFrame,
  EMPTY_FRAME_SCHEDULER_STATS,
  FrameProcessor,
  FrameSchedulerStats,
  FrameSource,
} from './frame-capture.models';
import { FrameScheduler } from './frame-scheduler';

export type FrameCaptureState = 'STOPPED' | 'STARTING' | 'RUNNING' | 'PAUSED' | 'ERROR';

/** Snapshot failure with a user-facing message (pt-BR). */
export class SnapshotError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'SnapshotError';
  }
}

export interface FrameInfo {
  readonly frameId: string;
  readonly width: number;
  readonly height: number;
  readonly capturedAt: number;
}

interface CaptureSession {
  readonly stream: MediaStream;
  readonly source: FrameSource;
  readonly scheduler: FrameScheduler;
}

/**
 * E1 consumer: frames are only measured and released. The vision worker replaces it
 * in E2/E3 by passing its own processor to `start()`.
 */
const measureOnly: FrameProcessor = () => Promise.resolve();

/**
 * Runs the frame scheduler against the camera's current stream.
 * Stops automatically when the camera stream changes or closes, and on destroy.
 */
@Injectable({ providedIn: 'root' })
export class FrameCaptureService {
  private readonly camera = inject(CameraService);
  private readonly config = inject(FRAME_CAPTURE_CONFIG);
  private readonly createSource = inject(FRAME_SOURCE_FACTORY);

  private readonly stateState = signal<FrameCaptureState>('STOPPED');
  private readonly statsState = signal<FrameSchedulerStats>(EMPTY_FRAME_SCHEDULER_STATS);
  private readonly lastFrameState = signal<FrameInfo | null>(null);
  private readonly errorState = signal<string | null>(null);

  readonly state = this.stateState.asReadonly();
  readonly stats = this.statsState.asReadonly();
  readonly lastFrame = this.lastFrameState.asReadonly();
  /** Last user-facing capture error (pt-BR), or `null`. */
  readonly error = this.errorState.asReadonly();
  readonly intervalMs = this.config.intervalMs;

  private session: CaptureSession | null = null;
  private startToken = 0;

  constructor() {
    effect(() => {
      const stream = this.camera.stream();
      untracked(() => {
        if (this.session && this.session.stream !== stream) {
          this.stop();
        }
      });
    });
    inject(DestroyRef).onDestroy(() => this.stop());
  }

  async start(processFrame: FrameProcessor = measureOnly): Promise<void> {
    const stream = this.camera.stream();
    if (!stream) {
      this.fail('Ative a câmera antes de iniciar a captura.');
      return;
    }

    this.stop();
    const token = ++this.startToken;
    const source = this.createSource(stream);
    const scheduler = new FrameScheduler({
      config: this.config,
      captureFrame: () => source.capture(),
      processFrame: (frame) => {
        this.lastFrameState.set(toFrameInfo(frame));
        return processFrame(frame);
      },
      onStats: (stats) => this.statsState.set(stats),
      onError: () => this.errorState.set('Falha ao capturar ou processar um quadro.'),
    });
    this.session = { stream, source, scheduler };
    this.statsState.set(EMPTY_FRAME_SCHEDULER_STATS);
    this.lastFrameState.set(null);
    this.errorState.set(null);
    this.stateState.set('STARTING');

    try {
      await source.start();
    } catch {
      if (token === this.startToken) {
        this.stop();
        this.fail('Não foi possível ler os quadros da câmera.');
      }
      return;
    }

    if (token !== this.startToken) {
      return; // stopped or restarted while the source was starting
    }
    scheduler.start();
    this.stateState.set('RUNNING');
  }

  /**
   * Captures one fresh frame from the camera stream with a short-lived source,
   * independent of the scheduler. The caller owns (and must release) the frame.
   * Rejects with a user-facing message (pt-BR).
   */
  async captureSnapshot(
    options: SnapshotOptions = DEFAULT_SNAPSHOT_OPTIONS,
  ): Promise<CapturedFrame> {
    const stream = this.camera.stream();
    if (!stream) {
      throw new SnapshotError('Ative a câmera antes de capturar uma imagem.');
    }
    const source = this.createSource(stream);
    try {
      await source.start();
      const deadline = Date.now() + options.timeoutMs;
      for (;;) {
        const frame = await source.capture();
        if (frame) {
          return frame;
        }
        if (Date.now() >= deadline) {
          throw new SnapshotError('A câmera não entregou nenhuma imagem a tempo.');
        }
        await new Promise((resolve) => setTimeout(resolve, options.pollIntervalMs));
      }
    } catch (error) {
      throw error instanceof SnapshotError
        ? error
        : new SnapshotError('Não foi possível capturar uma imagem da câmera.', { cause: error });
    } finally {
      source.dispose();
    }
  }

  pause(): void {
    if (this.stateState() !== 'RUNNING') {
      return;
    }
    this.session?.scheduler.pause();
    this.stateState.set('PAUSED');
  }

  resume(): void {
    if (this.stateState() !== 'PAUSED') {
      return;
    }
    this.session?.scheduler.resume();
    this.stateState.set('RUNNING');
  }

  stop(): void {
    this.startToken++;
    const session = this.session;
    this.session = null;
    if (session) {
      session.scheduler.stop();
      session.source.dispose();
    }
    this.stateState.set('STOPPED');
    this.errorState.set(null);
  }

  private fail(message: string): void {
    this.errorState.set(message);
    this.stateState.set('ERROR');
  }
}

function toFrameInfo(frame: CapturedFrame): FrameInfo {
  return {
    frameId: frame.frameId,
    width: frame.width,
    height: frame.height,
    capturedAt: frame.capturedAt,
  };
}
