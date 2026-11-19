import type { CV } from '@techstark/opencv-js';

/** The OpenCV.js runtime API. */
export type OpenCv = CV;

/** Resolves to a wrapper (never the raw module, see opencv-runtime.ts). */
export type OpenCvImporter = () => Promise<{ readonly module: unknown }>;

/** Lazily imports the bundled build, so only the vision worker downloads it. */
const importBundledOpenCv: OpenCvImporter = async () =>
  (await import('./opencv-runtime')).bundledOpenCv;

/**
 * Returns a memoized loader. A failed load is not cached, so a later call retries.
 * Accepts the shapes the package can take: a Promise of the runtime, the runtime
 * itself, or a runtime still initializing (`onRuntimeInitialized`).
 */
export function createOpenCvLoader(
  importer: OpenCvImporter = importBundledOpenCv,
): () => Promise<OpenCv> {
  let loading: Promise<OpenCv> | null = null;
  return () => {
    loading ??= resolveRuntime(importer).catch((error: unknown) => {
      loading = null;
      throw error;
    });
    return loading;
  };
}

async function resolveRuntime(importer: OpenCvImporter): Promise<OpenCv> {
  const { module } = await importer();
  const runtime: unknown = module instanceof Promise ? await module : module;

  if (!isRecord(runtime)) {
    throw new Error('OpenCV.js did not provide a runtime object');
  }
  if (typeof runtime['Mat'] !== 'function') {
    await new Promise<void>((resolve) => {
      runtime['onRuntimeInitialized'] = () => resolve();
    });
  }
  if (
    typeof runtime['getPerspectiveTransform'] !== 'function' ||
    typeof runtime['warpPerspective'] !== 'function'
  ) {
    throw new Error('OpenCV.js build lacks the perspective transform APIs');
  }
  if (typeof runtime['then'] === 'function') {
    throw new Error('OpenCV.js runtime is thenable and cannot be returned safely');
  }
  // Single narrowing point from the untyped module value to the published typings.
  return runtime as unknown as OpenCv;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (typeof value === 'object' || typeof value === 'function') && value !== null;
}
