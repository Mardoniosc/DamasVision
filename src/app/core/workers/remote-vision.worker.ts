/// <reference lib="webworker" />
import { createRemoteVisionHandler } from './remote-vision.handler';

/**
 * Remote vision worker entry point (G3.1, ADR-042): answers the vision-worker protocol with
 * the optional local Python service. Frames are encoded here, off the main thread; this
 * worker loads no OpenCV.js.
 */
let canvas: OffscreenCanvas | null = null;

async function encode(
  bitmap: ImageBitmap,
  type: 'image/jpeg' | 'image/png',
  quality: number,
): Promise<Blob> {
  if (!canvas || canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
    canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  }
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('2D context unavailable in worker');
  }
  context.drawImage(bitmap, 0, 0);
  return canvas.convertToBlob({ type, quality });
}

const handle = createRemoteVisionHandler({
  fetch: (url, init) => fetch(url, init),
  post: (message, transfer = []) => postMessage(message, transfer),
  encode,
  decode: (blob) => createImageBitmap(blob),
  closeSelf: () => close(),
});

addEventListener('message', (event: MessageEvent<unknown>) => {
  void handle(event.data);
});
