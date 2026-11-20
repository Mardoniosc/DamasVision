import { defineConfig, devices } from '@playwright/test';
import { MOVE_VIDEO, SYNTHETIC_BOARD_VIDEO } from './tests/e2e/support/paths';

const BASE_URL = 'http://localhost:8092';
// The specs reach the vision service on the web origin (nginx forwards /v1/).
process.env['E2E_SERVICE_URL'] = BASE_URL;
process.env['E2E_SERVICE_MODE'] = 'server';

/**
 * E2E against the containers (`docker compose up -d`): the production build served by nginx
 * on port 8092 and the vision service behind it. No web server is started here.
 */
export default defineConfig({
  testDir: './tests/e2e-service',
  globalSetup: './tests/e2e/support/global-setup.ts',
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: { baseURL: BASE_URL, trace: 'retain-on-failure' },
  projects: [
    {
      name: 'docker-board',
      testMatch: /(board\.service|automatic\.docker)\.spec\.ts/,
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
      name: 'docker-moves',
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
});
