import { expect, Page, test } from '@playwright/test';
import { calibrateAndRecognize, startGameFromRecognition } from './support/flows';

/**
 * E8-T06 — accessibility and responsiveness review, automated part: every page at phone
 * and desktop widths. Checks: no horizontal scrolling, exactly one h1, and every button,
 * link, form field and image has an accessible name (Chromium accessibility tree). Colour
 * contrast and screen-reader flow are reviewed by hand (docs/testing/release-review.md).
 */
const VIEWPORTS = [
  { name: 'phone', width: 375, height: 812 },
  { name: 'desktop', width: 1280, height: 900 },
] as const;

const NAMED_ROLES = new Set([
  'button',
  'link',
  'textbox',
  'combobox',
  'checkbox',
  'image',
  'img',
  'radio',
  'switch',
  'slider',
]);

interface AxNode {
  role?: { value?: string };
  name?: { value?: string };
  ignored?: boolean;
}

async function review(page: Page, label: string): Promise<string[]> {
  const problems: string[] = [];
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  if (overflow > 1) problems.push(`${label}: page scrolls horizontally by ${overflow}px`);
  const h1 = await page.locator('main h1').count();
  if (h1 !== 1) problems.push(`${label}: ${h1} h1 elements in main`);

  const cdp = await page.context().newCDPSession(page);
  const { nodes } = (await cdp.send('Accessibility.getFullAXTree')) as { nodes: AxNode[] };
  await cdp.detach();
  for (const node of nodes) {
    const role = node.role?.value ?? '';
    if (node.ignored || !NAMED_ROLES.has(role)) continue;
    if (!node.name?.value?.trim()) problems.push(`${label}: ${role} without an accessible name`);
  }
  return problems;
}

for (const viewport of VIEWPORTS) {
  test(`every page is usable at ${viewport.name} width (${viewport.width}px)`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const problems: string[] = [];
    for (const url of ['/', '/game/new', '/games', '/settings']) {
      await page.goto(url);
      await expect(page.locator('main h1').first()).toBeVisible();
      problems.push(...(await review(page, url)));
    }
    await calibrateAndRecognize(page);
    problems.push(...(await review(page, '/recognition')));
    await page.getByTestId('debug-toggle').check();
    await expect(page.getByTestId('recognition-debug')).toBeVisible();
    problems.push(...(await review(page, '/recognition (diagnóstico)')));
    await page.getByTestId('debug-toggle').uncheck();
    await startGameFromRecognition(page);
    problems.push(...(await review(page, '/game/:id')));
    await page.goto('/calibration');
    await expect(page.getByTestId('calibration-validity')).toBeVisible();
    problems.push(...(await review(page, '/calibration')));

    expect(problems).toEqual([]);
  });
}

test('keyboard: Tab reaches the controls with a visible focus indicator', async ({ page }) => {
  await page.goto('/');
  const seen: string[] = [];
  // The home page has seven focusable controls (brand, navigation, two actions).
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Tab');
    const focus = await page.evaluate(() => {
      const element = document.activeElement as HTMLElement | null;
      if (!element || element === document.body) return null;
      const style = getComputedStyle(element);
      return {
        name: (element.getAttribute('aria-label') ?? element.textContent ?? '').trim(),
        visible: style.outlineStyle !== 'none' && style.outlineWidth !== '0px',
      };
    });
    expect(focus, `tab ${i + 1}`).not.toBeNull();
    expect(focus?.visible, `focus indicator on "${focus?.name}"`).toBe(true);
    seen.push(focus?.name ?? '');
  }
  expect(seen).toEqual(expect.arrayContaining(['Início', 'Nova partida']));
});
