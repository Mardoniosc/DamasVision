import { Page } from '@playwright/test';

/**
 * Records every MediaStream the page opens so tests can assert that none is left
 * running (no leaked camera streams). Must be installed before navigation.
 */
interface StreamProbe {
  __dvStreams: MediaStream[];
}

export async function recordStreams(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const probe = window as unknown as StreamProbe;
    probe.__dvStreams = [];
    const mediaDevices = navigator.mediaDevices;
    const original = mediaDevices.getUserMedia.bind(mediaDevices);
    mediaDevices.getUserMedia = async (constraints) => {
      const stream = await original(constraints);
      probe.__dvStreams.push(stream);
      return stream;
    };
  });
}

export function liveTrackCount(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      (window as unknown as StreamProbe).__dvStreams
        .flatMap((stream) => stream.getTracks())
        .filter((track) => track.readyState === 'live').length,
  );
}

export function streamCount(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as StreamProbe).__dvStreams.length);
}
