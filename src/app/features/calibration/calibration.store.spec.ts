import { TestBed } from '@angular/core/testing';
import { FakeFrameSource } from '../../../../tests/fixtures/fake-frames';
import { FakeMediaDevices } from '../../../../tests/fixtures/fake-media-devices';
import { FakeVisionWorker, happyPathReply } from '../../../../tests/fixtures/fake-vision-worker';
import { InMemoryCalibrationRepository } from '../../../../tests/fixtures/in-memory-calibration-repository';
import { CAMERA_ENVIRONMENT } from '../../core/camera/camera.config';
import { CameraService } from '../../core/camera/camera.service';
import { FRAME_SOURCE_FACTORY } from '../../core/frame-capture/frame-capture.config';
import { CALIBRATION_REPOSITORY } from '../../core/persistence/calibration.repository';
import { PersistedCalibration } from '../../core/persistence/persistence.models';
import { VISION_WORKER_FACTORY, VisionWorkerClient } from '../../core/workers/vision-worker.client';
import {
  VisionWorkerRequest,
  VisionWorkerResponse,
} from '../../core/workers/vision-worker.protocol';
import { defaultCorners } from '../../domain/board/calibration';
import { CalibrationStore } from './calibration.store';

/** FakeFrameSource frames are 640×480; use the same source size. */
const SIZE = { width: 640, height: 480 };

describe('CalibrationStore', () => {
  let repository: InMemoryCalibrationRepository;
  let workers: FakeVisionWorker[];
  let devices: FakeMediaDevices;
  /** Worker auto-reply used by every fake worker; tests may replace it. */
  let reply: (message: VisionWorkerRequest) => VisionWorkerResponse | null;

  beforeEach(() => {
    repository = new InMemoryCalibrationRepository();
    workers = [];
    devices = new FakeMediaDevices();
    reply = happyPathReply;
    TestBed.configureTestingModule({
      providers: [
        CalibrationStore,
        VisionWorkerClient,
        { provide: CALIBRATION_REPOSITORY, useValue: repository },
        {
          provide: CAMERA_ENVIRONMENT,
          useValue: { mediaDevices: devices.asMediaDevices(), isSecureContext: true },
        },
        { provide: FRAME_SOURCE_FACTORY, useValue: () => new FakeFrameSource() },
        {
          provide: VISION_WORKER_FACTORY,
          useValue: () => {
            const worker = new FakeVisionWorker();
            worker.autoReply = (message) => reply(message);
            workers.push(worker);
            return worker;
          },
        },
      ],
    });
  });

  const store = () => TestBed.inject(CalibrationStore);

  function savedProfile(overrides: Partial<PersistedCalibration> = {}): PersistedCalibration {
    return {
      id: 'saved',
      name: 'Mesa',
      sourceWidth: 1280,
      sourceHeight: 960,
      corners: {
        topLeft: { x: 200, y: 100 },
        topRight: { x: 1000, y: 120 },
        bottomRight: { x: 1040, y: 880 },
        bottomLeft: { x: 180, y: 860 },
      },
      normalizedWidth: 800,
      normalizedHeight: 800,
      orientation: 'ROTATED_90',
      createdAt: '2026-11-01T00:00:00.000Z',
      updatedAt: '2026-11-01T00:00:00.000Z',
      isActive: true,
      ...overrides,
    };
  }

  it('starts with default corners once the video size is known', () => {
    store().setSourceSize(SIZE);

    expect(store().corners()).toEqual(defaultCorners(SIZE));
    expect(store().isValid()).toBe(true);
    expect(store().overlay()?.playableCenters).toHaveLength(32);
  });

  it('restores the active profile, scaled to the current resolution', async () => {
    repository.profiles.set('saved', savedProfile());

    await store().load();
    store().setSourceSize(SIZE);

    expect(store().orientation()).toBe('ROTATED_90');
    expect(store().corners()?.topLeft).toEqual({ x: 100, y: 50 });
    expect(store().savedProfile()?.id).toBe('saved');
  });

  it('applies a profile loaded after the video size is known', async () => {
    store().setSourceSize(SIZE);
    repository.profiles.set('saved', savedProfile({ sourceWidth: 640, sourceHeight: 480 }));

    await store().load();

    expect(store().corners()?.topLeft).toEqual({ x: 200, y: 100 });
  });

  it('reports a storage failure while loading', async () => {
    repository.failNextWith = 'UNAVAILABLE';

    await store().load();

    expect(store().loadError()).toContain('armazenamento local');
  });

  it('clamps dragged corners to the image and revalidates', () => {
    store().setSourceSize(SIZE);

    store().moveCorner('topLeft', { x: -50, y: 900 });

    expect(store().corners()?.topLeft).toEqual({ x: 0, y: 480 });
    expect(store().isValid()).toBe(false);
    expect(store().issueMessages().length).toBeGreaterThan(0);
    expect(store().overlay()).toBeNull();
  });

  it('nudges, rotates and resets', () => {
    store().setSourceSize(SIZE);
    const start = store().corners()?.topLeft;

    store().nudgeCorner('topLeft', 10, -1);
    store().rotate();

    expect(store().corners()?.topLeft).toEqual({ x: (start?.x ?? 0) + 10, y: (start?.y ?? 0) - 1 });
    expect(store().orientation()).toBe('ROTATED_90');
    expect(store().canonical()?.topLeft).toEqual(store().corners()?.topRight);

    store().resetCorners();
    expect(store().corners()).toEqual(defaultCorners(SIZE));
    expect(store().orientation()).toBe('NORMAL');
  });

  it('rescales corners when the camera resolution changes', () => {
    store().setSourceSize(SIZE);
    store().moveCorner('topLeft', { x: 100, y: 100 });

    store().setSourceSize({ width: 1280, height: 960 });

    expect(store().corners()?.topLeft).toEqual({ x: 200, y: 200 });
  });

  describe('normalized preview', () => {
    beforeEach(async () => {
      await TestBed.inject(CameraService).start();
      store().setSourceSize(SIZE);
    });

    it('captures a frame, calibrates and rectifies it in the worker', async () => {
      await store().generatePreview();

      expect(store().preview()).toMatchObject({ status: 'READY', image: { width: 800 } });
      const calibrate = workers[0]?.sent('CALIBRATE')[0];
      expect(calibrate).toMatchObject({ type: 'CALIBRATE', width: 640, height: 480 });
      expect(workers[0]?.sent('RECTIFY_FRAME')).toHaveLength(1);
    });

    it('sends the canonical (rotated) corners to the worker', async () => {
      store().rotate();

      await store().generatePreview();

      const calibrate = workers[0]?.sent('CALIBRATE')[0];
      expect(calibrate?.type === 'CALIBRATE' && calibrate.corners).toEqual(store().canonical());
    });

    it('discards (and closes) a result that arrives after the user edited the corners', async () => {
      const close = vi.fn();
      reply = (message) =>
        message.type === 'RECTIFY_FRAME'
          ? {
              type: 'RECTIFIED_FRAME',
              frameId: message.frameId,
              image: { width: 800, height: 800, close } as unknown as ImageBitmap,
            }
          : happyPathReply(message);

      const pending = store().generatePreview();
      store().nudgeCorner('topLeft', 1, 0);
      await pending;

      expect(store().preview().status).toBe('IDLE');
      expect(close).toHaveBeenCalledTimes(1);
    });

    it('closes the previous image when a new preview replaces it', async () => {
      await store().generatePreview();
      const first = store().preview();
      const close = vi.fn();
      if (first.status === 'READY') {
        (first.image as unknown as { close: () => void }).close = close;
      }

      store().nudgeCorner('topLeft', 1, 0);

      expect(close).toHaveBeenCalledTimes(1);
      expect(store().preview().status).toBe('IDLE');
    });

    it('shows the worker validation issues when the worker rejects the corners', async () => {
      reply = (message) =>
        message.type === 'CALIBRATE'
          ? {
              type: 'CALIBRATION_RESULT',
              result: {
                valid: false,
                issues: [{ code: 'AREA_TOO_SMALL', corners: [] }],
                normalizedWidth: 800,
                normalizedHeight: 800,
              },
            }
          : happyPathReply(message);

      await store().generatePreview();

      expect(store().preview()).toMatchObject({
        status: 'ERROR',
        message: expect.stringContaining('pequena'),
      });
      expect(workers[0]?.sent('RECTIFY_FRAME')).toHaveLength(0);
    });

    it('reports a worker failure with a user-facing message', async () => {
      reply = (message) =>
        message.type === 'RECTIFY_FRAME'
          ? { type: 'ERROR', code: 'RECTIFY_FAILED', message: 'boom', frameId: message.frameId }
          : happyPathReply(message);

      await store().generatePreview();

      expect(store().preview()).toMatchObject({
        status: 'ERROR',
        message: expect.stringContaining('processamento de imagem falhou'),
      });
    });

    it('reports a missing camera stream', async () => {
      TestBed.inject(CameraService).stop();

      await store().generatePreview();

      expect(store().preview()).toMatchObject({
        status: 'ERROR',
        message: expect.stringContaining('Ative a câmera'),
      });
    });
  });

  describe('saving (E2-T06)', () => {
    it('creates an active profile with the corners, orientation and camera', async () => {
      await TestBed.inject(CameraService).start('cam-rear');
      store().setSourceSize(SIZE);
      store().rotate();

      await store().saveCalibration();

      const saved = [...repository.profiles.values()];
      expect(saved).toHaveLength(1);
      expect(saved[0]).toMatchObject({
        isActive: true,
        cameraDeviceId: 'cam-rear',
        sourceWidth: 640,
        sourceHeight: 480,
        orientation: 'ROTATED_90',
        corners: store().corners(),
        normalizedWidth: 800,
      });
      expect(store().save().status).toBe('SAVED');
    });

    it('updates the loaded profile instead of creating another', async () => {
      repository.profiles.set('saved', savedProfile());
      await store().load();
      store().setSourceSize(SIZE);
      store().nudgeCorner('topLeft', 5, 5);

      await store().saveCalibration();

      expect([...repository.profiles.keys()]).toEqual(['saved']);
      expect(repository.profiles.get('saved')).toMatchObject({
        name: 'Mesa',
        sourceWidth: 640,
        createdAt: '2026-11-01T00:00:00.000Z',
      });
    });

    it('does not save an invalid calibration', async () => {
      store().setSourceSize(SIZE);
      store().moveCorner('topLeft', store().corners()?.bottomRight ?? { x: 0, y: 0 });

      await store().saveCalibration();

      expect(repository.profiles.size).toBe(0);
    });

    it('reports storage failures with a user-facing message', async () => {
      store().setSourceSize(SIZE);
      repository.failNextWith = 'QUOTA_EXCEEDED';

      await store().saveCalibration();

      expect(store().save()).toMatchObject({
        status: 'ERROR',
        message: expect.stringContaining('espaço'),
      });
    });

    it('editing after saving clears the saved indicator', async () => {
      store().setSourceSize(SIZE);
      await store().saveCalibration();

      store().nudgeCorner('topLeft', 1, 1);

      expect(store().save().status).toBe('IDLE');
    });
  });
});
