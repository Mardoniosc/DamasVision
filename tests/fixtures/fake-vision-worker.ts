import { VisionWorkerPort } from '../../src/app/core/workers/vision-worker.client';
import {
  VisionWorkerRequest,
  VisionWorkerResponse,
} from '../../src/app/core/workers/vision-worker.protocol';

/** In-memory stand-in for the vision `Worker`: records requests, lets tests reply. */
export class FakeVisionWorker extends EventTarget implements VisionWorkerPort {
  readonly received: { message: VisionWorkerRequest; transfer: Transferable[] }[] = [];
  terminated = false;
  /** When set, replies automatically to each request. */
  autoReply: ((message: VisionWorkerRequest) => VisionWorkerResponse | null) | null = null;

  postMessage(message: VisionWorkerRequest, transfer: Transferable[] = []): void {
    if (this.terminated) {
      throw new Error('worker terminated');
    }
    this.received.push({ message, transfer });
    const reply = this.autoReply?.(message);
    if (reply) {
      queueMicrotask(() => this.reply(reply));
    }
  }

  terminate(): void {
    this.terminated = true;
  }

  /** Delivers a message as if posted by the worker. */
  reply(data: unknown): void {
    if (!this.terminated) {
      this.dispatchEvent(new MessageEvent('message', { data }));
    }
  }

  crash(): void {
    this.dispatchEvent(new Event('error'));
  }

  sent(type: VisionWorkerRequest['type']): VisionWorkerRequest[] {
    return this.received
      .filter((entry) => entry.message.type === type)
      .map((entry) => entry.message);
  }
}

/** Auto-reply implementing the happy path of the protocol. */
export function happyPathReply(message: VisionWorkerRequest): VisionWorkerResponse | null {
  switch (message.type) {
    case 'INIT':
      return { type: 'READY' };
    case 'CALIBRATE':
      return {
        type: 'CALIBRATION_RESULT',
        result: {
          valid: true,
          issues: [],
          transform: [1, 0, 0, 0, 1, 0, 0, 0, 1],
          normalizedWidth: 800,
          normalizedHeight: 800,
        },
      };
    case 'REFINE_CALIBRATION':
      return {
        type: 'CALIBRATION_REFINED',
        frameId: message.frameId,
        corners: {
          topLeft: { x: message.corners.topLeft.x + 4, y: message.corners.topLeft.y },
          topRight: { x: message.corners.topRight.x + 4, y: message.corners.topRight.y },
          bottomRight: { x: message.corners.bottomRight.x + 4, y: message.corners.bottomRight.y },
          bottomLeft: { x: message.corners.bottomLeft.x + 4, y: message.corners.bottomLeft.y },
        },
        scoreBefore: 40,
        scoreAfter: 50,
        maxShiftPx: 4,
      };
    case 'RECTIFY_FRAME':
      return {
        type: 'RECTIFIED_FRAME',
        frameId: message.frameId,
        image: { width: 800, height: 800, close: () => undefined } as unknown as ImageBitmap,
      };
    default:
      return null;
  }
}
