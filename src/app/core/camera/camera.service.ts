import { computed, DestroyRef, inject, Injectable, signal } from '@angular/core';
import { CAMERA_CONFIG, CAMERA_ENVIRONMENT } from './camera.config';
import { cameraDisconnectedError, mapCameraError, unsupportedCameraError } from './camera-errors';
import { CameraDevice, CameraServiceContract, CameraStatus } from './camera.models';

/**
 * Owns camera state: device discovery, permission, stream lifecycle and cleanup.
 *
 * Leak guarantees (Gate G1):
 * - At most one stream is open; it is stopped before another is requested.
 * - A stream that resolves after a newer `start()`/`stop()` is stopped immediately.
 * - The stream is released when its track ends (device unplugged) and when the
 *   service is destroyed.
 */
@Injectable({ providedIn: 'root' })
export class CameraService implements CameraServiceContract {
  private readonly environment = inject(CAMERA_ENVIRONMENT);
  private readonly config = inject(CAMERA_CONFIG);
  private readonly mediaDevices = this.environment.mediaDevices;

  private readonly statusState = signal<CameraStatus>(this.idleStatus());
  private readonly devicesState = signal<readonly CameraDevice[]>([]);
  private readonly devicesRequirePermissionState = signal(false);
  private readonly streamState = signal<MediaStream | null>(null);
  private readonly selectedDeviceIdState = signal<string | null>(null);

  readonly status = this.statusState.asReadonly();
  readonly devices = this.devicesState.asReadonly();
  /** True while device ids/labels are hidden because camera access was not granted yet. */
  readonly devicesRequirePermission = this.devicesRequirePermissionState.asReadonly();
  readonly stream = this.streamState.asReadonly();
  readonly selectedDeviceId = this.selectedDeviceIdState.asReadonly();
  readonly isStreaming = computed(() => this.status().state === 'STREAMING');
  readonly isSupported = this.mediaDevices !== null;

  /** Incremented by every start/stop; lets late `getUserMedia` results detect they are stale. */
  private requestId = 0;
  private accessGranted = false;
  private detachTrackListener: (() => void) | null = null;

  constructor() {
    const mediaDevices = this.mediaDevices;
    if (mediaDevices) {
      const onDeviceChange = (): void => void this.listDevices();
      mediaDevices.addEventListener('devicechange', onDeviceChange);
      inject(DestroyRef).onDestroy(() => {
        mediaDevices.removeEventListener('devicechange', onDeviceChange);
        this.stop();
      });
    }
  }

  getStatus(): CameraStatus {
    return this.statusState();
  }

  async listDevices(): Promise<readonly CameraDevice[]> {
    const mediaDevices = this.mediaDevices;
    if (!mediaDevices) {
      return [];
    }

    let infos: MediaDeviceInfo[];
    try {
      infos = await mediaDevices.enumerateDevices();
    } catch (error) {
      if (!this.isStreaming()) {
        this.statusState.set({ state: 'ERROR', error: mapCameraError(error) });
      }
      return this.devicesState();
    }

    const videoInputs = infos.filter((info) => info.kind === 'videoinput');
    // Before permission is granted browsers hide labels and may also hide device ids.
    const requirePermission = videoInputs.some((info) => info.deviceId === '' || info.label === '');
    const devices = videoInputs
      .filter((info) => info.deviceId !== '')
      .map((info, index) => ({
        deviceId: info.deviceId,
        label: info.label || `Câmera ${index + 1}`,
      }));

    this.devicesState.set(devices);
    this.devicesRequirePermissionState.set(requirePermission);

    if (videoInputs.length > 0 && !requirePermission) {
      this.accessGranted = true;
      if (this.statusState().state === 'IDLE') {
        this.statusState.set({ state: 'READY' });
      }
    }
    return devices;
  }

  async start(deviceId?: string): Promise<void> {
    const mediaDevices = this.mediaDevices;
    if (!mediaDevices) {
      this.statusState.set(this.idleStatus());
      return;
    }

    const request = ++this.requestId;
    if (deviceId !== undefined) {
      this.selectedDeviceIdState.set(deviceId);
    }
    // Release first: many devices (especially phones) cannot be opened twice.
    this.releaseStream();
    this.statusState.set({ state: 'REQUESTING_PERMISSION' });

    let stream: MediaStream;
    try {
      stream = await mediaDevices.getUserMedia(this.buildConstraints(deviceId));
    } catch (error) {
      if (request === this.requestId) {
        this.statusState.set({ state: 'ERROR', error: mapCameraError(error) });
      }
      return;
    }

    if (request !== this.requestId) {
      stopStream(stream);
      return;
    }

    const [track] = stream.getVideoTracks();
    if (!track) {
      stopStream(stream);
      this.statusState.set({ state: 'ERROR', error: mapCameraError({ name: 'NotFoundError' }) });
      return;
    }

    this.accessGranted = true;
    this.attachStream(stream, track, deviceId);
    this.statusState.set({ state: 'STREAMING' });
    // Labels and ids become available once permission is granted.
    await this.listDevices();
  }

  /** Remembers the device and switches to it immediately when a stream is open or pending. */
  async selectDevice(deviceId: string): Promise<void> {
    this.selectedDeviceIdState.set(deviceId);
    const { state } = this.statusState();
    if (state === 'STREAMING' || state === 'REQUESTING_PERMISSION') {
      await this.start(deviceId);
    }
  }

  stop(): void {
    this.requestId++;
    this.releaseStream();
    this.statusState.set(
      this.mediaDevices ? { state: this.accessGranted ? 'READY' : 'IDLE' } : this.idleStatus(),
    );
  }

  private attachStream(stream: MediaStream, track: MediaStreamTrack, requestedId?: string): void {
    const onEnded = (): void => {
      if (this.streamState() !== stream) {
        return;
      }
      this.requestId++;
      this.releaseStream();
      this.statusState.set({ state: 'ERROR', error: cameraDisconnectedError() });
    };
    track.addEventListener('ended', onEnded);
    this.detachTrackListener = () => track.removeEventListener('ended', onEnded);

    this.streamState.set(stream);
    this.selectedDeviceIdState.set(track.getSettings().deviceId ?? requestedId ?? null);
  }

  private releaseStream(): void {
    this.detachTrackListener?.();
    this.detachTrackListener = null;
    const stream = this.streamState();
    if (stream) {
      stopStream(stream);
      this.streamState.set(null);
    }
  }

  private buildConstraints(deviceId?: string): MediaStreamConstraints {
    const size: MediaTrackConstraints = {
      width: { ideal: this.config.idealWidth },
      height: { ideal: this.config.idealHeight },
    };
    const video: MediaTrackConstraints = deviceId
      ? { ...size, deviceId: { exact: deviceId } }
      : { ...size, facingMode: { ideal: this.config.preferredFacingMode } };
    return { video, audio: false };
  }

  private idleStatus(): CameraStatus {
    return this.environment.mediaDevices
      ? { state: 'IDLE' }
      : { state: 'ERROR', error: unsupportedCameraError(this.environment.isSecureContext) };
  }
}

function stopStream(stream: MediaStream): void {
  for (const track of stream.getTracks()) {
    track.stop();
  }
}
