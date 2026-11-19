import { validateCalibrationCorners } from '../../domain/board/calibration';
import { Size2D } from '../../domain/board/geometry';
import { Homography } from '../../domain/board/homography';
import { OpenCv } from '../../vision/opencv-loader';
import { computePerspectiveTransform, RgbaImage, warpPerspective } from '../../vision/perspective';
import { isVisionConfig, VisionConfig } from '../../vision/vision.config';
import {
  isBitmapLike,
  isCalibrationCorners,
  isFiniteNumber,
  isNonEmptyString,
  isVisionWorkerRequestShape,
  VisionWorkerErrorCode,
  VisionWorkerRequest,
  VisionWorkerResponse,
} from './vision-worker.protocol';

export interface VisionWorkerHandlerDependencies {
  readonly loadOpenCv: () => Promise<OpenCv>;
  readonly post: (message: VisionWorkerResponse, transfer?: Transferable[]) => void;
  /** Reads the pixels of a bitmap. Does not close it. */
  readonly readBitmap: (bitmap: ImageBitmap) => RgbaImage;
  readonly createBitmap: (image: RgbaImage) => Promise<ImageBitmap>;
}

interface ActiveCalibration {
  readonly transform: Homography;
  readonly size: Size2D;
}

/**
 * Worker-side message handling, independent of the worker global scope so it can be
 * unit tested. Every received bitmap is closed; every failure is reported as `ERROR`.
 */
export function createVisionWorkerHandler(
  deps: VisionWorkerHandlerDependencies,
): (message: unknown) => Promise<void> {
  let config: VisionConfig | null = null;
  let cv: OpenCv | null = null;
  let calibration: ActiveCalibration | null = null;

  const fail = (
    code: VisionWorkerErrorCode,
    message: string,
    request?: { type?: string; frameId?: string },
  ): void => {
    deps.post({
      type: 'ERROR',
      code,
      message,
      ...(request?.frameId ? { frameId: request.frameId } : {}),
      ...(request?.type ? { requestType: request.type as VisionWorkerRequest['type'] } : {}),
    });
  };

  const handleInit = async (message: Record<string, unknown>): Promise<void> => {
    if (!isVisionConfig(message['config'])) {
      fail('INVALID_REQUEST', 'INIT requires a valid VisionConfig', { type: 'INIT' });
      return;
    }
    try {
      cv = await deps.loadOpenCv();
      config = message['config'];
      calibration = null;
      deps.post({ type: 'READY' });
    } catch (error) {
      fail('INIT_FAILED', describe(error, 'OpenCV.js failed to load'), { type: 'INIT' });
    }
  };

  const handleCalibrate = (message: Record<string, unknown>): void => {
    const request = { type: 'CALIBRATE' };
    if (!cv || !config) {
      fail('NOT_INITIALIZED', 'Worker is not initialized', request);
      return;
    }
    const corners = message['corners'];
    const width = message['width'];
    const height = message['height'];
    if (!isCalibrationCorners(corners) || !isFiniteNumber(width) || !isFiniteNumber(height)) {
      fail('INVALID_REQUEST', 'CALIBRATE requires corners, width and height', request);
      return;
    }
    const size = { width: config.normalizedBoardWidth, height: config.normalizedBoardHeight };
    const validation = validateCalibrationCorners(corners, { width, height });
    if (!validation.valid) {
      calibration = null;
      deps.post({
        type: 'CALIBRATION_RESULT',
        result: {
          valid: false,
          issues: validation.issues,
          normalizedWidth: size.width,
          normalizedHeight: size.height,
        },
      });
      return;
    }
    try {
      const transform = computePerspectiveTransform(cv, corners, size);
      calibration = { transform, size };
      deps.post({
        type: 'CALIBRATION_RESULT',
        result: {
          valid: true,
          issues: [],
          transform,
          normalizedWidth: size.width,
          normalizedHeight: size.height,
        },
      });
    } catch (error) {
      calibration = null;
      fail('CALIBRATION_FAILED', describe(error, 'Perspective transform failed'), request);
    }
  };

  const handleRectify = async (message: Record<string, unknown>): Promise<void> => {
    const frame = message['frame'];
    const frameId = message['frameId'];
    const request = {
      type: 'RECTIFY_FRAME',
      frameId: isNonEmptyString(frameId) ? frameId : undefined,
    };
    try {
      if (!isBitmapLike(frame) || !isNonEmptyString(frameId)) {
        fail('INVALID_REQUEST', 'RECTIFY_FRAME requires a frame bitmap and frameId', request);
        return;
      }
      if (!cv || !calibration) {
        fail(
          cv ? 'NOT_CALIBRATED' : 'NOT_INITIALIZED',
          'Calibrate before rectifying frames',
          request,
        );
        return;
      }
      const pixels = deps.readBitmap(frame);
      const rectified = warpPerspective(cv, pixels, calibration.transform, calibration.size);
      const image = await deps.createBitmap(rectified);
      deps.post({ type: 'RECTIFIED_FRAME', frameId, image }, [image]);
    } catch (error) {
      fail('RECTIFY_FAILED', describe(error, 'Rectification failed'), request);
    } finally {
      if (isBitmapLike(frame)) {
        frame.close();
      }
    }
  };

  return async (message: unknown): Promise<void> => {
    if (!isVisionWorkerRequestShape(message)) {
      fail('INVALID_REQUEST', 'Malformed message');
      return;
    }
    const request = message as unknown as Record<string, unknown>;
    switch (message.type) {
      case 'INIT':
        return handleInit(request);
      case 'CALIBRATE':
        return handleCalibrate(request);
      case 'RECTIFY_FRAME':
        return handleRectify(request);
      case 'RESET':
        calibration = null;
        return;
      case 'DISPOSE':
        calibration = null;
        config = null;
        cv = null;
        return;
      default:
        fail('INVALID_REQUEST', `Unknown message type "${message.type}"`);
    }
  };
}

function describe(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
