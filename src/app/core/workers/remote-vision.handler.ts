import { CalibrationCorners } from '../../domain/board/calibration';
import { isVisionConfig, VisionConfig } from '../../vision/vision.config';
import {
  isRemoteVisionConfigMessage,
  RemoteVisionTuning,
  VISION_CONTRACT_VERSION,
} from './vision-provider';
import {
  isBitmapLike,
  isCalibrationCorners,
  isFiniteNumber,
  isNonEmptyString,
  isVisionWorkerRequestShape,
  isVisionWorkerResponse,
  VisionWorkerErrorCode,
  VisionWorkerRequest,
  VisionWorkerResponse,
} from './vision-worker.protocol';

export interface RemoteVisionHandlerDependencies {
  readonly fetch: (url: string, init: RequestInit) => Promise<Response>;
  readonly post: (message: VisionWorkerResponse, transfer?: Transferable[]) => void;
  /** Encodes a bitmap (does not close it). */
  readonly encode: (
    bitmap: ImageBitmap,
    type: 'image/jpeg' | 'image/png',
    quality: number,
  ) => Promise<Blob>;
  readonly decode: (blob: Blob) => Promise<ImageBitmap>;
  /** Ends the worker once its session is closed (after DISPOSE). */
  readonly closeSelf?: () => void;
}

type RequestType = VisionWorkerRequest['type'];

/** A failed service call, already mapped to a protocol error code. */
class ServiceCallError extends Error {
  constructor(
    readonly code: VisionWorkerErrorCode,
    message: string,
    /** The service's own code (`NOT_INITIALIZED`, `BUSY`...), when it answered. */
    readonly serviceCode?: string,
  ) {
    super(message);
  }
}

const PROTOCOL_CODES = new Set<string>([
  'INVALID_REQUEST',
  'INIT_FAILED',
  'NOT_INITIALIZED',
  'NOT_CALIBRATED',
  'CALIBRATION_FAILED',
  'RECTIFY_FAILED',
  'RECOGNITION_FAILED',
  'REFINE_FAILED',
]);

/** Service transport codes → protocol codes. A slow service counts as unavailable. */
function protocolCode(serviceCode: string, fallback: VisionWorkerErrorCode): VisionWorkerErrorCode {
  if (PROTOCOL_CODES.has(serviceCode)) return serviceCode as VisionWorkerErrorCode;
  if (serviceCode === 'TIMEOUT') return 'SERVICE_UNAVAILABLE';
  if (serviceCode === 'PAYLOAD_TOO_LARGE' || serviceCode === 'UNSUPPORTED_MEDIA') {
    return 'INVALID_REQUEST';
  }
  return fallback;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToBlob(value: string, type: string): Blob {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type });
}

interface SessionState {
  readonly serviceUrl: string;
  readonly tuning: RemoteVisionTuning;
  config: VisionConfig | null;
  sessionId: string | null;
  /** Last valid calibration, replayed when the service lost the session (restart, expiry). */
  calibration: { corners: CalibrationCorners; width: number; height: number } | null;
}

/**
 * Remote side of the vision-worker protocol (G3.1, ADR-042): the same requests and
 * responses as `vision-worker.handler.ts`, answered by the local Python service over HTTP.
 * Runs inside `remote-vision.worker.ts`, so JPEG encoding and parsing stay off the main
 * thread. Every received bitmap is closed; every response is checked with the protocol
 * validators before it is posted; every failure becomes an `ERROR` message.
 */
export function createRemoteVisionHandler(
  deps: RemoteVisionHandlerDependencies,
): (message: unknown) => Promise<void> {
  let state: SessionState | null = null;

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
      ...(request?.type ? { requestType: request.type as RequestType } : {}),
    });
  };

  const call = async (
    path: string,
    init: RequestInit,
    timeoutMs: number,
    fallback: VisionWorkerErrorCode,
  ): Promise<Response> => {
    const current = state as SessionState;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await deps.fetch(`${current.serviceUrl}${path}`, {
        ...init,
        signal: controller.signal,
      });
    } catch {
      throw new ServiceCallError(
        'SERVICE_UNAVAILABLE',
        `The local vision service at ${current.serviceUrl} did not answer`,
      );
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) {
      let body: { code?: unknown; message?: unknown } = {};
      try {
        body = (await response.json()) as typeof body;
      } catch {
        // Not a service error body.
      }
      const serviceCode = typeof body.code === 'string' ? body.code : `HTTP_${response.status}`;
      const message = typeof body.message === 'string' ? body.message : response.statusText;
      throw new ServiceCallError(protocolCode(serviceCode, fallback), message, serviceCode);
    }
    return response;
  };

  const json = async (response: Response): Promise<Record<string, unknown>> => {
    try {
      const value: unknown = await response.json();
      if (typeof value === 'object' && value !== null) return value as Record<string, unknown>;
    } catch {
      // handled below
    }
    throw new ServiceCallError('INVALID_REQUEST', 'The service answered with invalid JSON');
  };

  const createSession = async (): Promise<void> => {
    const current = state as SessionState;
    const response = await call(
      '/v1/sessions',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: current.config }),
      },
      current.tuning.requestTimeoutMs,
      'INIT_FAILED',
    );
    const body = await json(response);
    if (!isNonEmptyString(body['sessionId'])) {
      throw new ServiceCallError('INIT_FAILED', 'The service did not return a session');
    }
    current.sessionId = body['sessionId'];
  };

  const putCalibration = async (calibration: NonNullable<SessionState['calibration']>) => {
    const current = state as SessionState;
    return json(
      await call(
        `/v1/sessions/${current.sessionId}/calibration`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(calibration),
        },
        current.tuning.requestTimeoutMs,
        'CALIBRATION_FAILED',
      ),
    );
  };

  /** Runs a session call; when the service lost the session, recreates it once and retries. */
  const withSession = async <T>(operation: () => Promise<T>): Promise<T> => {
    try {
      return await operation();
    } catch (error) {
      if (!(error instanceof ServiceCallError) || error.serviceCode !== 'NOT_INITIALIZED')
        throw error;
      await createSession();
      const calibration = (state as SessionState).calibration;
      if (calibration) await putCalibration(calibration);
      return operation();
    }
  };

  const ready = (): SessionState | null => (state?.config && state.sessionId ? state : null);

  const report = (
    error: unknown,
    fallback: VisionWorkerErrorCode,
    request: { type: string; frameId?: string },
  ) => {
    if (error instanceof ServiceCallError) {
      fail(error.code, error.message, request);
    } else {
      fail(
        fallback,
        error instanceof Error && error.message ? error.message : `${request.type} failed`,
        request,
      );
    }
  };

  const handleInit = async (message: Record<string, unknown>): Promise<void> => {
    const request = { type: 'INIT' };
    if (!state) {
      fail('INIT_FAILED', 'The remote vision worker was not configured', request);
      return;
    }
    if (!isVisionConfig(message['config'])) {
      fail('INVALID_REQUEST', 'INIT requires a valid VisionConfig', request);
      return;
    }
    try {
      const health = await json(
        await call('/v1/health', { method: 'GET' }, state.tuning.healthTimeoutMs, 'INIT_FAILED'),
      );
      if (health['contractVersion'] !== VISION_CONTRACT_VERSION) {
        fail(
          'INIT_FAILED',
          `The service speaks contract v${String(health['contractVersion'])}; this app needs v${VISION_CONTRACT_VERSION}`,
          request,
        );
        return;
      }
      if (state.sessionId) void closeSession(state);
      state.config = message['config'];
      state.sessionId = null;
      state.calibration = null;
      await createSession();
      deps.post({ type: 'READY' });
    } catch (error) {
      report(error, 'INIT_FAILED', request);
    }
  };

  const handleCalibrate = async (message: Record<string, unknown>): Promise<void> => {
    const request = { type: 'CALIBRATE' };
    const current = ready();
    if (!current) {
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
    const calibration = { corners, width, height };
    try {
      const result = await withSession(() => putCalibration(calibration));
      const response = { type: 'CALIBRATION_RESULT', result } as const;
      if (!isVisionWorkerResponse(response)) {
        fail('CALIBRATION_FAILED', 'The service returned an invalid calibration result', request);
        return;
      }
      current.calibration = response.result.valid ? calibration : null;
      deps.post(response);
    } catch (error) {
      current.calibration = null;
      report(error, 'CALIBRATION_FAILED', request);
    }
  };

  /** Encodes a received frame, always closing the bitmap. */
  const encodeFrame = async (
    frame: ImageBitmap,
    type: 'image/jpeg' | 'image/png',
    quality: number,
  ): Promise<Blob> => {
    try {
      return await deps.encode(frame, type, quality);
    } finally {
      frame.close();
    }
  };

  const handleRectify = async (message: Record<string, unknown>): Promise<void> => {
    const frame = message['frame'];
    const frameId = message['frameId'];
    const request = {
      type: 'RECTIFY_FRAME',
      frameId: isNonEmptyString(frameId) ? frameId : undefined,
    };
    if (!isBitmapLike(frame) || !isNonEmptyString(frameId)) {
      if (isBitmapLike(frame)) frame.close();
      fail('INVALID_REQUEST', 'RECTIFY_FRAME requires a frame bitmap and frameId', request);
      return;
    }
    const current = ready();
    if (!current) {
      frame.close();
      fail('NOT_INITIALIZED', 'Worker is not initialized', request);
      return;
    }
    try {
      const body = await encodeFrame(frame, 'image/jpeg', current.tuning.jpegQuality);
      const response = await withSession(() =>
        call(
          `/v1/sessions/${current.sessionId}/rectify`,
          { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body },
          current.tuning.requestTimeoutMs,
          'RECTIFY_FAILED',
        ),
      );
      const image = await deps.decode(await response.blob());
      deps.post({ type: 'RECTIFIED_FRAME', frameId, image }, [image]);
    } catch (error) {
      report(error, 'RECTIFY_FAILED', request);
    }
  };

  const handleProcess = async (message: Record<string, unknown>): Promise<void> => {
    const frame = message['frame'];
    const frameId = message['frameId'];
    const request = {
      type: 'PROCESS_FRAME',
      frameId: isNonEmptyString(frameId) ? frameId : undefined,
    };
    if (!isBitmapLike(frame) || !isNonEmptyString(frameId)) {
      if (isBitmapLike(frame)) frame.close();
      fail('INVALID_REQUEST', 'PROCESS_FRAME requires a frame bitmap and frameId', request);
      return;
    }
    const current = ready();
    if (!current) {
      frame.close();
      fail('NOT_INITIALIZED', 'Worker is not initialized', request);
      return;
    }
    const debug = message['debug'] === true;
    const bitmaps: ImageBitmap[] = [];
    try {
      const body = await encodeFrame(frame, 'image/jpeg', current.tuning.jpegQuality);
      const payload = await json(
        await withSession(() =>
          call(
            `/v1/sessions/${current.sessionId}/frames?debug=${debug}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'image/jpeg', 'X-Frame-Id': frameId },
              body,
            },
            current.tuning.requestTimeoutMs,
            'RECOGNITION_FAILED',
          ),
        ),
      );
      const decodeOptional = async (key: string, type: string) => {
        const value = payload[key];
        if (!debug || typeof value !== 'string') return undefined;
        const bitmap = await deps.decode(base64ToBlob(value, type));
        bitmaps.push(bitmap);
        return bitmap;
      };
      const debugImage = await decodeOptional('debugImage', 'image/jpeg');
      const foregroundMask = await decodeOptional('foregroundMask', 'image/png');
      const response = {
        type: 'RECOGNITION_RESULT',
        frameId,
        result: payload['result'],
        traces: payload['traces'],
        frame: payload['frame'],
        ...(debugImage ? { debugImage } : {}),
        ...(foregroundMask ? { foregroundMask } : {}),
      };
      // The observation is untrusted: it must pass the app's own contract checks.
      if (payload['frameId'] !== frameId || !isVisionWorkerResponse(response)) {
        throw new ServiceCallError(
          'RECOGNITION_FAILED',
          'The service returned an invalid observation',
        );
      }
      deps.post(response, [...bitmaps]);
      bitmaps.length = 0;
    } catch (error) {
      report(error, 'RECOGNITION_FAILED', request);
    } finally {
      for (const bitmap of bitmaps) bitmap.close();
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
    if (!isBitmapLike(frame) || !isNonEmptyString(frameId) || !isCalibrationCorners(corners)) {
      if (isBitmapLike(frame)) frame.close();
      fail(
        'INVALID_REQUEST',
        'REFINE_CALIBRATION requires corners, a frame bitmap and frameId',
        request,
      );
      return;
    }
    const current = ready();
    if (!current) {
      frame.close();
      fail('NOT_INITIALIZED', 'Worker is not initialized', request);
      return;
    }
    try {
      // Lossless: the adjustment measures grid-line contrast to sub-pixel precision.
      const png = await encodeFrame(frame, 'image/png', 1);
      const image = bytesToBase64(new Uint8Array(await png.arrayBuffer()));
      const body = await json(
        await withSession(() =>
          call(
            `/v1/sessions/${current.sessionId}/calibration/refine`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ corners, image }),
            },
            current.tuning.refineTimeoutMs,
            'REFINE_FAILED',
          ),
        ),
      );
      const response = { type: 'CALIBRATION_REFINED', frameId, ...body };
      if (!isVisionWorkerResponse(response)) {
        throw new ServiceCallError('REFINE_FAILED', 'The service returned an invalid refinement');
      }
      deps.post(response);
    } catch (error) {
      report(error, 'REFINE_FAILED', request);
    }
  };

  const closeSession = async (current: SessionState): Promise<void> => {
    const id = current.sessionId;
    if (!id) return;
    try {
      await deps.fetch(`${current.serviceUrl}/v1/sessions/${id}`, {
        method: 'DELETE',
        keepalive: true,
      });
    } catch {
      // Best effort: the service expires idle sessions on its own.
    }
  };

  return async (message: unknown): Promise<void> => {
    if (isRemoteVisionConfigMessage(message)) {
      state = {
        serviceUrl: message.serviceUrl,
        tuning: message.tuning,
        config: null,
        sessionId: null,
        calibration: null,
      };
      return;
    }
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
      case 'RESET': {
        const current = ready();
        if (current) {
          current.calibration = null;
          void deps
            .fetch(`${current.serviceUrl}/v1/sessions/${current.sessionId}/calibration`, {
              method: 'DELETE',
            })
            .catch(() => undefined);
        }
        return;
      }
      case 'DISPOSE': {
        const current = state;
        if (current) {
          await closeSession(current);
          current.sessionId = null;
          current.config = null;
          current.calibration = null;
        }
        deps.closeSelf?.();
        return;
      }
      default: {
        const frame = request['frame'];
        if (isBitmapLike(frame)) frame.close();
        fail('INVALID_REQUEST', `Unknown message type "${message.type}"`);
      }
    }
  };
}
