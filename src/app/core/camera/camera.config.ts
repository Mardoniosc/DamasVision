import { InjectionToken } from '@angular/core';

export interface CameraConfig {
  /** Requested capture resolution; the browser may deliver a different one. */
  readonly idealWidth: number;
  readonly idealHeight: number;
  /** Used only when no specific device is selected. `environment` = rear camera on phones. */
  readonly preferredFacingMode: 'environment' | 'user';
}

export const DEFAULT_CAMERA_CONFIG: CameraConfig = {
  idealWidth: 1280,
  idealHeight: 720,
  preferredFacingMode: 'environment',
};

export const CAMERA_CONFIG = new InjectionToken<CameraConfig>('CAMERA_CONFIG', {
  providedIn: 'root',
  factory: () => DEFAULT_CAMERA_CONFIG,
});

/**
 * Browser camera capabilities. Isolated behind a token so the camera service can be
 * tested with a fake `MediaDevices` and so no other module reads `navigator.mediaDevices`.
 */
export interface CameraEnvironment {
  /** `null` when the browser (or an insecure context) does not expose camera APIs. */
  readonly mediaDevices: MediaDevices | null;
  readonly isSecureContext: boolean;
}

export function detectCameraEnvironment(): CameraEnvironment {
  if (typeof navigator === 'undefined') {
    return { mediaDevices: null, isSecureContext: false };
  }
  const mediaDevices = navigator.mediaDevices as MediaDevices | undefined;
  const supported =
    mediaDevices !== undefined &&
    typeof mediaDevices.getUserMedia === 'function' &&
    typeof mediaDevices.enumerateDevices === 'function';

  return {
    mediaDevices: supported ? mediaDevices : null,
    isSecureContext: globalThis.isSecureContext === true,
  };
}

export const CAMERA_ENVIRONMENT = new InjectionToken<CameraEnvironment>('CAMERA_ENVIRONMENT', {
  providedIn: 'root',
  factory: detectCameraEnvironment,
});
