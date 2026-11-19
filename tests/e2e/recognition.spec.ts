import { readFileSync } from 'node:fs';
import { expect, Page, test } from '@playwright/test';
import { liveTrackCount, recordStreams } from './support/media-probe';
import { E2E_POSITION } from './support/synthetic-video';

/**
 * E3 end to end in Chromium: the fake camera plays a synthetic board video, the
 * default calibration matches it, and the real worker + OpenCV.js read the position.
 */
const OPENCV_TIMEOUT = 60_000;

async function calibrateAndOpenRecognition(page: Page): Promise<void> {
  await page.goto('/calibration');
  await expect(page.getByTestId('calibration-validity')).toHaveText('Calibração válida');
  await page.getByRole('button', { name: 'Salvar calibração' }).click();
  await expect(page.getByTestId('save-status')).toBeVisible();
  await page.getByRole('link', { name: 'Continuar para o reconhecimento' }).click();
  await expect(page).toHaveURL('/recognition');
}

async function readBoard(page: Page): Promise<string[]> {
  return page
    .locator('[data-square]')
    .evaluateAll((squares) =>
      squares.map((s) => `${s.getAttribute('data-square')}:${s.getAttribute('data-piece')}`),
    );
}

function expectedBoard(): string[] {
  return E2E_POSITION.flatMap((piece, index) =>
    (Math.floor(index / 8) + (index % 8)) % 2 === 1 ? [`${index}:${piece}`] : [],
  );
}

test.describe('Recognition (E3)', () => {
  test.beforeEach(async ({ page }) => {
    await recordStreams(page);
  });

  test('reads the position on the synthetic board, kings included', async ({ page }) => {
    await calibrateAndOpenRecognition(page);

    await expect(page.getByTestId('recognition-status')).toHaveText('Leitura confiável', {
      timeout: OPENCV_TIMEOUT,
    });
    expect(await readBoard(page)).toEqual(expectedBoard());
    await expect(page.getByTestId('unknown-count')).toHaveText('0');
    await expect(page.getByTestId('recognition-overlay').locator('circle')).not.toHaveCount(0);
  });

  test('corrects a square and confirms the position', async ({ page }) => {
    await calibrateAndOpenRecognition(page);
    await expect(page.getByTestId('recognition-status')).toHaveText('Leitura confiável', {
      timeout: OPENCV_TIMEOUT,
    });

    await page.getByRole('button', { name: 'Pausar e corrigir' }).click();
    // b6 (index 17) holds a black man; pretend the reader got it wrong and fix it.
    await page.getByRole('button', { name: /^Casa b6:/ }).click();
    await page.getByRole('button', { name: 'Vazia', exact: true }).click();

    await expect(page.getByTestId('correction-metrics')).toContainText('31 de 32 casas corretas');
    await page.getByRole('button', { name: 'Desfazer correções' }).click();
    await expect(page.getByTestId('correction-metrics')).toContainText(
      '32 de 32 casas corretas (100%)',
    );

    await page.getByRole('button', { name: 'Confirmar posição' }).click();
    await expect(page.getByTestId('confirmed')).toContainText('8 brancas e 8 pretas');
  });

  test('leaving the page releases the camera and the vision worker', async ({ page }) => {
    await calibrateAndOpenRecognition(page);
    await expect(page.getByTestId('recognition-status')).toHaveText('Leitura confiável', {
      timeout: OPENCV_TIMEOUT,
    });
    // Only the recognition page's worker is alive now (calibration's was closed on leaving it).
    const recognitionWorkers = page.workers();
    expect(recognitionWorkers).toHaveLength(1);
    const closed = Promise.all(
      recognitionWorkers.map(
        (worker) => new Promise<void>((resolve) => worker.on('close', () => resolve())),
      ),
    );

    await page
      .getByRole('navigation', { name: 'Navegação principal' })
      .getByRole('link', { name: 'Início' })
      .click();

    await expect(page).toHaveURL('/');
    await closed;
    expect(await liveTrackCount(page)).toBe(0);
  });

  test('automatic adjustment snaps a misplaced corner back onto the board', async ({ page }) => {
    await page.goto('/calibration');
    await expect(page.getByTestId('calibration-validity')).toHaveText('Calibração válida');
    const corner = page.locator('[data-corner="topLeft"]');
    const original = (await corner.getAttribute('aria-label')) ?? '';
    const box = await corner.boundingBox();
    if (!box) throw new Error('handle not visible');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 12, box.y + box.height / 2 + 9, { steps: 6 });
    await page.mouse.up();
    await expect(corner).not.toHaveAttribute('aria-label', original);

    await page.getByRole('button', { name: 'Ajustar automaticamente' }).click();

    await expect(page.getByTestId('adjust-status')).toBeVisible({ timeout: OPENCV_TIMEOUT });
    const position = /x (\d+), y (\d+)/;
    const [, x, y] = position.exec((await corner.getAttribute('aria-label')) ?? '') ?? [];
    const [, x0, y0] = position.exec(original) ?? [];
    expect(Math.abs(Number(x) - Number(x0))).toBeLessThanOrEqual(2);
    expect(Math.abs(Number(y) - Number(y0))).toBeLessThanOrEqual(2);
  });

  test('exports a labeled sample of the confirmed position', async ({ page }) => {
    await calibrateAndOpenRecognition(page);
    await expect(page.getByTestId('recognition-status')).toHaveText('Leitura confiável', {
      timeout: OPENCV_TIMEOUT,
    });
    await page.getByRole('button', { name: 'Pausar e corrigir' }).click();
    await page.getByRole('button', { name: 'Confirmar posição' }).click();

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Baixar amostra rotulada' }).click(),
    ]);

    expect(download.suggestedFilename()).toMatch(/^damas-vision-amostra-.*\.json$/);
    const sample = JSON.parse(readFileSync((await download.path()) ?? '', 'utf8')) as {
      format: string;
      labels: string[];
      frame: { width: number; height: number; png: string };
      calibration: { orientation: string };
    };
    expect(sample.format).toBe('damas-vision/labeled-sample');
    expect(sample.labels).toEqual([...E2E_POSITION]);
    expect(sample.frame).toMatchObject({ width: 640, height: 480 });
    expect(sample.frame.png.startsWith('data:image/png;base64,iVBOR')).toBe(true);
    expect(sample.calibration.orientation).toBe('NORMAL');
    await expect(page.getByTestId('export-status')).toBeVisible();
  });
});
