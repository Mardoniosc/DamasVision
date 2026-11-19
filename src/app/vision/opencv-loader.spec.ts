import { createOpenCvLoader } from './opencv-loader';

function fakeRuntime(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    Mat: function Mat() {
      return undefined;
    },
    getPerspectiveTransform: () => undefined,
    warpPerspective: () => undefined,
    ...extra,
  };
}

describe('createOpenCvLoader', () => {
  it('loads the bundled OpenCV.js build', async () => {
    const cv = await createOpenCvLoader()();

    expect(typeof cv.Mat).toBe('function');
    expect(typeof cv.getPerspectiveTransform).toBe('function');
  }, 60_000);

  it('unwraps a Promise of the runtime and memoizes it', async () => {
    const runtime = fakeRuntime();
    const importer = vi.fn(async () => ({ module: Promise.resolve(runtime) }));
    const load = createOpenCvLoader(importer);

    const [first, second] = await Promise.all([load(), load()]);

    expect(first).toBe(runtime);
    expect(second).toBe(runtime);
    expect(importer).toHaveBeenCalledTimes(1);
  });

  it('waits for onRuntimeInitialized when the runtime is not ready yet', async () => {
    const runtime: Record<string, unknown> = {
      getPerspectiveTransform: () => 0,
      warpPerspective: () => 0,
    };
    const load = createOpenCvLoader(async () => ({ module: runtime }));

    const loading = load();
    await Promise.resolve();
    runtime['Mat'] = function Mat() {
      return undefined;
    };
    (runtime['onRuntimeInitialized'] as () => void)();

    await expect(loading).resolves.toBe(runtime);
  });

  it('retries after a failed load', async () => {
    const importer = vi
      .fn<() => Promise<{ module: unknown }>>()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ module: fakeRuntime() });
    const load = createOpenCvLoader(importer);

    await expect(load()).rejects.toThrow('network');
    await expect(load()).resolves.toBeDefined();
    expect(importer).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['a non-object', 42],
    ['a build without perspective APIs', { Mat: () => undefined }],
    ['a thenable runtime', fakeRuntime({ then: () => undefined })],
  ])('rejects %s', async (_label, module) => {
    await expect(createOpenCvLoader(async () => ({ module }))()).rejects.toThrow();
  });
});
