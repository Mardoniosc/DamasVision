/**
 * Deterministic test doubles for the camera APIs (`MediaDevices`, `MediaStream`,
 * `MediaStreamTrack`). jsdom implements none of them.
 *
 * They record every stream they hand out so tests can assert that no track is left live.
 */

export interface FakeDevice {
  readonly deviceId: string;
  readonly label: string;
}

export class FakeMediaStreamTrack extends EventTarget {
  readonly kind = 'video';
  readyState: MediaStreamTrackState = 'live';
  stopCalls = 0;

  constructor(readonly device: FakeDevice) {
    super();
  }

  stop(): void {
    this.stopCalls++;
    this.readyState = 'ended';
  }

  getSettings(): MediaTrackSettings {
    return { deviceId: this.device.deviceId, width: 1280, height: 720 };
  }

  /** Simulates the browser ending the track (device unplugged or permission revoked). */
  simulateEnded(): void {
    this.readyState = 'ended';
    this.dispatchEvent(new Event('ended'));
  }
}

export class FakeMediaStream {
  private static nextId = 1;
  readonly id = `fake-stream-${FakeMediaStream.nextId++}`;

  constructor(readonly tracks: readonly FakeMediaStreamTrack[]) {}

  getTracks(): FakeMediaStreamTrack[] {
    return [...this.tracks];
  }

  getVideoTracks(): FakeMediaStreamTrack[] {
    return this.tracks.filter((track) => track.kind === 'video');
  }

  get videoTrack(): FakeMediaStreamTrack {
    const [track] = this.tracks;
    if (!track) {
      throw new Error('stream has no track');
    }
    return track;
  }

  /** The fake typed as the DOM interface the production code expects. */
  asMediaStream(): MediaStream {
    return this as unknown as MediaStream;
  }
}

interface Deferred {
  readonly promise: Promise<void>;
  readonly release: () => void;
}

function deferred(): Deferred {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => (release = resolve));
  return { promise, release };
}

export class FakeMediaDevices extends EventTarget {
  /** Whether the user already granted camera access (labels and ids are hidden until then). */
  permissionGranted = false;
  readonly requests: MediaStreamConstraints[] = [];
  readonly streams: FakeMediaStream[] = [];

  private devices: FakeDevice[];
  private nextFailure: string | null = null;
  private gate: Deferred | null = null;

  constructor(devices: readonly FakeDevice[] = DEFAULT_FAKE_DEVICES) {
    super();
    this.devices = [...devices];
  }

  async enumerateDevices(): Promise<MediaDeviceInfo[]> {
    return this.devices.map(
      (device) =>
        ({
          deviceId: this.permissionGranted ? device.deviceId : '',
          groupId: '',
          kind: 'videoinput',
          label: this.permissionGranted ? device.label : '',
          toJSON: () => ({}),
        }) as MediaDeviceInfo,
    );
  }

  async getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream> {
    this.requests.push(constraints);
    const gate = this.gate;
    this.gate = null;
    if (gate) {
      await gate.promise;
    }

    const failure = this.nextFailure;
    this.nextFailure = null;
    if (failure) {
      throw new DOMException(`fake ${failure}`, failure);
    }

    const device = this.resolveDevice(constraints);
    if (!device) {
      throw new DOMException('fake device not found', 'NotFoundError');
    }
    this.permissionGranted = true;
    const stream = new FakeMediaStream([new FakeMediaStreamTrack(device)]);
    this.streams.push(stream);
    return stream.asMediaStream();
  }

  /** Makes the next `getUserMedia` call reject with a `DOMException` of this name. */
  failNextWith(errorName: string): void {
    this.nextFailure = errorName;
  }

  /** Holds the next `getUserMedia` call until the returned function is called. */
  holdNextRequest(): () => void {
    const gate = deferred();
    this.gate = gate;
    return gate.release;
  }

  setDevices(devices: readonly FakeDevice[]): void {
    this.devices = [...devices];
    this.dispatchEvent(new Event('devicechange'));
  }

  /** Tracks that were handed out and never stopped: must be empty after cleanup. */
  liveTracks(): FakeMediaStreamTrack[] {
    return this.streams
      .flatMap((stream) => stream.getTracks())
      .filter((t) => t.readyState === 'live');
  }

  get lastStream(): FakeMediaStream {
    const stream = this.streams.at(-1);
    if (!stream) {
      throw new Error('no stream was created');
    }
    return stream;
  }

  asMediaDevices(): MediaDevices {
    return this as unknown as MediaDevices;
  }

  private resolveDevice(constraints: MediaStreamConstraints): FakeDevice | undefined {
    const video = constraints.video;
    const requested =
      typeof video === 'object' &&
      typeof video.deviceId === 'object' &&
      !Array.isArray(video.deviceId)
        ? video.deviceId.exact
        : undefined;
    if (typeof requested === 'string') {
      return this.devices.find((device) => device.deviceId === requested);
    }
    return this.devices[0];
  }
}

export const DEFAULT_FAKE_DEVICES: readonly FakeDevice[] = [
  { deviceId: 'cam-front', label: 'Front Camera' },
  { deviceId: 'cam-rear', label: 'Rear Camera' },
];
