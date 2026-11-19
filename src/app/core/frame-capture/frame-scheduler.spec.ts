import { fakeFrame } from '../../../../tests/fixtures/fake-frames';
import { CapturedFrame, FrameCaptureConfig, FrameSchedulerStats } from './frame-capture.models';
import { FrameScheduler, FrameSchedulerOptions } from './frame-scheduler';

const CONFIG: FrameCaptureConfig = { intervalMs: 200, maxInFlight: 1, maxFrameAgeMs: 500 };

interface Harness {
  readonly scheduler: FrameScheduler;
  readonly frames: ReturnType<typeof fakeFrame>[];
  readonly processed: string[];
  readonly errors: unknown[];
  readonly stats: () => FrameSchedulerStats;
}

function createHarness(overrides: Partial<FrameSchedulerOptions> = {}): Harness {
  const frames: ReturnType<typeof fakeFrame>[] = [];
  const processed: string[] = [];
  const errors: unknown[] = [];
  const scheduler = new FrameScheduler({
    config: CONFIG,
    now: () => Date.now(),
    captureFrame: async () => {
      const frame = fakeFrame(`f${frames.length + 1}`, Date.now());
      frames.push(frame);
      return frame;
    },
    processFrame: async (frame: CapturedFrame) => {
      processed.push(frame.frameId);
    },
    onError: (error) => errors.push(error),
    ...overrides,
  });
  return { scheduler, frames, processed, errors, stats: () => scheduler.stats };
}

describe('FrameScheduler (E1-T04)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('captures immediately and then once per interval', async () => {
    const { scheduler, processed } = createHarness();

    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(processed).toEqual(['f1']);

    await vi.advanceTimersByTimeAsync(600);
    expect(processed).toEqual(['f1', 'f2', 'f3', 'f4']);
    expect(scheduler.state).toBe('RUNNING');
    scheduler.stop();
  });

  it('skips ticks instead of queueing while a frame is in flight', async () => {
    let finish: () => void = () => undefined;
    const { scheduler, frames, stats } = createHarness({
      processFrame: () => new Promise<void>((resolve) => (finish = resolve)),
    });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(1000);

    expect(frames).toHaveLength(1);
    expect(scheduler.framesInFlight).toBe(1);
    expect(stats().skippedBusy).toBe(5);

    finish();
    await vi.advanceTimersByTimeAsync(200);
    expect(stats().processed).toBe(1);
    expect(frames).toHaveLength(2);
    scheduler.stop();
  });

  it('respects a larger maxInFlight bound', async () => {
    const { scheduler, frames } = createHarness({
      config: { ...CONFIG, maxInFlight: 2 },
      processFrame: () => new Promise<void>(() => undefined),
    });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(1000);

    expect(frames).toHaveLength(2);
    expect(scheduler.framesInFlight).toBe(2);
    scheduler.stop();
  });

  it('drops frames older than maxFrameAgeMs without processing them', async () => {
    const { scheduler, processed, stats, frames } = createHarness({
      captureFrame: async () => {
        const frame = fakeFrame('old', Date.now() - 501);
        frames.push(frame);
        return frame;
      },
    });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(processed).toEqual([]);
    expect(stats().droppedStale).toBe(1);
    expect(frames[0]?.bitmap.closed).toBe(true);
    scheduler.stop();
  });

  it('counts ticks where the source has no frame yet', async () => {
    const { scheduler, stats } = createHarness({ captureFrame: async () => null });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(400);

    expect(stats().skippedNotReady).toBe(3);
    expect(stats().captured).toBe(0);
    scheduler.stop();
  });

  it('pause() stops capturing and resume() continues', async () => {
    const { scheduler, frames } = createHarness();
    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);

    scheduler.pause();
    await vi.advanceTimersByTimeAsync(2000);
    expect(scheduler.state).toBe('PAUSED');
    expect(frames).toHaveLength(1);

    scheduler.resume();
    await vi.advanceTimersByTimeAsync(0);
    expect(scheduler.state).toBe('RUNNING');
    expect(frames).toHaveLength(2);
    scheduler.stop();
  });

  it('drops (and releases) a frame whose capture finishes after pause', async () => {
    let deliver: (frame: CapturedFrame) => void = () => undefined;
    const pending = fakeFrame('late', 0);
    const { scheduler, processed, stats } = createHarness({
      captureFrame: () => new Promise((resolve) => (deliver = resolve)),
    });
    scheduler.start();

    scheduler.pause();
    deliver(pending);
    await vi.advanceTimersByTimeAsync(0);

    expect(processed).toEqual([]);
    expect(stats().droppedInactive).toBe(1);
    expect(pending.bitmap.closed).toBe(true);
  });

  it('stop() halts the timer for good', async () => {
    const { scheduler, frames } = createHarness();
    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);

    scheduler.stop();
    scheduler.resume();
    await vi.advanceTimersByTimeAsync(5000);

    expect(scheduler.state).toBe('STOPPED');
    expect(frames).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('releases every frame, including when processing throws, and reports errors', async () => {
    const failure = new Error('processor failed');
    let calls = 0;
    const { scheduler, frames, errors, stats } = createHarness({
      processFrame: async () => {
        calls++;
        if (calls % 2 === 0) {
          throw failure;
        }
      },
    });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(800);
    scheduler.stop();

    expect(frames).toHaveLength(5);
    expect(frames.every((frame) => frame.bitmap.closed)).toBe(true);
    expect(stats().failed).toBe(2);
    expect(stats().processed).toBe(3);
    expect(errors).toEqual([failure, failure]);
  });

  it('reports capture failures without stopping', async () => {
    const { scheduler, stats, errors } = createHarness({
      captureFrame: () => Promise.reject(new Error('capture failed')),
    });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(200);

    expect(stats().failed).toBe(2);
    expect(errors).toHaveLength(2);
    expect(scheduler.state).toBe('RUNNING');
    scheduler.stop();
  });

  it('publishes stats on every change', async () => {
    const snapshots: FrameSchedulerStats[] = [];
    const { scheduler } = createHarness({ onStats: (stats) => snapshots.push(stats) });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    scheduler.stop();

    expect(snapshots.map((s) => [s.captured, s.processed])).toEqual([
      [1, 0],
      [1, 1],
    ]);
  });

  it.each([
    [{ intervalMs: 0 }],
    [{ intervalMs: Number.NaN }],
    [{ maxInFlight: 0 }],
    [{ maxInFlight: 1.5 }],
    [{ maxFrameAgeMs: -1 }],
  ])('rejects invalid configuration %p', (override) => {
    expect(() => createHarness({ config: { ...CONFIG, ...override } })).toThrow(RangeError);
  });
});
