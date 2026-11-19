import { OpenCv } from '../opencv-loader';
import { RgbaImage } from '../perspective';
import { withResources } from '../resource-scope';

export interface FrameQuality {
  /** Variance of the Laplacian of the grayscale image (higher = sharper). */
  readonly sharpness: number;
  /** Mean luminance 0..1. */
  readonly meanLuminance: number;
}

/**
 * Sharpness and exposure of the rectified board (spec §7 "Frame quality"), via OpenCV.
 * Issues are decided by stage A (`assessFrame`); they are advisory only.
 */
export function measureFrameQuality(cv: OpenCv, image: RgbaImage): FrameQuality {
  return withResources((scope) => {
    const rgba = scope.track(cv.matFromArray(image.height, image.width, cv.CV_8UC4, image.data));
    const gray = scope.track(new cv.Mat());
    const laplacian = scope.track(new cv.Mat());
    const mean = scope.track(new cv.Mat());
    const deviation = scope.track(new cv.Mat());
    cv.cvtColor(rgba, gray, cv.COLOR_RGBA2GRAY);
    cv.Laplacian(gray, laplacian, cv.CV_64F);
    cv.meanStdDev(laplacian, mean, deviation);
    const std = deviation.data64F[0] ?? 0;
    const meanGray = cv.mean(gray)[0] ?? 0;
    return { sharpness: std * std, meanLuminance: meanGray / 255 };
  });
}
