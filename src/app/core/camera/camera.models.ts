/**
 * Camera contracts (docs/execution-specification.md §9).
 */
export interface CameraDevice {
  readonly deviceId: string;
  readonly label: string;
}

/**
 * - `IDLE`: nothing requested yet, or access was never granted.
 * - `REQUESTING_PERMISSION`: `getUserMedia` is pending (the browser may be showing a prompt).
 * - `READY`: camera access has been granted at least once, but no stream is open.
 * - `STREAMING`: a live video stream is open.
 * - `ERROR`: the last operation failed; `error` explains why.
 */
export type CameraState = 'IDLE' | 'REQUESTING_PERMISSION' | 'READY' | 'STREAMING' | 'ERROR';

export interface CameraStatus {
  readonly state: CameraState;
  readonly error?: CameraError;
}

export type CameraErrorCode =
  'PERMISSION_DENIED' | 'NO_DEVICE' | 'DEVICE_BUSY' | 'UNSUPPORTED' | 'UNKNOWN';

export interface CameraError {
  readonly code: CameraErrorCode;
  /** User-facing message (pt-BR). Never contains stack traces. */
  readonly message: string;
}

export interface CameraServiceContract {
  listDevices(): Promise<readonly CameraDevice[]>;
  /** Never rejects: failures are reported through the status (`state: 'ERROR'`). */
  start(deviceId?: string): Promise<void>;
  stop(): void;
  getStatus(): CameraStatus;
}
