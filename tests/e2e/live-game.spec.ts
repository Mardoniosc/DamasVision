import { expect, Page, test } from '@playwright/test';
import { liveTrackCount, recordStreams } from './support/media-probe';

/**
 * E6 end to end in Chromium (Gate G6): setup → calibration → recognition → confirmed
 * position → game start → live game with the camera (synthetic board video, a still
 * position) → manual move → recovery → undo → pause/resume → end → leave.
 */
const OPENCV_TIMEOUT = 60_000;

async function startGame(page: Page): Promise<void> {
  await page.goto('/calibration');
  await expect(page.getByTestId('calibration-validity')).toHaveText('Calibração válida');
  await page.getByRole('button', { name: 'Salvar calibração' }).click();
  await expect(page.getByTestId('save-status')).toBeVisible();
  await page.getByRole('link', { name: 'Continuar para o reconhecimento' }).click();
  await expect(page.getByTestId('recognition-status')).toHaveText('Leitura confiável', {
    timeout: OPENCV_TIMEOUT,
  });
  await page.getByRole('button', { name: 'Pausar e corrigir' }).click();
  await page.getByRole('button', { name: 'Confirmar posição' }).click();
  await page.getByTestId('white-label').fill('Ana');
  await page.getByTestId('black-label').fill('Bruno');
  // The video shows a mid-game position: the setup asks who moves.
  await page.getByTestId('player-to-move').selectOption('WHITE');
  await page.getByRole('button', { name: 'Iniciar partida' }).click();
  await expect(page).toHaveURL(/\/game\/[0-9a-f-]{36}$/);
}

test.describe('Live game (E6)', () => {
  test.beforeEach(async ({ page }) => {
    await recordStreams(page);
  });

  test('plays, recovers, undoes, pauses and ends a game', async ({ page }) => {
    await startGame(page);

    await expect(page.getByRole('heading', { level: 1, name: 'Ana × Bruno' })).toBeVisible();
    await expect(page.getByTestId('game-phase')).toHaveText('Acompanhando o tabuleiro', {
      timeout: OPENCV_TIMEOUT,
    });
    await expect(page.getByTestId('to-move')).toHaveText('Brancas (Ana)');

    // Register a move by hand. The camera still sees the old position, so the game then
    // reports that the physical board matches no legal move — never a false move.
    await page.getByText('Registrar lance manualmente').click();
    const move = page.locator('[data-move]').first();
    const notation = (await move.getAttribute('data-move')) ?? '';
    await move.click();
    await expect(page.getByTestId('last-move')).toHaveText(`Brancas: ${notation}`);
    await expect(page.getByTestId('to-move')).toHaveText('Pretas (Bruno)');
    await expect(page.getByTestId('pending-decision')).toContainText('nenhum lance legal', {
      timeout: OPENCV_TIMEOUT,
    });
    await expect(page.getByTestId('move-history')).toContainText(`${notation} (Brancas, manual)`);

    // Undo: the official board matches the camera again.
    await page.getByRole('button', { name: 'Desfazer último lance' }).click();
    await expect(page.getByTestId('last-move')).toHaveText('—');
    await expect(page.getByTestId('pending-decision')).toHaveCount(0, { timeout: OPENCV_TIMEOUT });

    await page.getByRole('button', { name: 'Pausar' }).click();
    await expect(page.getByTestId('game-phase')).toHaveText('Partida pausada');
    await page.getByRole('button', { name: 'Retomar' }).click();
    await expect(page.getByTestId('game-phase')).toHaveText('Acompanhando o tabuleiro');

    await page.getByRole('button', { name: 'Encerrar partida' }).click();
    await page.getByRole('button', { name: 'Pretas desistem' }).click();
    await expect(page.getByTestId('game-result')).toHaveText('Vitória das brancas (desistência).');
  });

  test('the game survives a reload and is listed in the history (E7)', async ({ page }) => {
    await startGame(page);
    await expect(page.getByTestId('game-phase')).toHaveText('Acompanhando o tabuleiro', {
      timeout: OPENCV_TIMEOUT,
    });
    await page.getByText('Registrar lance manualmente').click();
    const move = page.locator('[data-move]').first();
    const notation = (await move.getAttribute('data-move')) ?? '';
    await move.click();
    await expect(page.getByTestId('last-move')).toHaveText('Brancas: ' + notation);
    const url = page.url();

    await page.reload();

    await expect(page).toHaveURL(url);
    await expect(page.getByRole('heading', { level: 1, name: 'Ana × Bruno' })).toBeVisible();
    await expect(page.getByTestId('last-move')).toHaveText('Brancas: ' + notation);
    await expect(page.getByTestId('to-move')).toHaveText('Pretas (Bruno)');
    await expect(page.getByTestId('move-history')).toContainText(notation);

    await page.goto('/');
    await expect(page.getByTestId('resume-game')).toContainText('Ana × Bruno');
    await page.getByRole('link', { name: 'Continuar partida' }).click();
    await expect(page).toHaveURL(url);

    await page.goto('/games');
    const row = page.locator('[data-game]');
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('1 lance(s)');
    await row.getByRole('button', { name: 'Excluir' }).click();
    await row.getByRole('button', { name: 'Confirmar exclusão' }).click();
    await expect(page.getByText('Nenhuma partida salva ainda.')).toBeVisible();
  });

  test('leaving the live game releases the camera and the worker', async ({ page }) => {
    await startGame(page);
    await expect(page.getByTestId('game-phase')).toHaveText('Acompanhando o tabuleiro', {
      timeout: OPENCV_TIMEOUT,
    });

    await page
      .getByRole('navigation', { name: 'Navegação principal' })
      .getByRole('link', { name: 'Início' })
      .click();

    await expect(page).toHaveURL('/');
    await expect.poll(() => liveTrackCount(page)).toBe(0);
  });
});
