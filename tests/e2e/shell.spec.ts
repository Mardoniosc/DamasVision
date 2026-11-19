import { expect, test } from '@playwright/test';

/**
 * E2E placeholder (E0-T03): verifies the shell boots in a real browser and every
 * top-level route is reachable through the primary navigation.
 */
test.describe('Application shell', () => {
  test('home page renders', async ({ page }) => {
    await page.goto('/');

    await expect(page).toHaveTitle('Damas Vision');
    await expect(page.getByRole('heading', { level: 1, name: 'Damas Vision' })).toBeVisible();
  });

  const destinations = [
    { link: 'Nova partida', url: '/game/new', heading: 'Nova partida' },
    { link: 'Calibração', url: '/calibration', heading: 'Calibração' },
    { link: 'Partidas', url: '/games', heading: 'Partidas' },
    { link: 'Configurações', url: '/settings', heading: 'Configurações' },
  ] as const;

  for (const { link, url, heading } of destinations) {
    test(`navigates to ${url}`, async ({ page }) => {
      await page.goto('/');
      const nav = page.getByRole('navigation', { name: 'Navegação principal' });

      await nav.getByRole('link', { name: link, exact: true }).click();

      await expect(page).toHaveURL(url);
      await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
      await expect(nav.getByRole('link', { name: link, exact: true })).toHaveAttribute(
        'aria-current',
        'page',
      );
    });
  }

  test('deep link to a live game shows its id', async ({ page }) => {
    await page.goto('/game/e2e-42');

    await expect(page.getByRole('heading', { level: 1, name: 'Partida' })).toBeVisible();
    await expect(page.getByText('e2e-42')).toBeVisible();
  });

  test('reports no console errors on load', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });

    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    expect(errors).toEqual([]);
  });
});
