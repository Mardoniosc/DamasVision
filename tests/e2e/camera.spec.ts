import { expect, Page, test } from '@playwright/test';
import { liveTrackCount, recordStreams, streamCount } from './support/media-probe';

/**
 * E1 camera lifecycle in a real browser, using Chromium's synthetic camera
 * (see playwright.config.ts). Every stream the page opens is recorded so the
 * tests can prove none is left running (Gate G1: no leaked streams).
 */

async function activateCamera(page: Page): Promise<void> {
  await page.goto('/game/new');
  await page.getByRole('button', { name: 'Ativar câmera' }).click();
  await expect(page.getByRole('status')).toHaveText('Transmitindo');
}

test.describe('Camera (E1)', () => {
  test.beforeEach(async ({ page }) => {
    await recordStreams(page);
  });

  test('activates the camera and plays the preview', async ({ page }) => {
    await activateCamera(page);

    const preview = page.getByLabel('Pré-visualização da câmera');
    await expect
      .poll(() => preview.evaluate((video: HTMLVideoElement) => video.videoWidth))
      .toBeGreaterThan(0);
    await expect(page.getByLabel('Dispositivo').locator('option')).toHaveCount(2);
    expect(await liveTrackCount(page)).toBe(1);
  });

  test('switching devices keeps exactly one live stream', async ({ page }) => {
    await activateCamera(page);
    const select = page.getByLabel('Dispositivo');
    const second = await select.locator('option').nth(1).getAttribute('value');

    await select.selectOption(second ?? '');

    await expect(page.getByRole('status')).toHaveText('Transmitindo');
    await expect.poll(() => streamCount(page)).toBe(2);
    expect(await liveTrackCount(page)).toBe(1);
    await expect(select).toHaveValue(second ?? '');
  });

  test('turning the camera off stops every track', async ({ page }) => {
    await activateCamera(page);

    await page.getByRole('button', { name: 'Desligar câmera' }).click();

    await expect(page.getByRole('status')).toHaveText('Câmera disponível');
    expect(await liveTrackCount(page)).toBe(0);
    await expect(page.getByLabel('Pré-visualização da câmera')).toHaveCount(0);
  });

  test('captures frames, pauses and resumes', async ({ page }) => {
    await activateCamera(page);
    const processed = page.getByTestId('frames-processed');
    const count = async (): Promise<number> => Number(await processed.textContent());

    await page.getByRole('button', { name: 'Iniciar captura' }).click();
    await expect.poll(count).toBeGreaterThan(2);
    await expect(page.getByTestId('last-frame')).toContainText('×');

    await page.getByRole('button', { name: 'Pausar' }).click();
    await expect(page.getByTestId('capture-state')).toHaveText('Pausada');
    const paused = await count();
    await page.waitForTimeout(800);
    expect(await count()).toBe(paused);

    await page.getByRole('button', { name: 'Retomar' }).click();
    await expect.poll(count).toBeGreaterThan(paused);
  });

  test('leaving the page releases the camera (no leaked streams)', async ({ page }) => {
    await activateCamera(page);
    await page.getByRole('button', { name: 'Iniciar captura' }).click();
    await expect(page.getByTestId('capture-state')).toHaveText('Em execução');

    await page
      .getByRole('navigation', { name: 'Navegação principal' })
      .getByRole('link', { name: 'Partidas' })
      .click();

    await expect(page).toHaveURL('/games');
    expect(await streamCount(page)).toBe(1);
    expect(await liveTrackCount(page)).toBe(0);
  });

  test('repeated start/stop cycles never accumulate streams', async ({ page }) => {
    await activateCamera(page);
    for (let cycle = 0; cycle < 5; cycle++) {
      await page.getByRole('button', { name: 'Desligar câmera' }).click();
      await page.getByRole('button', { name: 'Ativar câmera' }).click();
      await expect(page.getByRole('status')).toHaveText('Transmitindo');
    }

    expect(await streamCount(page)).toBe(6);
    expect(await liveTrackCount(page)).toBe(1);
  });

  test('explains a denied permission and allows retrying', async ({ page }) => {
    await page.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = () =>
        Promise.reject(new DOMException('denied', 'NotAllowedError'));
    });
    await page.goto('/game/new');

    await page.getByRole('button', { name: 'Ativar câmera' }).click();

    await expect(page.getByRole('alert')).toContainText('Acesso à câmera negado');
    await expect(page.getByRole('button', { name: 'Tentar novamente' })).toBeEnabled();
  });
});
