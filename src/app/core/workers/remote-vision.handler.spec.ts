import serviceResponse from '../../../../tests/fixtures/contract/service-response.json';
import { fakeBitmap, FakeBitmap } from '../../../../tests/fixtures/fake-frames';
import { DEFAULT_VISION_CONFIG } from '../../vision/vision.config';
import { createRemoteVisionHandler } from './remote-vision.handler';
import { DEFAULT_REMOTE_VISION_TUNING, RemoteVisionConfigMessage } from './vision-provider';
import { VisionWorkerResponse } from './vision-worker.protocol';

const URL_BASE = 'http://127.0.0.1:8765';
const CORNERS = {
  topLeft: { x: 100, y: 50 },
  topRight: { x: 900, y: 50 },
  bottomRight: { x: 1000, y: 650 },
  bottomLeft: { x: 50, y: 650 },
};
const CONFIGURE: RemoteVisionConfigMessage = {
  type: 'REMOTE_CONFIG',
  serviceUrl: URL_BASE,
  tuning: DEFAULT_REMOTE_VISION_TUNING,
};
const VALID_CALIBRATION = {
  valid: true,
  issues: [],
  transform: [1, 0, 0, 0, 1, 0, 0, 0, 1],
  normalizedWidth: 800,
  normalizedHeight: 800,
};

interface Call {
  readonly method: string;
  readonly path: string;
  readonly init: RequestInit;
}

type Route = (call: Call) => Response | Promise<Response>;

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** A fake local service: routes by "METHOD path" (without query string). */
function fakeService(routes: Record<string, Route>) {
  const calls: Call[] = [];
  const fetch = async (url: string, init: RequestInit): Promise<Response> => {
    const path = url.slice(URL_BASE.length);
    const call = { method: init.method ?? 'GET', path, init };
    calls.push(call);
    const route = routes[`${call.method} ${path.split('?')[0]}`];
    if (!route) return json({ code: 'NOT_FOUND', message: path }, 404);
    return route(call);
  };
  return { fetch, calls };
}

const HEALTHY: Record<string, Route> = {
  'GET /v1/health': () => json({ status: 'ok', contractVersion: 1 }),
  'POST /v1/sessions': () => json({ sessionId: 's1', contractVersion: 1 }, 201),
  'PUT /v1/sessions/s1/calibration': () => json(VALID_CALIBRATION),
  'POST /v1/sessions/s1/frames': () => json(serviceResponse),
};

function setup(routes: Record<string, Route> = HEALTHY) {
  const service = fakeService(routes);
  const posted: { message: VisionWorkerResponse; transfer: Transferable[] }[] = [];
  const decoded: FakeBitmap[] = [];
  const handle = createRemoteVisionHandler({
    fetch: service.fetch,
    post: (message, transfer = []) => posted.push({ message, transfer }),
    encode: async (_bitmap, type) => new Blob([new Uint8Array([1, 2, 3])], { type }),
    decode: async () => {
      const bitmap = fakeBitmap(800, 800);
      decoded.push(bitmap);
      return bitmap as FakeBitmap & ImageBitmap;
    },
  });
  const last = (): VisionWorkerResponse => posted.at(-1)?.message as VisionWorkerResponse;
  const ready = async () => {
    await handle(CONFIGURE);
    await handle({ type: 'INIT', config: DEFAULT_VISION_CONFIG });
  };
  const calibrated = async () => {
    await ready();
    await handle({ type: 'CALIBRATE', corners: CORNERS, width: 1280, height: 720 });
  };
  const frame = () => fakeBitmap(1280, 720);
  return { handle, posted, last, ready, calibrated, frame, calls: service.calls, decoded };
}

describe('remote vision handler (G3.1)', () => {
  it('refuses INIT before it is configured', async () => {
    const { handle, last } = setup();

    await handle({ type: 'INIT', config: DEFAULT_VISION_CONFIG });

    expect(last()).toMatchObject({ type: 'ERROR', code: 'INIT_FAILED', requestType: 'INIT' });
  });

  it('checks the service health and creates a session with the app config', async () => {
    const { ready, last, calls } = setup();

    await ready();

    expect(last()).toEqual({ type: 'READY' });
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'GET /v1/health',
      'POST /v1/sessions',
    ]);
    expect(JSON.parse(calls[1]?.init.body as string)).toEqual({ config: DEFAULT_VISION_CONFIG });
  });

  it('reports an unreachable service as SERVICE_UNAVAILABLE', async () => {
    const { ready, last } = setup({
      'GET /v1/health': () => Promise.reject(new TypeError('Failed to fetch')),
    });

    await ready();

    expect(last()).toMatchObject({ type: 'ERROR', code: 'SERVICE_UNAVAILABLE' });
  });

  it('refuses a service that speaks another contract version', async () => {
    const { ready, last } = setup({
      ...HEALTHY,
      'GET /v1/health': () => json({ status: 'ok', contractVersion: 2 }),
    });

    await ready();

    expect(last()).toMatchObject({ type: 'ERROR', code: 'INIT_FAILED' });
    expect((last() as { message: string }).message).toContain('v2');
  });

  it('forwards the calibration and its result', async () => {
    const { calibrated, last, calls } = setup();

    await calibrated();

    expect(last()).toEqual({ type: 'CALIBRATION_RESULT', result: VALID_CALIBRATION });
    expect(JSON.parse(calls.at(-1)?.init.body as string)).toEqual({
      corners: CORNERS,
      width: 1280,
      height: 720,
    });
  });

  it('sends frames as JPEG with their id, closes them and posts the observation', async () => {
    const { calibrated, handle, last, calls, frame } = setup();
    await calibrated();
    const bitmap = frame();

    await handle({
      type: 'PROCESS_FRAME',
      frame: bitmap as FakeBitmap & ImageBitmap,
      frameId: 'frame-1',
    });

    expect(bitmap.closed).toBe(true);
    const request = calls.at(-1) as Call;
    expect(request.path).toBe('/v1/sessions/s1/frames?debug=false');
    expect(request.init.headers).toMatchObject({
      'Content-Type': 'image/jpeg',
      'X-Frame-Id': 'frame-1',
    });
    const response = last();
    expect(response.type).toBe('RECOGNITION_RESULT');
    if (response.type !== 'RECOGNITION_RESULT') return;
    expect(response.result.board.cells).toEqual(serviceResponse.result.board.cells);
    expect(response.traces).toHaveLength(32);
  });

  it('decodes the debug image and the mask and transfers them', async () => {
    const debugBody = { ...serviceResponse, debugImage: btoa('jpeg'), foregroundMask: btoa('png') };
    const { calibrated, handle, posted, decoded, frame } = setup({
      ...HEALTHY,
      'POST /v1/sessions/s1/frames': () => json(debugBody),
    });
    await calibrated();

    await handle({
      type: 'PROCESS_FRAME',
      frame: frame() as FakeBitmap & ImageBitmap,
      frameId: 'frame-1',
      debug: true,
    });

    const { message, transfer } = posted.at(-1) as (typeof posted)[number];
    expect(message.type).toBe('RECOGNITION_RESULT');
    expect(decoded).toHaveLength(2);
    expect(transfer).toEqual(decoded);
  });

  it('never posts an observation that fails the contract checks', async () => {
    const broken = { ...serviceResponse, result: { ...serviceResponse.result, squares: 'nope' } };
    const { calibrated, handle, last, frame } = setup({
      ...HEALTHY,
      'POST /v1/sessions/s1/frames': () => json(broken),
    });
    await calibrated();

    await handle({
      type: 'PROCESS_FRAME',
      frame: frame() as FakeBitmap & ImageBitmap,
      frameId: 'frame-1',
    });

    expect(last()).toMatchObject({
      type: 'ERROR',
      code: 'RECOGNITION_FAILED',
      frameId: 'frame-1',
      requestType: 'PROCESS_FRAME',
    });
  });

  it.each([
    ['BUSY', 409, 'RECOGNITION_FAILED'],
    ['TIMEOUT', 504, 'SERVICE_UNAVAILABLE'],
    ['NOT_CALIBRATED', 409, 'NOT_CALIBRATED'],
    ['UNSUPPORTED_MEDIA', 415, 'INVALID_REQUEST'],
  ])('maps the service error %s to %s', async (code, status, expected) => {
    const { calibrated, handle, last, frame } = setup({
      ...HEALTHY,
      'POST /v1/sessions/s1/frames': () => json({ code, message: code }, status),
    });
    await calibrated();

    await handle({
      type: 'PROCESS_FRAME',
      frame: frame() as FakeBitmap & ImageBitmap,
      frameId: 'f',
    });

    expect(last()).toMatchObject({ type: 'ERROR', code: expected, frameId: 'f' });
  });

  it('recreates a lost session, replays the calibration and retries once', async () => {
    let lost = true;
    let sessions = 0;
    const { calibrated, handle, last, calls, frame } = setup({
      ...HEALTHY,
      'POST /v1/sessions': () => json({ sessionId: 's1', contractVersion: 1 }, (sessions++, 201)),
      'POST /v1/sessions/s1/frames': () => {
        if (lost) {
          lost = false;
          return json({ code: 'NOT_INITIALIZED', message: 'expired' }, 404);
        }
        return json(serviceResponse);
      },
    });
    await calibrated();

    await handle({
      type: 'PROCESS_FRAME',
      frame: frame() as FakeBitmap & ImageBitmap,
      frameId: 'frame-1',
    });

    expect(last().type).toBe('RECOGNITION_RESULT');
    expect(sessions).toBe(2);
    expect(calls.map((c) => `${c.method} ${c.path.split('?')[0]}`).slice(-4)).toEqual([
      'POST /v1/sessions/s1/frames',
      'POST /v1/sessions',
      'PUT /v1/sessions/s1/calibration',
      'POST /v1/sessions/s1/frames',
    ]);
  });

  it('refines with a lossless frame', async () => {
    const refined = { corners: CORNERS, scoreBefore: 10, scoreAfter: 12, maxShiftPx: 1.5 };
    const { ready, handle, last, calls, frame } = setup({
      ...HEALTHY,
      'POST /v1/sessions/s1/calibration/refine': () => json(refined),
    });
    await ready();
    const bitmap = frame();

    await handle({
      type: 'REFINE_CALIBRATION',
      corners: CORNERS,
      frame: bitmap as FakeBitmap & ImageBitmap,
      frameId: 'refine',
    });

    expect(bitmap.closed).toBe(true);
    expect(last()).toEqual({ type: 'CALIBRATION_REFINED', frameId: 'refine', ...refined });
    const body = JSON.parse(calls.at(-1)?.init.body as string) as { image: string };
    expect(atob(body.image)).toBe('\u0001\u0002\u0003');
  });

  it('rectifies through the service', async () => {
    const { calibrated, handle, last } = setup({
      ...HEALTHY,
      'POST /v1/sessions/s1/rectify': () =>
        new Response(new Blob([new Uint8Array([9])]), { status: 200 }),
    });
    await calibrated();

    await handle({
      type: 'RECTIFY_FRAME',
      frame: fakeBitmap() as FakeBitmap & ImageBitmap,
      frameId: 'r',
    });

    expect(last()).toMatchObject({ type: 'RECTIFIED_FRAME', frameId: 'r' });
  });

  it('rejects frames before INIT and closes them', async () => {
    const { handle, last, frame } = setup();
    await handle(CONFIGURE);
    const bitmap = frame();

    await handle({
      type: 'PROCESS_FRAME',
      frame: bitmap as FakeBitmap & ImageBitmap,
      frameId: 'f',
    });

    expect(bitmap.closed).toBe(true);
    expect(last()).toMatchObject({ type: 'ERROR', code: 'NOT_INITIALIZED' });
  });

  it('closes the session on DISPOSE and the calibration on RESET', async () => {
    const { calibrated, handle, calls } = setup({
      ...HEALTHY,
      'DELETE /v1/sessions/s1/calibration': () => new Response(null, { status: 204 }),
      'DELETE /v1/sessions/s1': () => new Response(null, { status: 204 }),
    });
    await calibrated();

    await handle({ type: 'RESET' });
    await handle({ type: 'DISPOSE' });

    expect(calls.map((c) => `${c.method} ${c.path}`).slice(-2)).toEqual([
      'DELETE /v1/sessions/s1/calibration',
      'DELETE /v1/sessions/s1',
    ]);
  });
});
