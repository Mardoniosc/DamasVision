import { expect, Locator, Page, test } from '@playwright/test';
import { liveTrackCount, recordStreams, streamCount } from './support/media-probe';

/**
 * E2 calibration in a real browser: Chromium's synthetic camera, the real vision
 * worker and the bundled OpenCV.js build, and real IndexedDB.
 */

const OPENCV_READY_TIMEOUT = 60_000;

async function openCalibration(page: Page): Promise<void> {
  await page.goto('/calibration');
  await expect(page.locator('[data-corner]')).toHaveCount(4);
  await expect(validity(page)).toHaveText('Calibração válida');
}

function validity(page: Page): Locator {
  return page.getByTestId('calibration-validity');
}

function handle(page: Page, corner: string): Locator {
  return page.locator(`[data-corner="${corner}"]`);
}

async function center(locator: Locator): Promise<{ x: number; y: number }> {
  const box = await locator.boundingBox();
  if (!box) throw new Error('element not visible');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function drag(page: Page, from: Locator, to: { x: number; y: number }): Promise<void> {
  const start = await center(from);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
}

test.describe('Calibration (E2)', () => {
  test.beforeEach(async ({ page }) => {
    await recordStreams(page);
  });

  test('generates the normalized board through the vision worker (OpenCV.js)', async ({ page }) => {
    await openCalibration(page);
    await expect(page.getByTestId('worker-status')).toHaveText('Processamento de imagem pronto.', {
      timeout: OPENCV_READY_TIMEOUT,
    });

    await page.getByRole('button', { name: 'Gerar imagem normalizada' }).click();

    const canvas = page.getByTestId('normalized-preview').locator('canvas');
    await expect(canvas).toBeVisible();
    await expect(canvas).toHaveJSProperty('width', 800);
    // The synthetic camera image is mostly green: the warped image must not be blank.
    const meanGreen = (element: HTMLCanvasElement): number => {
      const data = element.getContext('2d')?.getImageData(0, 0, element.width, element.height).data;
      if (!data) return 0;
      let sum = 0;
      for (let i = 1; i < data.length; i += 4) sum += data[i] ?? 0;
      return sum / (data.length / 4);
    };
    await expect.poll(() => canvas.evaluate(meanGreen)).toBeGreaterThan(80);
  });

  test('dragging a corner over another invalidates the calibration; reset restores it', async ({
    page,
  }) => {
    await openCalibration(page);

    await drag(page, handle(page, 'topLeft'), await center(handle(page, 'bottomRight')));

    await expect(validity(page)).toHaveText('Calibração inválida');
    await expect(page.getByTestId('calibration-issues')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Salvar calibração' })).toBeDisabled();

    await page.getByRole('button', { name: 'Restaurar cantos' }).click();
    await expect(validity(page)).toHaveText('Calibração válida');
  });

  test('moves a corner with the keyboard', async ({ page }) => {
    await openCalibration(page);
    const corner = handle(page, 'topRight');
    const labelBefore = (await corner.getAttribute('aria-label')) ?? '';
    const xBefore = Number(/x (\d+)/.exec(labelBefore)?.[1]);

    await corner.focus();
    await page.keyboard.press('Shift+ArrowRight');
    await page.keyboard.press('ArrowRight');

    await expect(corner).toHaveAttribute('aria-label', new RegExp(`x ${xBefore + 11},`));
  });

  test('rotates the orientation', async ({ page }) => {
    await openCalibration(page);

    await page.getByRole('button', { name: 'Girar 90°' }).click();

    await expect(page.getByTestId('orientation')).toHaveText('90°');
  });

  test('saves the calibration and restores it after a reload', async ({ page }) => {
    await openCalibration(page);
    const corner = handle(page, 'bottomLeft');
    const start = await center(corner);
    await drag(page, corner, { x: start.x - 25, y: start.y + 10 });
    await page.getByRole('button', { name: 'Girar 90°' }).click();
    const savedLabel = await corner.getAttribute('aria-label');

    await page.getByRole('button', { name: 'Salvar calibração' }).click();
    await expect(page.getByTestId('save-status')).toBeVisible();

    await page.reload();
    await expect(page.locator('[data-corner]')).toHaveCount(4);
    await expect(page.getByText(/Calibração ativa:/)).toBeVisible();
    await expect(handle(page, 'bottomLeft')).toHaveAttribute('aria-label', savedLabel ?? '');
    await expect(page.getByTestId('orientation')).toHaveText('90°');
  });

  test('camera hand-over from setup to calibration keeps one stream, released on exit', async ({
    page,
  }) => {
    await page.goto('/game/new');
    await page.getByRole('button', { name: 'Ativar câmera' }).click();
    await page.getByRole('link', { name: 'Continuar para a calibração' }).click();
    await expect(page).toHaveURL('/calibration');
    await expect(page.locator('[data-corner]')).toHaveCount(4);
    expect(await liveTrackCount(page)).toBe(1);

    await page
      .getByRole('navigation', { name: 'Navegação principal' })
      .getByRole('link', { name: 'Partidas' })
      .click();

    await expect(page).toHaveURL('/games');
    expect(await streamCount(page)).toBe(2);
    expect(await liveTrackCount(page)).toBe(0);
  });

  test('terminates the vision worker when leaving the page', async ({ page }) => {
    const closed = new Promise<void>((resolve) => {
      page.on('worker', (worker) => worker.on('close', () => resolve()));
    });
    await openCalibration(page);
    await expect(page.getByTestId('worker-status')).toHaveText('Processamento de imagem pronto.', {
      timeout: OPENCV_READY_TIMEOUT,
    });

    await page
      .getByRole('navigation', { name: 'Navegação principal' })
      .getByRole('link', { name: 'Início' })
      .click();

    await expect(closed).resolves.toBeUndefined();
  });
});
