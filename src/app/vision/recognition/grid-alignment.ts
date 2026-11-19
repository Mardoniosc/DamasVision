import { BOARD_SIZE } from '../../domain/board/board';
import { RgbaImage } from '../perspective';
import { luminance } from './square-features';

/** Offsets searched around each grid line, as a fraction of the square size. */
const MAX_OFFSET = 0.4;
const OFFSET_STEP = 0.05;
/** Half-width of the edge derivative, in pixels. */
const DERIVATIVE_PX = 2;
const SAMPLES_PER_SEGMENT = 24;
/** Lower quantile of segment qualities reported (misalignment is often local, e.g. far rows). */
const QUANTILE = 0.25;

/**
 * Stage A — grid alignment on the rectified board (0..1). For each internal grid line,
 * split into a far half and a near half, compares the edge contrast exactly on the line
 * with the best contrast among lines shifted by up to ±40 % of a square: 1 when the
 * borders sit on the grid, lower when the calibration drifted. Adjacent squares always
 * alternate dark/light, whatever the pieces, so borders exist on every line.
 */
export function gridAlignmentQuality(image: RgbaImage): number {
  const square = image.width / BOARD_SIZE;
  const qualities: number[] = [];
  for (let k = 1; k < BOARD_SIZE; k++) {
    for (const vertical of [true, false]) {
      for (const half of [0, 1]) {
        const contrastAt = (offset: number): number => {
          let sum = 0;
          let count = 0;
          for (let i = 0; i < SAMPLES_PER_SEGMENT; i++) {
            const along = (half * 0.5 + ((i + 0.5) / SAMPLES_PER_SEGMENT) * 0.5) * image.width;
            const across = k * square + offset * square;
            const [x, y] = vertical ? [across, along] : [along, across];
            const a = lumaAt(
              image,
              vertical ? x - DERIVATIVE_PX : x,
              vertical ? y : y - DERIVATIVE_PX,
            );
            const b = lumaAt(
              image,
              vertical ? x + DERIVATIVE_PX : x,
              vertical ? y : y + DERIVATIVE_PX,
            );
            if (a !== null && b !== null) {
              sum += Math.abs(a - b);
              count++;
            }
          }
          return count === 0 ? 0 : sum / count;
        };
        const onLine = contrastAt(0);
        let best = onLine;
        for (let offset = -MAX_OFFSET; offset <= MAX_OFFSET + 1e-9; offset += OFFSET_STEP) {
          best = Math.max(best, contrastAt(offset));
        }
        if (best > 0) qualities.push(onLine / best);
      }
    }
  }
  if (qualities.length === 0) return 0;
  const sorted = qualities.sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) * QUANTILE)] ?? 0;
}

function lumaAt(image: RgbaImage, x: number, y: number): number | null {
  const px = Math.round(x);
  const py = Math.round(y);
  if (px < 0 || py < 0 || px >= image.width || py >= image.height) return null;
  const o = (py * image.width + px) * 4;
  return luminance(image.data[o] ?? 0, image.data[o + 1] ?? 0, image.data[o + 2] ?? 0);
}
