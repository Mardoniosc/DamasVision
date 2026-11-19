/**
 * Browser-side export helpers (presentation utilities, no camera or storage access).
 */

/** Encodes a bitmap as a PNG data URL through a temporary canvas. */
export function bitmapToPngDataUrl(bitmap: ImageBitmap): string {
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('2D canvas unavailable');
  }
  context.drawImage(bitmap, 0, 0);
  return canvas.toDataURL('image/png');
}

/** Offers `data` to the user as a JSON file download. */
export function downloadJson(fileName: string, data: unknown): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // Give the browser time to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
