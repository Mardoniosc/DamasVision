import { DestroyRef, inject, Injectable, InjectionToken, signal } from '@angular/core';
import { CalibrationCorners } from '../../domain/board/calibration';
import { DEFAULT_VISION_CONFIG, VisionConfig } from '../../vision/vision.config';
import { CapturedFrame, releaseFrame } from '../frame-capture/frame-capture.models';
import {
  CalibrationResult,
  isVisionWorkerResponse,
  VisionWorkerRequest,
  VisionWorkerResponse,
} from './vision-worker.protocol';

/** Minimal surface of `Worker` used by the client (lets tests use a fake). */
export interface VisionWorkerPort {
  postMessage(message: VisionWorkerRequest, transfer?: Transferable[]): void;
  terminate(): void;
  addEventListener(
    type: 'message' | 'error' | 'messageerror',
    listener: (event: Event) => void,
  ): void;
  removeEventListener(
    type: 'message' | 'error' | 'messageerror',
    listener: (event: Event) => void,
  ): void;
}

export const VISION_WORKER_FACTORY = new InjectionToken<() => VisionWorkerPort>(
  'VISION_WORKER_FACTORY',
  {
    providedIn: 'root',
    factory: () => () =>
      new Worker(new URL('./vision.worker', import.meta.url), { type: 'module' }),
  },
);

export const VISION_CONFIG = new InjectionToken<VisionConfig>('VISION_CONFIG', {
  providedIn: 'root',
  factory: () => DEFAULT_VISION_CONFIG,
});

export interface VisionWorkerTimeouts {
  /** Includes downloading and compiling OpenCV.js (~13 MB). */
  readonly initMs: number;
  readonly requestMs: number;
}

export const VISION_WORKER_TIMEOUTS = new InjectionToken<VisionWorkerTimeouts>(
  'VISION_WORKER_TIMEOUTS',
  {
    providedIn: 'root',
    factory: () => ({ initMs: 60_000, requestMs: 15_000 }),
  },
);

export type VisionWorkerState = 'IDLE' | 'STARTING' | 'READY' | 'ERROR' | 'DISPOSED';

export type VisionWorkerFailure =
  'TIMEOUT' | 'WORKER_CRASHED' | 'DISPOSED' | 'SUPERSEDED' | 'INVALID_RESPONSE' | 'WORKER_ERROR';

export class VisionWorkerError extends Error {
  constructor(
    readonly failure: VisionWorkerFailure,
    message: string,
    /** Error code reported by the worker, when `failure === 'WORKER_ERROR'`. */
    readonly workerCode?: string,
  ) {
    super(message);
    this.name = 'VisionWorkerError';
  }
}

interface Pending {
  resolve(response: VisionWorkerResponse): void;
  reject(error: VisionWorkerError): void;
}

/**
 * Main-thread client of the vision worker (spec §9): initialization, timeouts,
 * payload validation, termination. Provide it per feature/route so the worker
 * (and the OpenCV memory it holds) is terminated when the route is left.
 */
@Injectable()
export class VisionWorkerClient {
  private readonly createWorker = inject(VISION_WORKER_FACTORY);
  private readonly config = inject(VISION_CONFIG);
  private readonly timeouts = inject(VISION_WORKER_TIMEOUTS);

  private readonly stateState = signal<VisionWorkerState>('IDLE');
  private readonly errorState = signal<VisionWorkerError | null>(null);
  readonly state = this.stateState.asReadonly();
  readonly lastError = this.errorState.asReadonly();

  private worker: VisionWorkerPort | null = null;
  private initializing: Promise<void> | null = null;
  private readonly pending = new Map<string, Pending>();
  private readonly onMessage = (event: Event): void =>
    this.handleMessage((event as MessageEvent<unknown>).data);
  private readonly onError = (): void =>
    this.crash(new VisionWorkerError('WORKER_CRASHED', 'The vision worker stopped unexpectedly'));

  constructor() {
    inject(DestroyRef).onDestroy(() => this.dispose());
  }

  /** Starts the worker and loads OpenCV. Idempotent; retries after a failure. */
  init(): Promise<void> {
    if (this.stateState() === 'DISPOSED') {
      return Promise.reject(new VisionWorkerError('DISPOSED', 'Vision worker was disposed'));
    }
    this.initializing ??= this.start().catch((error: unknown) => {
      this.initializing = null;
      throw error;
    });
    return this.initializing;
  }

  async calibrate(
    corners: CalibrationCorners,
    width: number,
    height: number,
  ): Promise<CalibrationResult> {
    await this.init();
    const response = await this.request('CALIBRATE', { type: 'CALIBRATE', corners, width, height });
    if (response.type !== 'CALIBRATION_RESULT') {
      throw new VisionWorkerError('INVALID_RESPONSE', `Unexpected ${response.type} for CALIBRATE`);
    }
    return response.result;
  }

  /** Rectifies a frame with the last valid calibration. Takes ownership of the frame. */
  async rectify(frame: CapturedFrame): Promise<ImageBitmap> {
    try {
      await this.init();
    } catch (error) {
      releaseFrame(frame);
      throw error;
    }
    const key = `RECTIFY_FRAME:${frame.frameId}`;
    const response = await this.request(
      key,
      { type: 'RECTIFY_FRAME', frame: frame.bitmap, frameId: frame.frameId },
      [frame.bitmap],
    );
    // The bitmap was transferred; closing the detached handle is a no-op safeguard.
    releaseFrame(frame);
    if (response.type !== 'RECTIFIED_FRAME') {
      throw new VisionWorkerError(
        'INVALID_RESPONSE',
        `Unexpected ${response.type} for RECTIFY_FRAME`,
      );
    }
    return response.image;
  }

  reset(): void {
    this.worker?.postMessage({ type: 'RESET' });
  }

  dispose(): void {
    if (this.stateState() === 'DISPOSED') {
      return;
    }
    const worker = this.worker;
    if (worker) {
      try {
        worker.postMessage({ type: 'DISPOSE' });
      } catch {
        // The worker may already be gone; termination below is what matters.
      }
    }
    this.teardown();
    this.rejectAll(new VisionWorkerError('DISPOSED', 'Vision worker was disposed'));
    this.stateState.set('DISPOSED');
  }

  private async start(): Promise<void> {
    this.teardown();
    const worker = this.createWorker();
    worker.addEventListener('message', this.onMessage);
    worker.addEventListener('error', this.onError);
    worker.addEventListener('messageerror', this.onError);
    this.worker = worker;
    this.stateState.set('STARTING');
    this.errorState.set(null);

    const response = await this.request(
      'INIT',
      { type: 'INIT', config: this.config },
      [],
      this.timeouts.initMs,
    ).catch((error: unknown) => {
      const failure =
        error instanceof VisionWorkerError
          ? error
          : new VisionWorkerError('WORKER_CRASHED', String(error));
      this.crash(failure);
      throw failure;
    });
    if (response.type !== 'READY') {
      const failure = new VisionWorkerError(
        'INVALID_RESPONSE',
        `Unexpected ${response.type} for INIT`,
      );
      this.crash(failure);
      throw failure;
    }
    this.stateState.set('READY');
  }

  private request(
    key: string,
    message: VisionWorkerRequest,
    transfer: Transferable[] = [],
    timeoutMs = this.timeouts.requestMs,
  ): Promise<VisionWorkerResponse> {
    const worker = this.worker;
    if (!worker) {
      return Promise.reject(
        this.stateState() === 'DISPOSED'
          ? new VisionWorkerError('DISPOSED', 'Vision worker was disposed')
          : new VisionWorkerError('WORKER_CRASHED', 'Vision worker is not running'),
      );
    }
    this.pending
      .get(key)
      ?.reject(new VisionWorkerError('SUPERSEDED', `${key} superseded by a newer request`));

    return new Promise<VisionWorkerResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.get(key) === entry) {
          this.pending.delete(key);
          reject(new VisionWorkerError('TIMEOUT', `${key} timed out after ${timeoutMs} ms`));
        }
      }, timeoutMs);
      const entry: Pending = {
        resolve: (response) => {
          clearTimeout(timer);
          resolve(response);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      };
      this.pending.set(key, entry);
      try {
        worker.postMessage(message, transfer);
      } catch (error) {
        this.pending.delete(key);
        entry.reject(
          new VisionWorkerError(
            'WORKER_CRASHED',
            `Could not send ${message.type}: ${String(error)}`,
          ),
        );
      }
    });
  }

  private handleMessage(data: unknown): void {
    if (!isVisionWorkerResponse(data)) {
      this.errorState.set(
        new VisionWorkerError('INVALID_RESPONSE', 'Malformed message from vision worker'),
      );
      return;
    }
    const key = this.keyFor(data);
    const entry = key ? this.pending.get(key) : undefined;
    if (!entry || !key) {
      // Late answer to a request that timed out or was superseded: release its resources.
      if (data.type === 'RECTIFIED_FRAME') {
        data.image.close();
      }
      if (data.type === 'ERROR') {
        this.errorState.set(new VisionWorkerError('WORKER_ERROR', data.message, data.code));
      }
      return;
    }
    this.pending.delete(key);
    if (data.type === 'ERROR') {
      const error = new VisionWorkerError('WORKER_ERROR', data.message, data.code);
      this.errorState.set(error);
      entry.reject(error);
    } else {
      entry.resolve(data);
    }
  }

  private keyFor(response: VisionWorkerResponse): string | null {
    switch (response.type) {
      case 'READY':
        return 'INIT';
      case 'CALIBRATION_RESULT':
        return 'CALIBRATE';
      case 'RECTIFIED_FRAME':
        return `RECTIFY_FRAME:${response.frameId}`;
      case 'ERROR':
        if (response.frameId) {
          return `RECTIFY_FRAME:${response.frameId}`;
        }
        return response.requestType ?? null;
    }
  }

  private crash(error: VisionWorkerError): void {
    this.teardown();
    this.initializing = null;
    this.rejectAll(error);
    this.errorState.set(error);
    this.stateState.set('ERROR');
  }

  private teardown(): void {
    const worker = this.worker;
    this.worker = null;
    if (worker) {
      worker.removeEventListener('message', this.onMessage);
      worker.removeEventListener('error', this.onError);
      worker.removeEventListener('messageerror', this.onError);
      worker.terminate();
    }
  }

  private rejectAll(error: VisionWorkerError): void {
    const entries = [...this.pending.values()];
    this.pending.clear();
    for (const entry of entries) {
      entry.reject(error);
    }
  }
}
