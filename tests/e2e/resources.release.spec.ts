import { expect, test } from '@playwright/test';
import {
  calibrateAndRecognize,
  heapAfterGc,
  mainNav,
  OPENCV_TIMEOUT,
  startGameFromRecognition,
} from './support/flows';
import { liveTrackCount, recordStreams } from './support/media-probe';

/**
 * E8-T04 — resource-leak tests. Repeatedly entering and leaving the pages that use the
 * camera and the vision worker (live game, calibration) inside one page session must not
 * leave camera tracks, workers or memory behind.
 */
const CYCLES = 6;
/** Main-thread heap growth allowed between the first and the last cycle, after GC. */
const MAX_HEAP_GROWTH_BYTES = 8 * 1024 * 1024;

test('entering and leaving the camera pages leaks no tracks, workers or memory', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await recordStreams(page);
  await calibrateAndRecognize(page);
  await startGameFromRecognition(page);

  const heaps: number[] = [];
  for (let cycle = 0; cycle < CYCLES; cycle++) {
    await mainNav(page).getByRole('link', { name: 'Início' }).click();
    await expect.poll(() => page.workers().length).toBe(0);
    await expect.poll(() => liveTrackCount(page)).toBe(0);

    // Live game: camera + worker + OpenCV.
    await page.getByRole('link', { name: 'Continuar partida' }).click();
    await expect(page.getByTestId('game-phase')).toHaveText('Acompanhando o tabuleiro', {
      timeout: OPENCV_TIMEOUT,
    });
    await expect.poll(() => liveTrackCount(page)).toBe(1);
    await expect.poll(() => page.workers().length).toBe(1);

    // Calibration: another camera + worker.
    await mainNav(page).getByRole('link', { name: 'Calibração' }).click();
    await expect(page.getByTestId('calibration-validity')).toHaveText('Calibração válida');
    await expect.poll(() => liveTrackCount(page)).toBe(1);

    await mainNav(page).getByRole('link', { name: 'Início' }).click();
    await expect.poll(() => page.workers().length).toBe(0);
    await expect.poll(() => liveTrackCount(page)).toBe(0);
    heaps.push(await heapAfterGc(page));
  }

  const growth = (heaps.at(-1) ?? 0) - (heaps[0] ?? 0);
  test.info().annotations.push({
    type: 'heap',
    description: `main-thread heap after GC per cycle (MB): ${heaps.map((h) => (h / 1048576).toFixed(1)).join(', ')}`,
  });
  expect(growth).toBeLessThan(MAX_HEAP_GROWTH_BYTES);
});

test('a live game running for a while keeps a bounded heap and keeps tracking', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await recordStreams(page);
  await calibrateAndRecognize(page);
  await startGameFromRecognition(page);

  const start = await heapAfterGc(page);
  await page.waitForTimeout(30_000);
  const end = await heapAfterGc(page);

  test.info().annotations.push({
    type: 'heap',
    description: `live game heap after GC: ${(start / 1048576).toFixed(1)} MB → ${(end / 1048576).toFixed(1)} MB over 30 s`,
  });
  expect(end - start).toBeLessThan(MAX_HEAP_GROWTH_BYTES);
  await expect(page.getByTestId('game-phase')).toHaveText('Acompanhando o tabuleiro');
});
