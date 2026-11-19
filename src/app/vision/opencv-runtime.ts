// `import = require` skips esbuild's ESM interop (`__toESM`), which would copy the CommonJS
// export — a real Promise of the runtime — into a fake object inheriting Promise.prototype
// that throws as soon as anything awaits it.
// eslint-disable-next-line @typescript-eslint/no-require-imports -- required to bypass __toESM, see above.
import openCvExports = require('@techstark/opencv-js');

/**
 * The pinned, locally bundled OpenCV.js build (no CDN, spec §2). Carried inside a plain
 * object so no Promise machinery ever inspects the module value itself.
 */
export const bundledOpenCv: { readonly module: unknown } = { module: openCvExports };
