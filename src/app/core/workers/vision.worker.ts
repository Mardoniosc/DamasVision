/// <reference lib="webworker" />
import { createOpenCvLoader } from '../../vision/opencv-loader';
import { RgbaImage } from '../../vision/perspective';
import { createVisionWorkerHandler } from './vision-worker.handler';

/**
 * Vision worker entry point: wires the protocol handler to the worker global scope.
 * All OpenCV processing happens here, off the main thread (spec §2).
 */
let canvas: OffscreenCanvas | null = null;

function readBitmap(bitmap: ImageBitmap): RgbaImage {
  if (!canvas || canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
    canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  }
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    throw new Error('2D context unavailable in worker');
  }
  context.drawImage(bitmap, 0, 0);
  const { data, width, height } = context.getImageData(0, 0, bitmap.width, bitmap.height);
  return { data, width, height };
}

function createBitmap(image: RgbaImage): Promise<ImageBitmap> {
  const pixels = new Uint8ClampedArray(image.width * image.height * 4);
  pixels.set(image.data);
  return createImageBitmap(new ImageData(pixels, image.width, image.height));
}

const handle = createVisionWorkerHandler({
  loadOpenCv: createOpenCvLoader(),
  post: (message, transfer = []) => postMessage(message, transfer),
  readBitmap,
  createBitmap,
});

addEventListener('message', (event: MessageEvent<unknown>) => {
  void handle(event.data);
});
