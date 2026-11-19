import { validateCalibrationCorners } from '../../domain/board/calibration';
import { Point2D, Size2D } from '../../domain/board/geometry';
import { Homography } from '../../domain/board/homography';
import { OpenCv } from '../../vision/opencv-loader';
import { computePerspectiveTransform, RgbaImage, warpPerspective } from '../../vision/perspective';
import {
  ClassifierConfig,
  ClassifierConfigError,
  resolveClassifierConfig,
} from '../../vision/recognition/classifier.config';
import { refineCorners, toGray } from '../../vision/calibration-refinement';
import { denoise } from '../../vision/recognition/denoise';
import { measureFrameQuality } from '../../vision/recognition/frame-quality';
import { recognizeBoard } from '../../vision/recognition/recognize-board';
import { awayFromCamera } from '../../vision/recognition/top-face';
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
  /** Wall-clock time for result timestamps (defaults to `Date.now`). */
  readonly now?: () => number;
}

interface ActiveCalibration {
  readonly transform: Homography;
  readonly size: Size2D;
  /** Direction in which tall pieces' tops are projected on the rectified board (G3). */
  readonly awayFromCamera: Point2D | null;
}

/**
 * Worker-side message handling, independent of the worker global scope so it can be
 * unit tested. Every received bitmap is closed; every failure is reported as `ERROR`.
 */
export function createVisionWorkerHandler(
  deps: VisionWorkerHandlerDependencies,
): (message: unknown) => Promise<void> {
  let config: VisionConfig | null = null;
  let classifier: ClassifierConfig | null = null;
  const now = deps.now ?? (() => Date.now());
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
    let resolved: ClassifierConfig;
    try {
      resolved = resolveClassifierConfig(message['config']);
    } catch (error) {
      const reason =
        error instanceof ClassifierConfigError ? error.message : 'invalid classifier config';
      fail('INVALID_REQUEST', `INIT: ${reason}`, { type: 'INIT' });
      return;
    }
    try {
      cv = await deps.loadOpenCv();
      config = message['config'];
      classifier = resolved;
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
      calibration = {
        transform,
        size,
        awayFromCamera: awayFromCamera(
          corners,
          (classifier as ClassifierConfig).shape.minViewObliquity,
        ),
      };
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

  /**
   * Shared path for frame requests: validates the payload, requires a calibration,
   * warps the frame, and always closes the received bitmap.
   */
  const handleFrame = async (
    type: 'RECTIFY_FRAME' | 'PROCESS_FRAME',
    message: Record<string, unknown>,
    use: (rectified: RgbaImage, frameId: string, cv: OpenCv) => Promise<void>,
  ): Promise<void> => {
    const frame = message['frame'];
    const frameId = message['frameId'];
    const request = { type, frameId: isNonEmptyString(frameId) ? frameId : undefined };
    try {
      if (!isBitmapLike(frame) || !isNonEmptyString(frameId)) {
        fail('INVALID_REQUEST', `${type} requires a frame bitmap and frameId`, request);
        return;
      }
      if (!cv || !calibration) {
        fail(cv ? 'NOT_CALIBRATED' : 'NOT_INITIALIZED', 'Calibrate before sending frames', request);
        return;
      }
      const pixels = deps.readBitmap(frame);
      const rectified = warpPerspective(cv, pixels, calibration.transform, calibration.size);
      await use(rectified, frameId, cv);
    } catch (error) {
      fail(
        type === 'RECTIFY_FRAME' ? 'RECTIFY_FAILED' : 'RECOGNITION_FAILED',
        describe(error, `${type} failed`),
        request,
      );
    } finally {
      if (isBitmapLike(frame)) {
        frame.close();
      }
    }
  };

  const handleRefine = async (message: Record<string, unknown>): Promise<void> => {
    const frame = message['frame'];
    const frameId = message['frameId'];
    const corners = message['corners'];
    const request = {
      type: 'REFINE_CALIBRATION',
      frameId: isNonEmptyString(frameId) ? frameId : undefined,
    };
    try {
      if (!isBitmapLike(frame) || !isNonEmptyString(frameId) || !isCalibrationCorners(corners)) {
        fail(
          'INVALID_REQUEST',
          'REFINE_CALIBRATION requires corners, a frame bitmap and frameId',
          request,
        );
        return;
      }
      if (!config) {
        fail('NOT_INITIALIZED', 'Worker is not initialized', request);
        return;
      }
      const result = refineCorners(toGray(deps.readBitmap(frame)), corners);
      deps.post({ type: 'CALIBRATION_REFINED', frameId, ...result });
    } catch (error) {
      fail('REFINE_FAILED', describe(error, 'Calibration refinement failed'), request);
    } finally {
      if (isBitmapLike(frame)) {
        frame.close();
      }
    }
  };

  const handleRectify = (message: Record<string, unknown>): Promise<void> =>
    handleFrame('RECTIFY_FRAME', message, async (rectified, frameId) => {
      const image = await deps.createBitmap(rectified);
      deps.post({ type: 'RECTIFIED_FRAME', frameId, image }, [image]);
    });

  const handleProcess = (message: Record<string, unknown>): Promise<void> =>
    handleFrame('PROCESS_FRAME', message, async (rectified, frameId, opencv) => {
      const thresholds = classifier as ClassifierConfig;
      // Sharpness is measured on the raw rectified image, before smoothing.
      const quality = measureFrameQuality(opencv, rectified);
      const smoothed = denoise(opencv, rectified, thresholds.shape.denoiseKernelSize);
      const { result, traces, frame } = recognizeBoard(smoothed, thresholds, {
        timestamp: now(),
        frameId,
        quality,
        awayFromCamera: calibration?.awayFromCamera ?? null,
      });
      const debugImage = message['debug'] === true ? await deps.createBitmap(smoothed) : undefined;
      deps.post(
        {
          type: 'RECOGNITION_RESULT',
          result,
          frameId,
          traces,
          frame,
          ...(debugImage ? { debugImage } : {}),
        },
        debugImage ? [debugImage] : [],
      );
    });

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
      case 'PROCESS_FRAME':
        return handleProcess(request);
      case 'REFINE_CALIBRATION':
        return handleRefine(request);
      case 'RESET':
        calibration = null;
        return;
      case 'DISPOSE':
        calibration = null;
        config = null;
        classifier = null;
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
