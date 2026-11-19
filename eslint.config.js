// @ts-check
const eslint = require('@eslint/js');
const { defineConfig } = require('eslint/config');
const tseslint = require('typescript-eslint');
const angular = require('angular-eslint');

/** Matches relative imports into an application layer, e.g. '../../core/camera'. */
const layerImport = (layer) => `^(\.{1,2}/)+(.*/)?${layer}(/|$)`;

/**
 * Architectural boundaries (docs/execution-specification.md §2 and §4).
 * Enforced by lint so violations fail `npm run lint` instead of relying on review.
 */
const OPENCV_LIBS = ['@techstark/opencv-js', '@techstark/opencv-js/*'];
const VISION_AND_STORAGE_LIBS = ['dexie', 'dexie/*', ...OPENCV_LIBS];

const BROWSER_GLOBALS_FORBIDDEN_IN_DOMAIN = [
  'window',
  'document',
  'navigator',
  'self',
  'globalThis',
  'indexedDB',
  'localStorage',
  'sessionStorage',
  'caches',
  'fetch',
  'Worker',
  'ImageBitmap',
  'ImageData',
  'OffscreenCanvas',
  'HTMLElement',
  'HTMLVideoElement',
  'HTMLCanvasElement',
  'requestAnimationFrame',
].map((name) => ({
  name,
  message: 'domain/** must be pure TypeScript: no browser APIs (spec §4 ownership rules).',
}));

module.exports = defineConfig([
  {
    ignores: ['dist/**', 'coverage/**', '.angular/**', 'playwright-report/**', 'test-results/**'],
  },
  {
    files: ['**/*.ts'],
    extends: [
      eslint.configs.recommended,
      tseslint.configs.recommended,
      tseslint.configs.stylistic,
      angular.configs.tsRecommended,
    ],
    processor: angular.processInlineTemplates,
    rules: {
      '@angular-eslint/directive-selector': [
        'error',
        {
          type: 'attribute',
          prefix: 'app',
          style: 'camelCase',
        },
      ],
      '@angular-eslint/component-selector': [
        'error',
        {
          type: 'element',
          prefix: 'app',
          style: 'kebab-case',
        },
      ],
      // Spec §2: "No `any` except justified and isolated". Justified uses need an inline disable + reason.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always'],
    },
  },
  {
    // Domain: pure TypeScript. No Angular, RxJS, browser APIs, OpenCV, IndexedDB or app layers.
    files: ['src/app/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@angular/*', 'rxjs', 'rxjs/*', ...VISION_AND_STORAGE_LIBS],
              message: 'domain/** must not depend on frameworks, OpenCV or IndexedDB.',
            },
            {
              regex: `${layerImport('core')}|${layerImport('features')}|${layerImport('shared')}`,
              message: 'domain/** must not import application layers.',
            },
          ],
        },
      ],
      'no-restricted-globals': ['error', ...BROWSER_GLOBALS_FORBIDDEN_IN_DOMAIN],
    },
  },
  {
    // Presentation: no direct IndexedDB/OpenCV/camera access; go through core services.
    files: ['src/app/features/**/*.ts', 'src/app/shared/**/*.ts', 'src/app/app.component.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: VISION_AND_STORAGE_LIBS,
              message:
                'UI must not access OpenCV or IndexedDB directly (use core/workers and core/persistence).',
            },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'indexedDB', message: 'Use core/persistence repositories.' },
        { name: 'Worker', message: 'Use the core/workers client.' },
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'navigator',
          property: 'mediaDevices',
          message: 'Camera access belongs to core/camera.',
        },
      ],
    },
  },
  {
    // Shared: reusable UI only; must not depend on features or core services.
    files: ['src/app/shared/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: VISION_AND_STORAGE_LIBS,
              message: 'shared/** is reusable UI only.',
            },
            {
              regex: `${layerImport('features')}|${layerImport('core')}`,
              message: 'shared/** is reusable UI only and must not import features or core.',
            },
          ],
        },
      ],
    },
  },
  {
    // Core must not depend on presentation features, nor load OpenCV directly.
    files: ['src/app/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: layerImport('features'),
              message: 'core/** must not import features.',
            },
            {
              group: OPENCV_LIBS,
              message:
                'OpenCV is only imported in src/app/vision/** (loaded by the vision worker).',
            },
          ],
        },
      ],
    },
  },
  {
    // Vision pipeline: runs inside the worker. Pure TS + OpenCV; no Angular, DOM or app layers.
    files: ['src/app/vision/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@angular/*', 'rxjs', 'rxjs/*', 'dexie', 'dexie/*'],
              message: 'vision/** runs in a Web Worker: no Angular, RxJS or IndexedDB.',
            },
            {
              regex: `${layerImport('core')}|${layerImport('features')}|${layerImport('shared')}`,
              message: 'vision/** may only depend on domain/**.',
            },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        ...['window', 'document', 'localStorage', 'sessionStorage', 'indexedDB', 'navigator'].map(
          (name) => ({ name, message: 'vision/** runs in a Web Worker without DOM access.' }),
        ),
      ],
    },
  },
  {
    // Only core/camera may touch the camera APIs.
    files: ['src/app/core/**/*.ts'],
    ignores: ['src/app/core/camera/**'],
    rules: {
      'no-restricted-properties': [
        'error',
        {
          object: 'navigator',
          property: 'mediaDevices',
          message: 'Camera access belongs to core/camera.',
        },
      ],
    },
  },
  {
    files: ['**/*.html'],
    extends: [angular.configs.templateRecommended, angular.configs.templateAccessibility],
    rules: {},
  },
]);
