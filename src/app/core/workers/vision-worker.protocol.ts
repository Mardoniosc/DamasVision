import { CalibrationCorners, CalibrationIssue, CORNER_NAMES } from '../../domain/board/calibration';
import { Homography } from '../../domain/board/homography';
import { VisionConfig } from '../../vision/vision.config';

/**
 * Vision worker protocol (docs/execution-specification.md §9), as implemented in E2.
 * `PROCESS_FRAME` / `RECOGNITION_RESULT` are added with recognition in E3.
 * `RECTIFY_FRAME` / `RECTIFIED_FRAME` and `ERROR.requestType` are extensions (ADR-016).
 */
export type VisionWorkerRequest =
  | { readonly type: 'INIT'; readonly config: VisionConfig }
  | {
      readonly type: 'CALIBRATE';
      /** Canonical corners (orientation already applied), in source pixels. */
      readonly corners: CalibrationCorners;
      readonly width: number;
      readonly height: number;
    }
  | { readonly type: 'RECTIFY_FRAME'; readonly frame: ImageBitmap; readonly frameId: string }
  | { readonly type: 'RESET' }
  | { readonly type: 'DISPOSE' };

export interface CalibrationResult {
  readonly valid: boolean;
  readonly issues: readonly CalibrationIssue[];
  /** Image → normalized board transform (row-major 3×3); present when valid. */
  readonly transform?: Homography;
  readonly normalizedWidth: number;
  readonly normalizedHeight: number;
}

export type VisionWorkerErrorCode =
  | 'INVALID_REQUEST'
  | 'INIT_FAILED'
  | 'NOT_INITIALIZED'
  | 'NOT_CALIBRATED'
  | 'CALIBRATION_FAILED'
  | 'RECTIFY_FAILED';

export type VisionWorkerResponse =
  | { readonly type: 'READY' }
  | { readonly type: 'CALIBRATION_RESULT'; readonly result: CalibrationResult }
  | { readonly type: 'RECTIFIED_FRAME'; readonly frameId: string; readonly image: ImageBitmap }
  | {
      readonly type: 'ERROR';
      readonly code: VisionWorkerErrorCode;
      readonly message: string;
      readonly frameId?: string;
      readonly requestType?: VisionWorkerRequest['type'];
    };

// ---------------------------------------------------------------------------
// Payload validation (spec §9: "Validate payloads")
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isPoint(value: unknown): boolean {
  return isRecord(value) && isFiniteNumber(value['x']) && isFiniteNumber(value['y']);
}

export function isCalibrationCorners(value: unknown): value is CalibrationCorners {
  return isRecord(value) && CORNER_NAMES.every((name) => isPoint(value[name]));
}

/** Structural check that does not depend on `ImageBitmap` existing in the realm. */
function isBitmapLike(value: unknown): value is ImageBitmap {
  return (
    isRecord(value) &&
    isFiniteNumber(value['width']) &&
    isFiniteNumber(value['height']) &&
    typeof value['close'] === 'function'
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

export function isVisionWorkerRequestShape(value: unknown): value is { type: string } {
  return isRecord(value) && typeof value['type'] === 'string';
}

export function isHomography(value: unknown): value is Homography {
  return Array.isArray(value) && value.length === 9 && value.every(isFiniteNumber);
}

export function isVisionWorkerResponse(value: unknown): value is VisionWorkerResponse {
  if (!isRecord(value)) {
    return false;
  }
  switch (value['type']) {
    case 'READY':
      return true;
    case 'CALIBRATION_RESULT': {
      const result = value['result'];
      return (
        isRecord(result) &&
        typeof result['valid'] === 'boolean' &&
        Array.isArray(result['issues']) &&
        isFiniteNumber(result['normalizedWidth']) &&
        isFiniteNumber(result['normalizedHeight']) &&
        (result['transform'] === undefined || isHomography(result['transform']))
      );
    }
    case 'RECTIFIED_FRAME':
      return isNonEmptyString(value['frameId']) && isBitmapLike(value['image']);
    case 'ERROR':
      return typeof value['code'] === 'string' && typeof value['message'] === 'string';
    default:
      return false;
  }
}

export { isBitmapLike, isFiniteNumber, isNonEmptyString };
