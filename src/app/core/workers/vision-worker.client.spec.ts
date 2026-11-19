import { TestBed } from '@angular/core/testing';
import { fakeBitmap, fakeFrame } from '../../../../tests/fixtures/fake-frames';
import { FakeVisionWorker, happyPathReply } from '../../../../tests/fixtures/fake-vision-worker';
import { CalibrationCorners } from '../../domain/board/calibration';
import { DEFAULT_VISION_CONFIG } from '../../vision/vision.config';
import {
  VISION_WORKER_FACTORY,
  VISION_WORKER_TIMEOUTS,
  VisionWorkerClient,
  VisionWorkerError,
} from './vision-worker.client';

const CORNERS: CalibrationCorners = {
  topLeft: { x: 0, y: 0 },
  topRight: { x: 10, y: 0 },
  bottomRight: { x: 10, y: 10 },
  bottomLeft: { x: 0, y: 10 },
};

describe('VisionWorkerClient', () => {
  let workers: FakeVisionWorker[];

  function setup(autoReply: FakeVisionWorker['autoReply'] = happyPathReply): VisionWorkerClient {
    workers = [];
    TestBed.configureTestingModule({
      providers: [
        VisionWorkerClient,
        {
          provide: VISION_WORKER_FACTORY,
          useValue: () => {
            const worker = new FakeVisionWorker();
            worker.autoReply = autoReply;
            workers.push(worker);
            return worker;
          },
        },
        { provide: VISION_WORKER_TIMEOUTS, useValue: { initMs: 1000, requestMs: 500 } },
      ],
    });
    return TestBed.inject(VisionWorkerClient);
  }

  function worker(index = 0): FakeVisionWorker {
    const found = workers[index];
    if (!found) throw new Error(`no worker #${index}`);
    return found;
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Lets requests that await init() reach the worker. */
  const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

  it('starts lazily, sends INIT with the vision config and becomes READY', async () => {
    const client = setup();
    expect(workers).toHaveLength(0);

    await Promise.all([client.init(), client.init()]);

    expect(workers).toHaveLength(1);
    expect(worker().sent('INIT')).toEqual([{ type: 'INIT', config: DEFAULT_VISION_CONFIG }]);
    expect(client.state()).toBe('READY');
  });

  it('calibrates and returns the result', async () => {
    const client = setup();

    const result = await client.calibrate(CORNERS, 640, 480);

    expect(result.valid).toBe(true);
    expect(worker().sent('CALIBRATE')).toEqual([
      { type: 'CALIBRATE', corners: CORNERS, width: 640, height: 480 },
    ]);
  });

  it('rectifies a frame by transferring its bitmap', async () => {
    const client = setup();
    const frame = fakeFrame('f1', 0);

    const image = await client.rectify(frame);

    expect(image.width).toBe(800);
    const sent = worker().received.find((entry) => entry.message.type === 'RECTIFY_FRAME');
    expect(sent?.transfer).toEqual([frame.bitmap]);
    expect(frame.bitmap.closed).toBe(true);
  });

  it('rejects with the worker error code', async () => {
    const client = setup((message) =>
      message.type === 'INIT'
        ? { type: 'READY' }
        : message.type === 'RECTIFY_FRAME'
          ? {
              type: 'ERROR',
              code: 'NOT_CALIBRATED',
              message: 'calibrate first',
              frameId: message.frameId,
            }
          : null,
    );

    const error = await client.rectify(fakeFrame('f2', 0)).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(VisionWorkerError);
    expect(error).toMatchObject({ failure: 'WORKER_ERROR', workerCode: 'NOT_CALIBRATED' });
  });

  it('routes an ERROR without frameId through requestType', async () => {
    const client = setup((message) =>
      message.type === 'INIT'
        ? { type: 'READY' }
        : { type: 'ERROR', code: 'CALIBRATION_FAILED', message: 'boom', requestType: 'CALIBRATE' },
    );

    await expect(client.calibrate(CORNERS, 10, 10)).rejects.toMatchObject({
      workerCode: 'CALIBRATION_FAILED',
    });
  });

  it('times out INIT, terminates the worker and retries with a new one', async () => {
    vi.useFakeTimers();
    const client = setup(null);

    const init = client.init();
    const assertion = expect(init).rejects.toMatchObject({ failure: 'TIMEOUT' });
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;

    expect(client.state()).toBe('ERROR');
    expect(worker(0).terminated).toBe(true);

    worker(0).autoReply = happyPathReply;
    const retry = client.init();
    worker(1).reply({ type: 'READY' });
    await retry;
    expect(client.state()).toBe('READY');
  });

  it('supersedes a pending calibration with a newer one', async () => {
    const client = setup((message) => (message.type === 'INIT' ? { type: 'READY' } : null));
    await client.init();

    const first = client.calibrate(CORNERS, 10, 10);
    // Attach before waiting: `first` is rejected as soon as `second` reaches the worker.
    const firstSuperseded = expect(first).rejects.toMatchObject({ failure: 'SUPERSEDED' });
    const second = client.calibrate(CORNERS, 20, 20);
    await flush();
    worker().reply(happyPathReply({ type: 'CALIBRATE', corners: CORNERS, width: 20, height: 20 }));

    await firstSuperseded;
    await expect(second).resolves.toMatchObject({ valid: true });
  });

  it('fails every pending request when the worker crashes', async () => {
    const client = setup((message) => (message.type === 'INIT' ? { type: 'READY' } : null));
    await client.init();

    const pending = client.calibrate(CORNERS, 10, 10);
    await flush();
    worker().crash();

    await expect(pending).rejects.toMatchObject({ failure: 'WORKER_CRASHED' });
    expect(client.state()).toBe('ERROR');
    expect(worker().terminated).toBe(true);
  });

  it('ignores malformed messages but records them', async () => {
    const client = setup((message) => (message.type === 'INIT' ? { type: 'READY' } : null));
    await client.init();

    worker().reply({ type: 'RECTIFIED_FRAME', frameId: 'x' });

    expect(client.lastError()?.failure).toBe('INVALID_RESPONSE');
    expect(client.state()).toBe('READY');
  });

  it('closes a late rectified image nobody is waiting for', async () => {
    const client = setup((message) => (message.type === 'INIT' ? { type: 'READY' } : null));
    await client.init();
    const late = fakeBitmap(800, 800);

    worker().reply({ type: 'RECTIFIED_FRAME', frameId: 'gone', image: late });

    expect(late.closed).toBe(true);
  });

  it('dispose() sends DISPOSE, terminates and rejects pending requests', async () => {
    const client = setup((message) => (message.type === 'INIT' ? { type: 'READY' } : null));
    await client.init();
    const pending = client.calibrate(CORNERS, 10, 10);
    await flush();

    client.dispose();

    await expect(pending).rejects.toMatchObject({ failure: 'DISPOSED' });
    expect(worker().sent('DISPOSE')).toHaveLength(1);
    expect(worker().terminated).toBe(true);
    expect(client.state()).toBe('DISPOSED');
    await expect(client.init()).rejects.toMatchObject({ failure: 'DISPOSED' });
  });

  it('terminates the worker when its injector is destroyed', async () => {
    const client = setup();
    await client.init();

    TestBed.resetTestingModule();

    expect(worker().terminated).toBe(true);
    expect(client.state()).toBe('DISPOSED');
  });
});
