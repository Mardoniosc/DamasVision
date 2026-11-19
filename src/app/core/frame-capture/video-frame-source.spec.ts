import { fakeBitmap, FakeBitmap } from '../../../../tests/fixtures/fake-frames';
import {
  FakeMediaStream,
  FakeMediaStreamTrack,
} from '../../../../tests/fixtures/fake-media-devices';
import { VideoFrameSource } from './video-frame-source';

function createVideo(ready: boolean): HTMLVideoElement {
  const video = document.createElement('video');
  Object.defineProperty(video, 'readyState', { value: ready ? 2 : 0, configurable: true });
  Object.defineProperty(video, 'videoWidth', { value: ready ? 640 : 0, configurable: true });
  Object.defineProperty(video, 'videoHeight', { value: ready ? 480 : 0, configurable: true });
  video.play = vi.fn(() => Promise.resolve());
  video.pause = vi.fn();
  return video;
}

describe('VideoFrameSource', () => {
  const stream = new FakeMediaStream([
    new FakeMediaStreamTrack({ deviceId: 'cam', label: 'Cam' }),
  ]).asMediaStream();

  function setup(ready = true): {
    source: VideoFrameSource;
    video: HTMLVideoElement;
    bitmaps: FakeBitmap[];
  } {
    const video = createVideo(ready);
    const bitmaps: FakeBitmap[] = [];
    let clock = 1000;
    const source = new VideoFrameSource(stream, {
      createVideoElement: () => video,
      createBitmap: async () => {
        const bitmap = fakeBitmap();
        bitmaps.push(bitmap);
        return bitmap as FakeBitmap & ImageBitmap;
      },
      now: () => clock++,
    });
    return { source, video, bitmaps };
  }

  it('attaches the stream to a muted, inline, private video element', async () => {
    const { source, video } = setup();

    await source.start();

    expect(video.srcObject).toBe(stream);
    expect(video.muted).toBe(true);
    expect(video.playsInline).toBe(true);
    expect(video.play).toHaveBeenCalled();
    expect(video.isConnected).toBe(false);
  });

  it('returns null until the video has data', async () => {
    const { source, bitmaps } = setup(false);

    expect(await source.capture()).toBeNull();
    expect(bitmaps).toHaveLength(0);
  });

  it('captures sequentially numbered, timestamped frames', async () => {
    const { source } = setup();

    const first = await source.capture();
    const second = await source.capture();

    expect(first).toMatchObject({ frameId: 'frame-1', capturedAt: 1000, width: 640, height: 480 });
    expect(second).toMatchObject({ frameId: 'frame-2', capturedAt: 1001 });
  });

  it('dispose() detaches the stream and stops capturing', async () => {
    const { source, video } = setup();

    source.dispose();
    source.dispose();

    expect(video.srcObject).toBeNull();
    expect(video.pause).toHaveBeenCalledTimes(1);
    expect(await source.capture()).toBeNull();
  });

  it('closes a bitmap that finishes after dispose()', async () => {
    const video = createVideo(true);
    const bitmap = fakeBitmap();
    let resolveBitmap: (value: ImageBitmap) => void = () => undefined;
    const source = new VideoFrameSource(stream, {
      createVideoElement: () => video,
      createBitmap: () => new Promise((resolve) => (resolveBitmap = resolve)),
      now: () => 0,
    });

    const capturing = source.capture();
    source.dispose();
    resolveBitmap(bitmap as FakeBitmap & ImageBitmap);

    expect(await capturing).toBeNull();
    expect(bitmap.closed).toBe(true);
  });
});
