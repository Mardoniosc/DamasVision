import { TestBed } from '@angular/core/testing';
import { FakeFrameSource } from '../../../../tests/fixtures/fake-frames';
import { FakeMediaDevices } from '../../../../tests/fixtures/fake-media-devices';
import { CAMERA_ENVIRONMENT } from '../camera/camera.config';
import { CameraService } from '../camera/camera.service';
import { FRAME_CAPTURE_CONFIG, FRAME_SOURCE_FACTORY } from './frame-capture.config';
import { FrameCaptureService } from './frame-capture.service';

describe('FrameCaptureService', () => {
  let devices: FakeMediaDevices;
  let sources: FakeFrameSource[];
  let nextSourceSetup: (source: FakeFrameSource) => void;

  beforeEach(() => {
    vi.useFakeTimers();
    devices = new FakeMediaDevices();
    sources = [];
    nextSourceSetup = () => undefined;
    TestBed.configureTestingModule({
      providers: [
        {
          provide: CAMERA_ENVIRONMENT,
          useValue: { mediaDevices: devices.asMediaDevices(), isSecureContext: true },
        },
        {
          provide: FRAME_CAPTURE_CONFIG,
          useValue: { intervalMs: 200, maxInFlight: 1, maxFrameAgeMs: 500 },
        },
        {
          provide: FRAME_SOURCE_FACTORY,
          useValue: () => {
            const source = new FakeFrameSource();
            nextSourceSetup(source);
            sources.push(source);
            return source;
          },
        },
      ],
    });
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.useRealTimers();
  });

  /** The scheduler timer is gone: time passes and the (single) source captures nothing new. */
  async function expectNoFurtherCaptures(): Promise<void> {
    const before = sources.map((source) => source.captureCalls);
    await vi.advanceTimersByTimeAsync(2000);
    expect(sources.map((source) => source.captureCalls)).toEqual(before);
  }

  async function streamingCamera(): Promise<CameraService> {
    const camera = TestBed.inject(CameraService);
    await camera.start();
    return camera;
  }

  it('refuses to start without an open camera stream', async () => {
    const capture = TestBed.inject(FrameCaptureService);

    await capture.start();

    expect(capture.state()).toBe('ERROR');
    expect(capture.error()).toContain('Ative a câmera');
    expect(sources).toHaveLength(0);
  });

  it('captures frames from the camera stream and exposes stats', async () => {
    await streamingCamera();
    const capture = TestBed.inject(FrameCaptureService);

    await capture.start();
    await vi.advanceTimersByTimeAsync(400);

    expect(capture.state()).toBe('RUNNING');
    expect(capture.stats().processed).toBe(3);
    expect(capture.lastFrame()).toMatchObject({ frameId: 'frame-3', width: 640, height: 480 });
    expect(sources[0]?.unreleasedFrames()).toEqual([]);
  });

  it('pauses and resumes', async () => {
    await streamingCamera();
    const capture = TestBed.inject(FrameCaptureService);
    await capture.start();
    await vi.advanceTimersByTimeAsync(0);

    capture.pause();
    await vi.advanceTimersByTimeAsync(1000);
    expect(capture.state()).toBe('PAUSED');
    expect(capture.stats().captured).toBe(1);

    capture.resume();
    await vi.advanceTimersByTimeAsync(0);
    expect(capture.state()).toBe('RUNNING');
    expect(capture.stats().captured).toBe(2);
  });

  it('stop() disposes the source and stops the timer', async () => {
    await streamingCamera();
    const capture = TestBed.inject(FrameCaptureService);
    await capture.start();

    capture.stop();

    expect(capture.state()).toBe('STOPPED');
    expect(sources[0]?.disposed).toBe(true);
    await expectNoFurtherCaptures();
  });

  it('restarting disposes the previous source', async () => {
    await streamingCamera();
    const capture = TestBed.inject(FrameCaptureService);
    await capture.start();

    await capture.start();

    expect(sources.map((s) => s.disposed)).toEqual([true, false]);
  });

  it('stops automatically when the camera stream closes', async () => {
    const camera = await streamingCamera();
    const capture = TestBed.inject(FrameCaptureService);
    await capture.start();

    camera.stop();
    TestBed.tick();

    expect(capture.state()).toBe('STOPPED');
    expect(sources[0]?.disposed).toBe(true);
    await expectNoFurtherCaptures();
  });

  it('stops automatically when the camera switches devices', async () => {
    const camera = await streamingCamera();
    const capture = TestBed.inject(FrameCaptureService);
    await capture.start();

    await camera.selectDevice('cam-rear');
    TestBed.tick();

    expect(capture.state()).toBe('STOPPED');
    expect(sources[0]?.disposed).toBe(true);
  });

  it('reports a source that cannot start and releases it', async () => {
    await streamingCamera();
    nextSourceSetup = (source) => (source.startError = new DOMException('no', 'NotAllowedError'));
    const capture = TestBed.inject(FrameCaptureService);

    await capture.start();

    expect(capture.state()).toBe('ERROR');
    expect(capture.error()).toContain('Não foi possível ler');
    expect(sources[0]?.disposed).toBe(true);
  });

  it('surfaces processing failures while continuing to run', async () => {
    await streamingCamera();
    const capture = TestBed.inject(FrameCaptureService);

    await capture.start(() => Promise.reject(new Error('worker crashed')));
    await vi.advanceTimersByTimeAsync(0);

    expect(capture.state()).toBe('RUNNING');
    expect(capture.stats().failed).toBe(1);
    expect(capture.error()).toContain('Falha');
    expect(sources[0]?.unreleasedFrames()).toEqual([]);
  });

  it('cleans up when the service is destroyed', async () => {
    await streamingCamera();
    const capture = TestBed.inject(FrameCaptureService);
    await capture.start();

    TestBed.resetTestingModule();

    expect(sources[0]?.disposed).toBe(true);
    expect(devices.liveTracks()).toEqual([]);
    await expectNoFurtherCaptures();
  });
});
