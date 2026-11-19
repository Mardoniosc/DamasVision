import { TestBed } from '@angular/core/testing';
import { FakeMediaDevices } from '../../../../tests/fixtures/fake-media-devices';
import { CAMERA_ENVIRONMENT, CameraEnvironment } from './camera.config';
import { CameraService } from './camera.service';

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('CameraService', () => {
  let devices: FakeMediaDevices;

  function setup(environment?: CameraEnvironment): CameraService {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: CAMERA_ENVIRONMENT,
          useValue: environment ?? {
            mediaDevices: devices.asMediaDevices(),
            isSecureContext: true,
          },
        },
      ],
    });
    return TestBed.inject(CameraService);
  }

  beforeEach(() => {
    devices = new FakeMediaDevices();
  });

  describe('unsupported browser', () => {
    it('reports UNSUPPORTED immediately and never throws', async () => {
      const camera = setup({ mediaDevices: null, isSecureContext: true });

      expect(camera.isSupported).toBe(false);
      expect(camera.getStatus()).toMatchObject({ state: 'ERROR', error: { code: 'UNSUPPORTED' } });
      await expect(camera.start()).resolves.toBeUndefined();
      await expect(camera.listDevices()).resolves.toEqual([]);
      camera.stop();
      expect(camera.getStatus().error?.code).toBe('UNSUPPORTED');
    });

    it('explains that an insecure context blocks the camera', () => {
      const camera = setup({ mediaDevices: null, isSecureContext: false });

      expect(camera.getStatus().error?.message).toContain('HTTPS');
    });
  });

  describe('device discovery (E1-T01)', () => {
    it('hides devices until permission is granted', async () => {
      const camera = setup();

      const listed = await camera.listDevices();

      expect(listed).toEqual([]);
      expect(camera.devicesRequirePermission()).toBe(true);
      expect(camera.getStatus().state).toBe('IDLE');
    });

    it('lists labelled video inputs once permission is granted and becomes READY', async () => {
      devices.permissionGranted = true;
      const camera = setup();

      const listed = await camera.listDevices();

      expect(listed).toEqual([
        { deviceId: 'cam-front', label: 'Front Camera' },
        { deviceId: 'cam-rear', label: 'Rear Camera' },
      ]);
      expect(camera.devicesRequirePermission()).toBe(false);
      expect(camera.getStatus().state).toBe('READY');
    });

    it('uses a fallback label when the browser exposes ids but no labels', async () => {
      const camera = setup();
      vi.spyOn(devices, 'enumerateDevices').mockResolvedValue([
        { deviceId: 'x', groupId: '', kind: 'videoinput', label: '', toJSON: () => ({}) },
        { deviceId: 'mic', groupId: '', kind: 'audioinput', label: 'Mic', toJSON: () => ({}) },
      ]);

      expect(await camera.listDevices()).toEqual([{ deviceId: 'x', label: 'Câmera 1' }]);
      expect(camera.devicesRequirePermission()).toBe(true);
    });

    it('refreshes the list when devices change', async () => {
      devices.permissionGranted = true;
      const camera = setup();
      await camera.listDevices();

      devices.setDevices([{ deviceId: 'usb', label: 'USB Camera' }]);
      await flush();

      expect(camera.devices()).toEqual([{ deviceId: 'usb', label: 'USB Camera' }]);
    });
  });

  describe('lifecycle (E1-T02)', () => {
    it('requests permission, then streams and lists labelled devices', async () => {
      const camera = setup();
      const release = devices.holdNextRequest();

      const starting = camera.start();
      expect(camera.getStatus().state).toBe('REQUESTING_PERMISSION');

      release();
      await starting;

      expect(camera.getStatus()).toEqual({ state: 'STREAMING' });
      expect(camera.stream()).toBe(devices.lastStream.asMediaStream());
      expect(camera.selectedDeviceId()).toBe('cam-front');
      expect(camera.devices().map((d) => d.label)).toEqual(['Front Camera', 'Rear Camera']);
      expect(devices.requests[0]).toEqual({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: { ideal: 'environment' },
        },
        audio: false,
      });
    });

    it('requests the exact device when one is given', async () => {
      const camera = setup();

      await camera.start('cam-rear');

      expect(devices.requests[0]?.video).toMatchObject({ deviceId: { exact: 'cam-rear' } });
      expect(camera.selectedDeviceId()).toBe('cam-rear');
    });

    it.each([
      ['NotAllowedError', 'PERMISSION_DENIED'],
      ['NotFoundError', 'NO_DEVICE'],
      ['OverconstrainedError', 'NO_DEVICE'],
      ['NotReadableError', 'DEVICE_BUSY'],
      ['SomethingElse', 'UNKNOWN'],
    ])('maps %s to %s', async (errorName, code) => {
      const camera = setup();
      devices.failNextWith(errorName);

      await camera.start();

      expect(camera.getStatus()).toMatchObject({ state: 'ERROR', error: { code } });
      expect(camera.stream()).toBeNull();
    });

    it('stop() releases every track and returns to READY', async () => {
      const camera = setup();
      await camera.start();

      camera.stop();

      expect(devices.liveTracks()).toEqual([]);
      expect(camera.stream()).toBeNull();
      expect(camera.getStatus()).toEqual({ state: 'READY' });
    });

    it('stop() after a permission error goes back to IDLE', async () => {
      const camera = setup();
      devices.failNextWith('NotAllowedError');
      await camera.start();

      camera.stop();

      expect(camera.getStatus()).toEqual({ state: 'IDLE' });
    });

    it('can restart after stopping', async () => {
      const camera = setup();
      await camera.start();
      camera.stop();

      await camera.start();

      expect(camera.getStatus().state).toBe('STREAMING');
      expect(devices.streams).toHaveLength(2);
      expect(devices.liveTracks()).toEqual([devices.lastStream.videoTrack]);
    });
  });

  describe('leak prevention (Gate G1)', () => {
    it('stops the previous stream before switching devices', async () => {
      const camera = setup();
      await camera.start('cam-front');
      const first = devices.lastStream;
      const release = devices.holdNextRequest();

      const switching = camera.selectDevice('cam-rear');
      expect(first.videoTrack.readyState).toBe('ended');
      release();
      await switching;

      expect(camera.selectedDeviceId()).toBe('cam-rear');
      expect(devices.liveTracks()).toEqual([devices.lastStream.videoTrack]);
    });

    it('selectDevice() only remembers the choice when no stream is open', async () => {
      const camera = setup();

      await camera.selectDevice('cam-rear');

      expect(devices.requests).toHaveLength(0);
      expect(camera.selectedDeviceId()).toBe('cam-rear');
    });

    it('stops a stream that arrives after stop() was called', async () => {
      const camera = setup();
      const release = devices.holdNextRequest();
      const starting = camera.start();

      camera.stop();
      release();
      await starting;

      expect(devices.streams).toHaveLength(1);
      expect(devices.liveTracks()).toEqual([]);
      expect(camera.stream()).toBeNull();
      expect(camera.getStatus().state).not.toBe('STREAMING');
    });

    it('keeps only the latest of two overlapping start() calls', async () => {
      const camera = setup();
      const releaseFirst = devices.holdNextRequest();
      const first = camera.start('cam-front');
      const second = camera.start('cam-rear');
      await second;

      releaseFirst();
      await first;

      expect(devices.liveTracks().map((t) => t.device.deviceId)).toEqual(['cam-rear']);
      expect(camera.selectedDeviceId()).toBe('cam-rear');
      expect(camera.getStatus().state).toBe('STREAMING');
    });

    it('ignores a late error from a superseded request', async () => {
      const camera = setup();
      const releaseFirst = devices.holdNextRequest();
      devices.failNextWith('NotReadableError');
      const first = camera.start();
      camera.stop();

      releaseFirst();
      await first;

      expect(camera.getStatus().state).toBe('IDLE');
    });

    it('releases the stream and reports an error when the device disconnects', async () => {
      const camera = setup();
      await camera.start();

      devices.lastStream.videoTrack.simulateEnded();

      expect(camera.stream()).toBeNull();
      expect(camera.getStatus()).toMatchObject({ state: 'ERROR', error: { code: 'NO_DEVICE' } });
    });

    it('stops the stream and listeners when the service is destroyed', async () => {
      const camera = setup();
      const removeListener = vi.spyOn(devices, 'removeEventListener');
      await camera.start();

      TestBed.resetTestingModule();

      expect(devices.liveTracks()).toEqual([]);
      expect(removeListener).toHaveBeenCalledWith('devicechange', expect.any(Function));
      expect(camera.stream()).toBeNull();
    });
  });
});
