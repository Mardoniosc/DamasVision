import { DestroyRef, effect, inject, Injectable, signal, untracked } from '@angular/core';
import { CameraService } from '../camera/camera.service';
import { FRAME_CAPTURE_CONFIG, FRAME_SOURCE_FACTORY } from './frame-capture.config';
import {
  CapturedFrame,
  EMPTY_FRAME_SCHEDULER_STATS,
  FrameProcessor,
  FrameSchedulerStats,
  FrameSource,
} from './frame-capture.models';
import { FrameScheduler } from './frame-scheduler';

export type FrameCaptureState = 'STOPPED' | 'STARTING' | 'RUNNING' | 'PAUSED' | 'ERROR';

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
