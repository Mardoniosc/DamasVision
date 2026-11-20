import { expect, test } from '@playwright/test';
import { calibrate, recordServiceRequests, SERVICE_TIMEOUT } from './support';

/**
 * ADR-043: served by the Docker image, a fresh browser uses the vision service of the server
 * with no configuration (`/deployment.json`), and the settings show that choice.
 */
test('a fresh browser uses the server vision service without configuration', async ({ page }) => {
  test.setTimeout(120_000);
  const requests = recordServiceRequests(page);

  await calibrate(page);
  await expect(page.getByTestId('recognition-status')).toHaveText('Leitura confiável', {
    timeout: SERVICE_TIMEOUT,
  });
  // Every frame goes to the service on the server.
  await expect
    .poll(() => requests.get('POST /v1/sessions/{id}/frames') ?? 0)
    .toBeGreaterThanOrEqual(5);

  await page.goto('/settings');
  await expect(page.getByTestId('provider-server')).toBeChecked();
  await expect(page.getByText('(recomendado por este servidor)')).toBeVisible();
  await page.getByTestId('test-service').click();
  await expect(page.getByTestId('probe-result')).toContainText('Serviço encontrado');
});
