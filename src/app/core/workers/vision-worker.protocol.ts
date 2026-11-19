import { CalibrationCorners, CalibrationIssue, CORNER_NAMES } from '../../domain/board/calibration';
import { Homography } from '../../domain/board/homography';
import { BoardRecognitionResult, isBoardObservation } from '../../domain/board/observation';
import { isObservedPiece } from '../../domain/board/piece';
import { VisionConfig } from '../../vision/vision.config';

/**
 * Vision worker protocol (docs/execution-specification.md §9).
 * `RECTIFY_FRAME` / `RECTIFIED_FRAME` and `ERROR.requestType` are extensions (ADR-018).
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
  | { readonly type: 'PROCESS_FRAME'; readonly frame: ImageBitmap; readonly frameId: string }
  | {
      /** Extension (ADR-027): snap canonical corners to the square borders in `frame`. */
      readonly type: 'REFINE_CALIBRATION';
      readonly corners: CalibrationCorners;
      readonly frame: ImageBitmap;
      readonly frameId: string;
    }
  | { readonly type: 'RESET' }
  | { readonly type: 'DISPOSE' };

/** Why a square got its confidence (the weakest decision); for UI hints and samples. */
export type SquareReason = 'OCCLUSION' | 'BOARD_CONTRAST' | 'PRESENCE' | 'COLOR' | 'KING' | 'NONE';

export interface SquareDiagnostic {
  readonly squareIndex: number;
  readonly reason: SquareReason;
  readonly foregroundRatio: number;
  readonly occluded: boolean;
}

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
  | 'RECTIFY_FAILED'
  | 'RECOGNITION_FAILED'
  | 'REFINE_FAILED';

export type VisionWorkerResponse =
  | { readonly type: 'READY' }
  | { readonly type: 'CALIBRATION_RESULT'; readonly result: CalibrationResult }
  | { readonly type: 'RECTIFIED_FRAME'; readonly frameId: string; readonly image: ImageBitmap }
  | {
      readonly type: 'CALIBRATION_REFINED';
      readonly frameId: string;
      readonly corners: CalibrationCorners;
      readonly scoreBefore: number;
      readonly scoreAfter: number;
      readonly maxShiftPx: number;
    }
  | {
      readonly type: 'RECOGNITION_RESULT';
      readonly result: BoardRecognitionResult;
      readonly frameId: string;
      /** Extension (ADR-028): per playable square diagnostics. */
      readonly diagnostics?: readonly SquareDiagnostic[];
    }
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

const RECOGNITION_STATUSES = ['SUCCESS', 'UNCERTAIN', 'ERROR'];

export function isBoardRecognitionResult(value: unknown): value is BoardRecognitionResult {
  if (!isRecord(value)) {
    return false;
  }
  const squares = value['squares'];
  const warnings = value['warnings'];
  return (
    isBoardObservation(value['board']) &&
    Array.isArray(squares) &&
    squares.every(
      (square) =>
        isRecord(square) &&
        isFiniteNumber(square['squareIndex']) &&
        isObservedPiece(square['piece']) &&
        isFiniteNumber(square['confidence']),
    ) &&
    typeof value['status'] === 'string' &&
    RECOGNITION_STATUSES.includes(value['status']) &&
    isFiniteNumber(value['overallConfidence']) &&
    Array.isArray(warnings) &&
    warnings.every(
      (warning) =>
        isRecord(warning) &&
        typeof warning['code'] === 'string' &&
        typeof warning['message'] === 'string',
    ) &&
    isFiniteNumber(value['timestamp'])
  );
}

const SQUARE_REASONS: readonly string[] = [
  'OCCLUSION',
  'BOARD_CONTRAST',
  'PRESENCE',
  'COLOR',
  'KING',
  'NONE',
];

export function isSquareDiagnostics(value: unknown): value is readonly SquareDiagnostic[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        isRecord(item) &&
        isFiniteNumber(item['squareIndex']) &&
        typeof item['reason'] === 'string' &&
        SQUARE_REASONS.includes(item['reason']) &&
        isFiniteNumber(item['foregroundRatio']) &&
        typeof item['occluded'] === 'boolean',
    )
  );
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
    case 'CALIBRATION_REFINED':
      return (
        isNonEmptyString(value['frameId']) &&
        isCalibrationCorners(value['corners']) &&
        isFiniteNumber(value['scoreBefore']) &&
        isFiniteNumber(value['scoreAfter']) &&
        isFiniteNumber(value['maxShiftPx'])
      );
    case 'RECOGNITION_RESULT':
      return (
        isNonEmptyString(value['frameId']) &&
        isBoardRecognitionResult(value['result']) &&
        (value['diagnostics'] === undefined || isSquareDiagnostics(value['diagnostics']))
      );
    case 'ERROR':
      return typeof value['code'] === 'string' && typeof value['message'] === 'string';
    default:
      return false;
  }
}

export { isBitmapLike, isFiniteNumber, isNonEmptyString };
