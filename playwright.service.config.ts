import { defineConfig, devices } from '@playwright/test';
import { MOVE_VIDEO, SYNTHETIC_BOARD_VIDEO } from './tests/e2e/support/paths';

const PORT = 4300;
const BASE_URL = `http://localhost:${PORT}`;
/** The local vision service under test (not the default 8765, so a running copy is not reused). */
export const SERVICE_PORT = 8766;
const isCI = Boolean(process.env['CI']);

/**
 * E2E with the optional local vision service (G3.1, ADR-042): the app in Chromium with a
 * synthetic camera, the Python + OpenCV service as a second web server. Needs
 * `npm run vision:setup` once.
 */
export default defineConfig({
  testDir: './tests/e2e-service',
  globalSetup: './tests/e2e/support/global-setup.ts',
  // One browser at a time: every frame is processed by the same local service.
  workers: 1,
  forbidOnly: isCI,
  retries: 0,
  reporter: 'list',
  use: { baseURL: BASE_URL, trace: 'retain-on-failure' },
  projects: [
    {
      name: 'service-board',
      testMatch: /(board|profile)\.service\.spec\.ts/,
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
    {
      name: 'service-moves',
      testMatch: /moves\.service\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        permissions: ['camera'],
        launchOptions: {
          args: [
            '--use-fake-device-for-media-stream',
            `--use-file-for-fake-video-capture=${MOVE_VIDEO}`,
            '--use-fake-ui-for-media-stream',
          ],
        },
      },
    },
  ],
  webServer: [
    {
      command: `npx ng serve --port ${PORT}`,
      url: BASE_URL,
      reuseExistingServer: !isCI,
      timeout: 120_000,
    },
    {
      command: 'node scripts/vision-service.mjs serve',
      url: `http://127.0.0.1:${SERVICE_PORT}/v1/health`,
      env: { DAMAS_VISION_PORT: String(SERVICE_PORT), DAMAS_VISION_LOG_LEVEL: 'WARNING' },
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
