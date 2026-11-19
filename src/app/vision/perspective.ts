import { CalibrationCorners, cornersToArray } from '../domain/board/calibration';
import { Size2D } from '../domain/board/geometry';
import { Homography } from '../domain/board/homography';
import { OpenCv } from './opencv-loader';
import { withResources } from './resource-scope';

/** Tightly packed RGBA pixels (same layout as `ImageData`). */
export interface RgbaImage {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

/**
 * Perspective transform from the image corners to a `size` rectangle (spec §7 steps 2–3),
 * via OpenCV `getPerspectiveTransform`.
 */
export function computePerspectiveTransform(
  cv: OpenCv,
  canonical: CalibrationCorners,
  size: Size2D,
): Homography {
  return withResources((scope) => {
    const source = scope.track(
      cv.matFromArray(
        4,
        1,
        cv.CV_32FC2,
        cornersToArray(canonical).flatMap((p) => [p.x, p.y]),
      ),
    );
    const destination = scope.track(
      cv.matFromArray(4, 1, cv.CV_32FC2, [
        0,
        0,
        size.width,
        0,
        size.width,
        size.height,
        0,
        size.height,
      ]),
    );
    const transform = scope.track(cv.getPerspectiveTransform(source, destination));
    const values = Array.from(transform.data64F);
    if (values.length !== 9 || !values.every(Number.isFinite)) {
      throw new Error('OpenCV returned an invalid perspective transform');
    }
    return values as unknown as Homography;
  });
}

/** Warps `image` into a `size` image with the given transform (spec §7 step 4). */
export function warpPerspective(
  cv: OpenCv,
  image: RgbaImage,
  transform: Homography,
  size: Size2D,
): RgbaImage {
  if (image.data.length !== image.width * image.height * 4) {
    throw new RangeError('RGBA buffer size does not match image dimensions');
  }
  return withResources((scope) => {
    const source = scope.track(cv.matFromArray(image.height, image.width, cv.CV_8UC4, image.data));
    const matrix = scope.track(cv.matFromArray(3, 3, cv.CV_64F, [...transform]));
    const output = scope.track(new cv.Mat());
    cv.warpPerspective(
      source,
      output,
      matrix,
      new cv.Size(size.width, size.height),
      cv.INTER_LINEAR,
      cv.BORDER_CONSTANT,
      new cv.Scalar(0, 0, 0, 255),
    );
    // Copy out of WASM memory before the Mat is deleted.
    return { width: size.width, height: size.height, data: new Uint8ClampedArray(output.data) };
  });
}
