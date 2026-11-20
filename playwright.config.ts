import { defineConfig, devices } from '@playwright/test';
import { SYNTHETIC_BOARD_VIDEO } from './tests/e2e/support/paths';

const PORT = 4300;
const BASE_URL = `http://localhost:${PORT}`;
const isCI = Boolean(process.env['CI']);
/** Specs that need the synthetic board video (recognition and the live game). */
const RECOGNITION_SPECS = /(recognition|live-game)\.spec\.ts/;

/**
 * E2E in Chromium with synthetic cameras:
 * - `chromium`: Chromium's built-in test pattern (two fake devices);
 * - `chromium-board`: a generated video of a synthetic checkers board
 *   (tests/e2e/support/synthetic-video.ts), for end-to-end recognition.
 */
export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: './tests/e2e/support/global-setup.ts',
  fullyParallel: true,
  // Each page may load OpenCV.js (17 MB) in a worker; more parallel browsers overload the machine.
  workers: isCI ? 2 : 4,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  reporter: isCI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      testIgnore: RECOGNITION_SPECS,
      use: {
        ...devices['Desktop Chrome'],
        permissions: ['camera'],
        launchOptions: {
          args: [
            '--use-fake-device-for-media-stream=device-count=2',
            '--use-fake-ui-for-media-stream',
          ],
        },
      },
    },
    {
      name: 'chromium-board',
      testMatch: RECOGNITION_SPECS,
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
    command: `npx ng serve --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !isCI,
    timeout: 120_000,
  },
});
