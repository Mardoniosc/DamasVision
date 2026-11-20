import { expect, test } from '@playwright/test';
import { VIDEO_MOVES } from '../e2e/support/move-video';
import { calibrate, SERVICE_TIMEOUT, useLocalService } from './support';

/**
 * G3.1: the moves of a game detected through the local service. The service only observes;
 * the app's stabilizer, move inference and engine decide, exactly as in E8-T01.
 */
test('the service observes and the engine records the moves', async ({ page }) => {
  test.setTimeout(150_000);
  await useLocalService(page);
  await calibrate(page);
  await expect(page.getByTestId('recognition-status')).toHaveText('Leitura confiável', {
    timeout: SERVICE_TIMEOUT,
  });
  await page.getByRole('button', { name: 'Pausar e corrigir' }).click();
  await page.getByRole('button', { name: 'Confirmar posição' }).click();
  await page.getByRole('button', { name: 'Iniciar partida' }).click();
  await expect(page).toHaveURL(/\/game\//);

  const history = page.getByTestId('move-history');
  await expect(history).toContainText(VIDEO_MOVES[0], { timeout: 90_000 });
  await expect(history).toContainText(VIDEO_MOVES[1], { timeout: 60_000 });
  await expect(history).not.toContainText('manual');
  await page.getByText('Registrar lance manualmente').click();
  await expect(page.locator('[data-move]')).toHaveAttribute('data-move', 'd4xf6');
});
