import { Rect } from '../../domain/board/geometry';
import { RgbaImage } from '../perspective';
import { ColorThresholds } from './classifier.config';
import { cornerQuadrant, pixelBounds, SquareRegions } from './square-regions';

/** The occupancy ring is the outer part of the central disk, from this fraction of its radius. */
export const OCCUPANCY_RING_INNER_FRACTION = 0.7;

/** Maximum RGB distance (black ↔ white), used to normalize color distances to 0..1. */
const RGB_DIAGONAL = Math.sqrt(3 * 255 * 255);

export type Rgb = readonly [number, number, number];

/** Rec. 601 luma, 0..1. */
export function luminance(r: number, g: number, b: number): number {
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

/** Chromaticity (r, g) = (R, G) / (R + G + B): independent of brightness. */
export function chromaticity(color: Rgb): readonly [number, number] {
  const sum = color[0] + color[1] + color[2];
  return sum === 0 ? [1 / 3, 1 / 3] : [color[0] / sum, color[1] / sum];
}

export function chromaDistance(a: Rgb, b: Rgb): number {
  const [ar, ag] = chromaticity(a);
  const [br, bg] = chromaticity(b);
  return Math.hypot(ar - br, ag - bg);
}

/** Median of 8-bit values via a 256-bin histogram. */
function histogramMedian(histogram: Uint32Array, count: number): number {
  const half = count / 2;
  let seen = 0;
  for (let value = 0; value < 256; value++) {
    seen += histogram[value] ?? 0;
    if (seen >= half) return value;
  }
  return 255;
}

class ColorHistogram {
  private readonly channels = [
    new Uint32Array(256),
    new Uint32Array(256),
    new Uint32Array(256),
  ] as const;
  count = 0;

  add(r: number, g: number, b: number): void {
    this.channels[0][r]! += 1;
    this.channels[1][g]! += 1;
    this.channels[2][b]! += 1;
    this.count++;
  }

  median(): Rgb {
    return [
      histogramMedian(this.channels[0], this.count),
      histogramMedian(this.channels[1], this.count),
      histogramMedian(this.channels[2], this.count),
    ];
  }
}

/** Per-channel median color of the pixels inside `rect`. */
export function medianColor(image: RgbaImage, rect: Rect): Rgb {
  const histogram = new ColorHistogram();
  const { x0, y0, x1, y1 } = pixelBounds(image.width, image.height, rect);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const o = (y * image.width + x) * 4;
      histogram.add(image.data[o] ?? 0, image.data[o + 1] ?? 0, image.data[o + 2] ?? 0);
    }
  }
  return histogram.count === 0 ? [0, 0, 0] : histogram.median();
}

export interface CornerSample {
  /** Median color of the corner pixels (outside the background radius). */
  readonly color: Rgb;
  readonly pixels: number;
}

/** Median color of each corner quadrant (TL, TR, BR, BL) of a square (G3 background model). */
export function measureCorners(image: RgbaImage, regions: SquareRegions): readonly CornerSample[] {
  const histograms = [
    new ColorHistogram(),
    new ColorHistogram(),
    new ColorHistogram(),
    new ColorHistogram(),
  ];
  const { x0, y0, x1, y1 } = pixelBounds(image.width, image.height, regions.area);
  const r2 = regions.backgroundRadius * regions.backgroundRadius;
  for (let y = y0; y < y1; y++) {
    const dy = y + 0.5 - regions.center.y;
    for (let x = x0; x < x1; x++) {
      const dx = x + 0.5 - regions.center.x;
      if (dx * dx + dy * dy < r2) continue;
      const o = (y * image.width + x) * 4;
      histograms[cornerQuadrant(dx, dy)]?.add(
        image.data[o] ?? 0,
        image.data[o + 1] ?? 0,
        image.data[o + 2] ?? 0,
      );
    }
  }
  return histograms.map((h) => ({
    color: h.count === 0 ? ([0, 0, 0] as Rgb) : h.median(),
    pixels: h.count,
  }));
}

/** Per-square measurements used by the stages and the diagnostics. Luminance is 0..1. */
export interface SquareFeatures {
  readonly index: number;
  /** Background chosen by the background model (corners that look like the board). */
  readonly backgroundColor: Rgb;
  readonly backgroundLuminance: number;
  /** Mean color, luminance and luminance spread of the central disk. */
  readonly pieceColor: Rgb;
  readonly pieceLuminance: number;
  readonly pieceLuminanceStd: number;
  /** Distance between `pieceColor` and `backgroundColor` (0..1). */
  readonly colorDistance: number;
  /** Fraction of disk pixels that differ from the background (0..1). */
  readonly foregroundRatio: number;
  /** Fraction of disk pixels that differ, but only as shadow or glare on the board (0..1). */
  readonly shadowRatio: number;
  /** Foreground fraction of the outer ring of the disk (a piece covers it; a spot does not). */
  readonly ringForegroundRatio: number;
  /** Mean luminance / color of the *piece* pixels in the mark disk and in the body ring. */
  readonly markLuminance: number;
  readonly bodyLuminance: number;
  readonly markColor: Rgb;
  readonly bodyColor: Rgb;
}

export interface ForegroundTest {
  /** Absolute RGB distance threshold (0..1 of the diagonal), already scaled by the light reference. */
  readonly distance: number;
  readonly color: ColorThresholds;
}

/**
 * Extracts the features of one square against a given background color. A disk pixel is
 * foreground when it differs from the background by more than `test.distance`, unless it
 * keeps the background's chromaticity with a shadow/glare-like luminance change — the board
 * in shadow is still the board.
 */
export function extractSquareFeatures(
  image: RgbaImage,
  index: number,
  regions: SquareRegions,
  background: Rgb,
  test: ForegroundTest,
): SquareFeatures {
  const { x0, y0, x1, y1 } = pixelBounds(image.width, image.height, regions.area);
  const { center, pieceRadius, markRadius, bodyInnerRadius } = regions;
  const data = image.data;
  const thresholdSquared = (test.distance * RGB_DIAGONAL) ** 2;
  const backgroundLuminance = luminance(...background);
  const backgroundChromaReliable = backgroundLuminance >= test.color.chromaMinLuminance;

  const ringInnerSquared = (OCCUPANCY_RING_INNER_FRACTION * pieceRadius) ** 2;
  let diskCount = 0;
  let ringCount = 0;
  let ringForeground = 0;
  let foreground = 0;
  let shadow = 0;
  let lumSum = 0;
  let lumSquaredSum = 0;
  const diskSum = [0, 0, 0];
  const mark = { count: 0, luma: 0, sum: [0, 0, 0] };
  const body = { count: 0, luma: 0, sum: [0, 0, 0] };

  for (let y = y0; y < y1; y++) {
    const dy = y + 0.5 - center.y;
    for (let x = x0; x < x1; x++) {
      const dx = x + 0.5 - center.x;
      const distanceSquared = dx * dx + dy * dy;
      if (distanceSquared > pieceRadius * pieceRadius) continue;
      const o = (y * image.width + x) * 4;
      const r = data[o] ?? 0;
      const g = data[o + 1] ?? 0;
      const b = data[o + 2] ?? 0;
      const luma = luminance(r, g, b);
      const inRing = distanceSquared >= ringInnerSquared;
      diskCount++;
      if (inRing) ringCount++;
      lumSum += luma;
      lumSquaredSum += luma * luma;
      diskSum[0]! += r;
      diskSum[1]! += g;
      diskSum[2]! += b;

      const dr = r - background[0];
      const dg = g - background[1];
      const db = b - background[2];
      if (dr * dr + dg * dg + db * db <= thresholdSquared) continue;

      if (
        backgroundChromaReliable &&
        luma >= test.color.chromaMinLuminance * test.color.shadowMinRatio
      ) {
        const ratio = backgroundLuminance > 0 ? luma / backgroundLuminance : Infinity;
        if (
          ratio >= test.color.shadowMinRatio &&
          ratio <= test.color.glareMaxRatio &&
          chromaDistance([r, g, b], background) <= test.color.shadowChromaTolerance
        ) {
          shadow++;
          continue;
        }
      }

      foreground++;
      if (inRing) ringForeground++;
      const distance = Math.sqrt(distanceSquared);
      const target = distance <= markRadius ? mark : distance >= bodyInnerRadius ? body : null;
      if (target) {
        target.count++;
        target.luma += luma;
        target.sum[0]! += r;
        target.sum[1]! += g;
        target.sum[2]! += b;
      }
    }
  }

  const pieceColor = meanColor(diskSum, diskCount);
  const pieceLuminance = diskCount === 0 ? 0 : lumSum / diskCount;
  const variance =
    diskCount === 0 ? 0 : Math.max(0, lumSquaredSum / diskCount - pieceLuminance ** 2);
  const bodyLuminance = body.count === 0 ? 0 : body.luma / body.count;
  const bodyColor = meanColor(body.sum, body.count);
  return {
    index,
    backgroundColor: background,
    backgroundLuminance,
    pieceColor,
    pieceLuminance,
    pieceLuminanceStd: Math.sqrt(variance),
    colorDistance:
      Math.hypot(
        pieceColor[0] - background[0],
        pieceColor[1] - background[1],
        pieceColor[2] - background[2],
      ) / RGB_DIAGONAL,
    foregroundRatio: diskCount === 0 ? 0 : foreground / diskCount,
    shadowRatio: diskCount === 0 ? 0 : shadow / diskCount,
    ringForegroundRatio: ringCount === 0 ? 0 : ringForeground / ringCount,
    bodyLuminance,
    bodyColor,
    // Without piece pixels in the mark area there is no evidence of a mark.
    markLuminance: mark.count === 0 ? bodyLuminance : mark.luma / mark.count,
    markColor: mark.count === 0 ? bodyColor : meanColor(mark.sum, mark.count),
  };
}

function meanColor(sum: readonly number[], count: number): Rgb {
  return count === 0
    ? [0, 0, 0]
    : [(sum[0] ?? 0) / count, (sum[1] ?? 0) / count, (sum[2] ?? 0) / count];
}
