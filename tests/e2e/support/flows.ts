import { expect, Page } from '@playwright/test';

export const OPENCV_TIMEOUT = 60_000;

/** Saves the default calibration and opens the recognition page with a reliable reading. */
export async function calibrateAndRecognize(page: Page): Promise<void> {
  await page.goto('/calibration');
  await expect(page.getByTestId('calibration-validity')).toHaveText('Calibração válida');
  await page.getByRole('button', { name: 'Salvar calibração' }).click();
  await expect(page.getByTestId('save-status')).toBeVisible();
  await page.getByRole('link', { name: 'Continuar para o reconhecimento' }).click();
  await expect(page.getByTestId('recognition-status')).toHaveText('Leitura confiável', {
    timeout: OPENCV_TIMEOUT,
  });
}

/** Confirms the recognized position and starts a game from it; returns the game URL. */
export async function startGameFromRecognition(page: Page): Promise<string> {
  await page.getByRole('button', { name: 'Pausar e corrigir' }).click();
  await page.getByRole('button', { name: 'Confirmar posição' }).click();
  const toMove = page.getByTestId('player-to-move');
  if ((await toMove.count()) > 0) await toMove.selectOption('WHITE');
  await page.getByRole('button', { name: 'Iniciar partida' }).click();
  await expect(page).toHaveURL(/\/game\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId('game-phase')).toHaveText('Acompanhando o tabuleiro', {
    timeout: OPENCV_TIMEOUT,
  });
  return page.url();
}

/** Main-thread JS heap after a forced garbage collection (Chromium DevTools protocol). */
export async function heapAfterGc(page: Page): Promise<number> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('HeapProfiler.collectGarbage');
  const { usedSize } = await cdp.send('Runtime.getHeapUsage');
  await cdp.detach();
  return usedSize;
}

export function mainNav(page: Page) {
  return page.getByRole('navigation', { name: 'Navegação principal' });
}
