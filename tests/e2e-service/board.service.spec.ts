import { expect, test } from '@playwright/test';
import { liveTrackCount, recordStreams } from '../e2e/support/media-probe';
import { E2E_POSITION } from '../e2e/support/synthetic-video';
import { calibrate, recordServiceRequests, SERVICE_TIMEOUT, useLocalService } from './support';

/**
 * G3.1 end to end with the local vision service: the Angular app captures the camera,
 * the Python + OpenCV service calibrates, rectifies and recognizes, and the app shows,
 * diagnoses and corrects the reading exactly as with the browser recognizer.
 */
function expectedBoard(): string[] {
  return E2E_POSITION.flatMap((piece, index) =>
    (Math.floor(index / 8) + (index % 8)) % 2 === 1 ? [`${index}:${piece}`] : [],
  );
}

test.beforeEach(async ({ page }) => {
  await recordStreams(page);
});

test('calibrates, recognizes, diagnoses and corrects through the service', async ({ page }) => {
  test.setTimeout(120_000);
  const requests = recordServiceRequests(page);
  await useLocalService(page);

  // Calibration: the preview is rectified and the corners adjusted by the service.
  await page.goto('/calibration');
  await expect(page.getByTestId('calibration-validity')).toHaveText('Calibração válida');
  await page.getByRole('button', { name: 'Gerar imagem normalizada' }).click();
  await expect(page.getByTestId('normalized-preview')).toBeVisible({ timeout: SERVICE_TIMEOUT });
  await page.getByRole('button', { name: 'Ajustar automaticamente' }).click();
  await expect(page.getByTestId('adjust-status')).toBeVisible({ timeout: SERVICE_TIMEOUT });
  await page.getByRole('button', { name: 'Salvar calibração' }).click();
  await expect(page.getByTestId('save-status')).toBeVisible();
  await page.getByRole('link', { name: 'Continuar para o reconhecimento' }).click();

  await expect(page.getByTestId('recognition-status')).toHaveText('Leitura confiável', {
    timeout: SERVICE_TIMEOUT,
  });
  const board = await page
    .locator('[data-square]')
    .evaluateAll((squares) =>
      squares.map((s) => `${s.getAttribute('data-square')}:${s.getAttribute('data-piece')}`),
    );
  expect(board).toEqual(expectedBoard());
  await expect(page.getByTestId('unknown-count')).toHaveText('0');

  // Diagnostic mode: rectified image, mask and traces come from the service.
  await page.getByTestId('debug-toggle').check();
  const panel = page.getByTestId('recognition-debug');
  await expect(page.getByTestId('debug-provider')).toContainText('serviço local');
  await expect(panel.locator('[data-debug-square]')).toHaveCount(32);
  await panel.locator('[data-debug-square="17"]').click();
  await expect(page.getByTestId('inspected-explanation')).toContainText('Preta');
  const mask = page.getByTestId('inspected-mask');
  await expect
    .poll(() =>
      mask.evaluate((canvas: HTMLCanvasElement) => {
        const data = canvas.getContext('2d')?.getImageData(0, 0, canvas.width, canvas.height).data;
        let white = 0;
        for (let i = 0; data && i < data.length; i += 4) if ((data[i] ?? 0) > 200) white++;
        return white;
      }),
    )
    .toBeGreaterThan(1000); // b6 holds a piece: its disk is foreground
  await page.getByTestId('debug-toggle').uncheck();

  // Manual correction and confirmation (app side, unchanged).
  await page.getByRole('button', { name: 'Pausar e corrigir' }).click();
  await page.getByRole('button', { name: /^Casa b6:/ }).click();
  await page.getByRole('button', { name: 'Vazia', exact: true }).click();
  await expect(page.getByTestId('correction-metrics')).toContainText('31 de 32 casas corretas');
  await page.getByRole('button', { name: 'Desfazer correções' }).click();
  await page.getByRole('button', { name: 'Confirmar posição' }).click();
  await expect(page.getByTestId('confirmed')).toContainText('8 brancas e 8 pretas');

  // Every vision request went to the service; no OpenCV.js worker was needed.
  expect(requests.get('POST /v1/sessions') ?? 0).toBeGreaterThanOrEqual(2);
  expect(requests.get('POST /v1/sessions/{id}/calibration/refine')).toBe(1);
  expect(requests.get('POST /v1/sessions/{id}/rectify') ?? 0).toBeGreaterThan(0);
  expect(requests.get('POST /v1/sessions/{id}/frames') ?? 0).toBeGreaterThan(3);

  // Leaving releases the camera and closes the service session.
  await page
    .getByRole('navigation', { name: 'Navegação principal' })
    .getByRole('link', { name: 'Início' })
    .click();
  await expect.poll(() => liveTrackCount(page)).toBe(0);
  await expect.poll(() => requests.get('DELETE /v1/sessions/{id}') ?? 0).toBeGreaterThanOrEqual(1);
});

test('an unreachable service is reported, never replaced silently', async ({ page }) => {
  const opencv: string[] = [];
  page.on('request', (request) => {
    if (/opencv/i.test(request.url())) opencv.push(request.url());
  });
  await useLocalService(page, 'http://127.0.0.1:8799', false);
  await calibrate(page);

  await expect(page.getByRole('alert')).toContainText('serviço de visão local não respondeu', {
    timeout: SERVICE_TIMEOUT,
  });
  await expect(page.getByRole('alert')).toContainText('http://127.0.0.1:8799');
  await expect(page.locator('[data-square][data-piece="BLACK"]')).toHaveCount(0);
  expect(opencv).toEqual([]); // no silent fallback to the browser recognizer (OpenCV.js)
});
