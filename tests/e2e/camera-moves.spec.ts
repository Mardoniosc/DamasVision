import { expect, test } from '@playwright/test';
import { VIDEO_MOVES } from './support/move-video';

/**
 * E8-T01 — moves detected by the camera, end to end in Chromium: the fake camera plays a
 * video of a game (the opening, then c3-d4, then f6-e5). The real frame scheduler, vision
 * worker (OpenCV.js), recognition stabilizer, move inference and game controller must
 * register both moves from the camera alone.
 */
const OPENCV_TIMEOUT = 60_000;

test('the camera alone records the moves of a game', async ({ page }) => {
  test.setTimeout(150_000);
  await page.goto('/calibration');
  await expect(page.getByTestId('calibration-validity')).toHaveText('Calibração válida');
  await page.getByRole('button', { name: 'Salvar calibração' }).click();
  await page.getByRole('link', { name: 'Continuar para o reconhecimento' }).click();
  await expect(page.getByTestId('recognition-status')).toHaveText('Leitura confiável', {
    timeout: OPENCV_TIMEOUT,
  });
  await page.getByRole('button', { name: 'Pausar e corrigir' }).click();
  await page.getByRole('button', { name: 'Confirmar posição' }).click();
  // The standard opening: no side-to-move question.
  await expect(page.getByTestId('player-to-move')).toHaveCount(0);
  await page.getByRole('button', { name: 'Iniciar partida' }).click();
  await expect(page).toHaveURL(/\/game\//);

  const history = page.getByTestId('move-history');
  await expect(history).toContainText(VIDEO_MOVES[0], { timeout: 90_000 });
  await expect(history).toContainText(VIDEO_MOVES[1], { timeout: 60_000 });
  await expect(history).not.toContainText('manual');
  await expect(page.getByTestId('last-move')).toHaveText(`Pretas: ${VIDEO_MOVES[1]}`);
  // White must now capture d4xf6: the engine, not the camera, knows that.
  await page.getByText('Registrar lance manualmente').click();
  await expect(page.locator('[data-move]')).toHaveCount(1);
  await expect(page.locator('[data-move]')).toHaveAttribute('data-move', 'd4xf6');
});
