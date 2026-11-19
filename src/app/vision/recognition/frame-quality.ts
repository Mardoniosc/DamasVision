import { OpenCv } from '../opencv-loader';
import { RgbaImage } from '../perspective';
import { withResources } from '../resource-scope';
import { ColorThresholds, ShapeThresholds } from './classifier.config';
import { FrameQualityWarning } from './recognize-board';

export interface FrameQuality {
  /** Variance of the Laplacian of the grayscale image (higher = sharper). */
  readonly sharpness: number;
  /** Mean luminance 0..1. */
  readonly meanLuminance: number;
}

/** Sharpness and exposure of the normalized board (spec §7 "Frame quality"), via OpenCV. */
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

/** Advisory warnings only: thresholds are unvalidated, so frames are never rejected. */
export function qualityWarnings(
  quality: FrameQuality,
  color: ColorThresholds,
  shape: ShapeThresholds,
): FrameQualityWarning[] {
  const warnings: FrameQualityWarning[] = [];
  if (quality.sharpness < shape.minSharpness) {
    warnings.push({ code: 'LOW_SHARPNESS', message: 'A imagem parece desfocada ou tremida.' });
  }
  if (quality.meanLuminance < color.underexposedMaxLuminance) {
    warnings.push({
      code: 'UNDEREXPOSED',
      message: 'A imagem está escura demais; melhore a iluminação.',
    });
  } else if (quality.meanLuminance > color.overexposedMinLuminance) {
    warnings.push({
      code: 'OVEREXPOSED',
      message: 'A imagem está clara demais (reflexo ou luz direta).',
    });
  }
  return warnings;
}
