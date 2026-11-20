import { expect, Page } from '@playwright/test';

/** The service as the app reaches it: its own port in `e2e:service`, the web origin in Docker. */
export const SERVICE_URL = process.env['E2E_SERVICE_URL'] ?? 'http://127.0.0.1:8766';
export const SERVICE_TIMEOUT = 60_000;

/** Chooses the local vision service in the settings (G3.1) and checks the connection. */
export async function useLocalService(page: Page, url = SERVICE_URL, probe = true): Promise<void> {
  await page.goto('/settings');
  if (process.env['E2E_SERVICE_MODE'] === 'server' && url === SERVICE_URL) {
    // Docker: the service of the app's own server (ADR-043).
    await page.getByTestId('provider-server').check();
  } else {
    await page.getByTestId('provider-service').check();
    await page.getByTestId('service-url').fill(url);
  }
  if (probe) {
    await page.getByTestId('test-service').click();
    await expect(page.getByTestId('probe-result')).toContainText('Serviço encontrado');
  }
  await page.getByTestId('save-provider').click();
  await expect(page.getByTestId('provider-status')).toBeVisible();
}

/** Calibration with the service: save, then open the recognition page. */
export async function calibrate(page: Page): Promise<void> {
  await page.goto('/calibration');
  await expect(page.getByTestId('calibration-validity')).toHaveText('Calibração válida');
  await page.getByRole('button', { name: 'Salvar calibração' }).click();
  await expect(page.getByTestId('save-status')).toBeVisible();
  await page.getByRole('link', { name: 'Continuar para o reconhecimento' }).click();
  await expect(page).toHaveURL('/recognition');
}

/** Counts the requests the page sends to the service, by path. */
export function recordServiceRequests(page: Page): Map<string, number> {
  const counts = new Map<string, number>();
  page.context().on('request', (request) => {
    const url = request.url();
    if (!url.startsWith(SERVICE_URL)) return;
    const path = new URL(url).pathname.replace(/\/sessions\/[0-9a-f]+/, '/sessions/{id}');
    const key = `${request.method()} ${path}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  });
  return counts;
}
