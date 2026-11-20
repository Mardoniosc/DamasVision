import { expect, Page, test } from '@playwright/test';
import { calibrateAndRecognize } from '../e2e/support/flows';

/**
 * E8-T05 — PWA/offline on the production build: the service worker installs and caches
 * the app (OpenCV.js included), the manifest makes it installable, and after going
 * offline the app still opens, calibrates and recognizes the board.
 */
async function waitForAppCached(page: Page): Promise<number> {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  // Every prefetched file of the "app" group is in the cache.
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const manifest = (await (await fetch('/ngsw.json')).json()) as {
            assetGroups: { name: string; urls: string[] }[];
          };
          const urls = manifest.assetGroups.find((group) => group.name === 'app')?.urls ?? [];
          const cached = await Promise.all(urls.map((url) => caches.match(url)));
          return cached.every(Boolean) ? urls.length : -1;
        }),
      { timeout: 60_000 },
    )
    .toBeGreaterThan(0);
  return page.evaluate(async () => {
    const manifest = (await (await fetch('/ngsw.json')).json()) as {
      assetGroups: { name: string; urls: string[] }[];
    };
    return manifest.assetGroups.find((group) => group.name === 'app')?.urls.length ?? 0;
  });
}

test('the manifest makes the app installable', async ({ page }) => {
  await page.goto('/');
  const manifest = await page.evaluate(async () => {
    const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    return link ? ((await (await fetch(link.href)).json()) as Record<string, unknown>) : null;
  });

  expect(manifest).toMatchObject({ name: 'Damas Vision', display: 'standalone', lang: 'pt-BR' });
  const icons = (manifest?.['icons'] ?? []) as { src: string; sizes: string }[];
  expect(icons.map((icon) => icon.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']));
  for (const icon of icons) {
    expect((await page.request.get(`/${icon.src}`)).ok()).toBe(true);
  }
});

test('works offline once installed: opens, calibrates and recognizes', async ({
  page,
  context,
}) => {
  test.setTimeout(180_000);
  await page.goto('/');
  const files = await waitForAppCached(page);
  test.info().annotations.push({ type: 'pwa', description: `${files} files prefetched` });
  await page.reload();
  expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);

  await context.setOffline(true);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Damas Vision' })).toBeVisible();
  await page.goto('/games');
  await expect(page.getByRole('heading', { level: 1, name: 'Partidas' })).toBeVisible();

  // OpenCV.js (17 MB) comes from the cache: vision works without a network.
  await calibrateAndRecognize(page);
  await context.setOffline(false);
});
