import { defineConfig, devices } from '@playwright/test';
import { SYNTHETIC_BOARD_VIDEO } from './tests/e2e/support/paths';

const PORT = 4400;

/**
 * E2E against the production build (E8-T03 profiling, E8-T05 PWA/offline): the service
 * worker is only active in production builds. `npm run e2e:prod` builds the app, serves
 * `dist/damas-vision/browser` with scripts/serve-dist.mjs and runs tests/e2e-prod.
 */
export default defineConfig({
  testDir: './tests/e2e-prod',
  globalSetup: './tests/e2e/support/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: { baseURL: `http://localhost:${PORT}` },
  projects: [
    {
      name: 'chromium-prod',
      use: {
        ...devices['Desktop Chrome'],
        permissions: ['camera'],
        launchOptions: {
          args: [
            '--use-fake-device-for-media-stream',
            `--use-file-for-fake-video-capture=${SYNTHETIC_BOARD_VIDEO}`,
            '--use-fake-ui-for-media-stream',
          ],
        },
      },
    },
  ],
  webServer: {
    command: `npx ng build && node scripts/serve-dist.mjs ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 240_000,
  },
});
