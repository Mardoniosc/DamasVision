import { OpenCv } from '../opencv-loader';
import { RgbaImage } from '../perspective';
import { withResources } from '../resource-scope';

/**
 * Gaussian smoothing of the normalized board before feature extraction (OpenCV).
 * Sensor noise otherwise inflates the foreground fraction of empty squares, mostly in
 * dim light where the foreground threshold is small. `kernelSize` ≤ 1 disables it.
 */
export function denoise(cv: OpenCv, image: RgbaImage, kernelSize: number): RgbaImage {
  if (kernelSize <= 1) {
    return image;
  }
  return withResources((scope) => {
    const source = scope.track(cv.matFromArray(image.height, image.width, cv.CV_8UC4, image.data));
    const output = scope.track(new cv.Mat());
    cv.GaussianBlur(source, output, new cv.Size(kernelSize, kernelSize), 0, 0, cv.BORDER_REPLICATE);
    return { width: image.width, height: image.height, data: new Uint8ClampedArray(output.data) };
  });
}
