import { SquareGeometry, squareRoi } from '../../domain/board/board-grid';
import { Rect } from '../../domain/board/geometry';
import { RgbaImage } from '../perspective';
import { ShapeThresholds } from './classifier.config';

/** Maximum RGB distance (black ↔ white), used to normalize color distances to 0..1. */
const RGB_DIAGONAL = Math.sqrt(3 * 255 * 255);
/** Pixels this close to the square edge are skipped (grid lines, neighbour bleed). */
const EDGE_MARGIN_RATIO = 0.03;
/** The king-mark annulus starts this far outside the mark radius, to skip anti-aliased edges. */
const BODY_INNER_GAP = 1.6;

/** Per-square measurements (E3-T03). Luminance values are 0..1 (Rec. 601 luma). */
export interface SquareFeatures {
  readonly index: number;
  /** Median color of the square corners (outside the piece circle): the board itself. */
  readonly backgroundColor: Rgb;
  readonly backgroundLuminance: number;
  /** Mean color and luminance of the central disk where a piece would be. */
  readonly pieceColor: Rgb;
  readonly pieceLuminance: number;
  /** Mean HSV saturation of the central disk. */
  readonly pieceSaturation: number;
  /** Distance between `pieceColor` and `backgroundColor` (0..1). */
  readonly colorDistance: number;
  /** Fraction of disk pixels that differ from the background (0..1). */
  readonly foregroundRatio: number;
  /**
   * Mean luminance of the piece pixels in the small central disk (king mark). Only pixels
   * that differ from the square background count, so a piece that does not fully cover
   * the disk is not "diluted" by the board (first real-world samples, 2026-11-19).
   */
  readonly markLuminance: number;
  /** Mean luminance of the piece pixels of the body, excluding the mark area. */
  readonly bodyLuminance: number;
  /** Mean colors of the mark and body regions (for chromatic king marks). */
  readonly markColor: Rgb;
  readonly bodyColor: Rgb;
}

export function luminance(r: number, g: number, b: number): number {
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

function saturation(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b);
  return max === 0 ? 0 : (max - Math.min(r, g, b)) / max;
}

/** Median of 8-bit values via a 256-bin histogram. */
function histogramMedian(histogram: Uint32Array, count: number): number {
  const half = count / 2;
  let seen = 0;
  for (let value = 0; value < 256; value++) {
    seen += histogram[value] ?? 0;
    if (seen >= half) {
      return value;
    }
  }
  return 255;
}

export type Rgb = readonly [number, number, number];

/** Per-channel median color of the pixels inside `rect`. */
export function medianColor(image: RgbaImage, rect: Rect): Rgb {
  const histograms = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)] as const;
  let count = 0;
  const { x0, y0, x1, y1 } = pixelBounds(image, rect);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const o = (y * image.width + x) * 4;
      histograms[0][image.data[o] ?? 0]! += 1;
      histograms[1][image.data[o + 1] ?? 0]! += 1;
      histograms[2][image.data[o + 2] ?? 0]! += 1;
      count++;
    }
  }
  return [
    histogramMedian(histograms[0], count),
    histogramMedian(histograms[1], count),
    histogramMedian(histograms[2], count),
  ];
}

/** Median color of a square's region of interest (E3-T02). */
export function roiColor(image: RgbaImage, square: SquareGeometry, insetRatio: number): Rgb {
  return medianColor(image, squareRoi(square, insetRatio));
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

/**
 * Extracts the features of one square from the normalized board image (E3-T02/T03).
 * Regions are defined relative to the square center: the piece disk, the king-mark
 * disk inside it, and the corners outside the inscribed circle (board background).
 */
export function extractSquareFeatures(
  image: RgbaImage,
  square: SquareGeometry,
  shape: ShapeThresholds,
  /** Absolute pixel distance threshold, 0..1 of the RGB diagonal. */
  pixelForegroundDistance: number,
): SquareFeatures {
  const size = Math.min(square.bounds.width, square.bounds.height);
  const margin = size * EDGE_MARGIN_RATIO;
  const area = {
    x: square.bounds.x + margin,
    y: square.bounds.y + margin,
    width: square.bounds.width - 2 * margin,
    height: square.bounds.height - 2 * margin,
  };
  const { x0, y0, x1, y1 } = pixelBounds(image, area);
  const cx = square.center.x;
  const cy = square.center.y;
  const pieceRadius = shape.pieceRadiusRatio * size;
  const backgroundRadius = shape.backgroundMinRadiusRatio * size;
  const markRadius = shape.kingMarkRadiusRatio * size;
  const bodyInnerRadius = Math.min(markRadius * BODY_INNER_GAP, pieceRadius * 0.9);
  const data = image.data;

  // Pass 1: background histograms (corners) and disk statistics.
  const histograms = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)] as const;
  let backgroundCount = 0;
  let diskCount = 0;
  let diskR = 0;
  let diskG = 0;
  let diskB = 0;
  let diskSaturation = 0;
  for (let y = y0; y < y1; y++) {
    const dy = y + 0.5 - cy;
    for (let x = x0; x < x1; x++) {
      const dx = x + 0.5 - cx;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const o = (y * image.width + x) * 4;
      const r = data[o] ?? 0;
      const g = data[o + 1] ?? 0;
      const b = data[o + 2] ?? 0;
      if (distance >= backgroundRadius) {
        histograms[0][r]! += 1;
        histograms[1][g]! += 1;
        histograms[2][b]! += 1;
        backgroundCount++;
      } else if (distance <= pieceRadius) {
        diskR += r;
        diskG += g;
        diskB += b;
        diskSaturation += saturation(r, g, b);
        diskCount++;
      }
    }
  }

  const backgroundColor: [number, number, number] = [
    histogramMedian(histograms[0], backgroundCount),
    histogramMedian(histograms[1], backgroundCount),
    histogramMedian(histograms[2], backgroundCount),
  ];
  const pieceColor: [number, number, number] =
    diskCount === 0 ? [0, 0, 0] : [diskR / diskCount, diskG / diskCount, diskB / diskCount];

  // Pass 2: foreground (piece) pixels inside the disk, and mark/body statistics over them.
  const threshold = pixelForegroundDistance * RGB_DIAGONAL;
  const thresholdSquared = threshold * threshold;
  let foreground = 0;
  let markLuma = 0;
  let markCount = 0;
  let bodyLuma = 0;
  let bodyCount = 0;
  const markSum = [0, 0, 0];
  const bodySum = [0, 0, 0];
  for (let y = y0; y < y1; y++) {
    const dy = y + 0.5 - cy;
    for (let x = x0; x < x1; x++) {
      const dx = x + 0.5 - cx;
      const distanceSquared = dx * dx + dy * dy;
      if (distanceSquared > pieceRadius * pieceRadius) {
        continue;
      }
      const o = (y * image.width + x) * 4;
      const dr = (data[o] ?? 0) - backgroundColor[0];
      const dg = (data[o + 1] ?? 0) - backgroundColor[1];
      const db = (data[o + 2] ?? 0) - backgroundColor[2];
      if (dr * dr + dg * dg + db * db > thresholdSquared) {
        foreground++;
        const r = data[o] ?? 0;
        const g = data[o + 1] ?? 0;
        const b = data[o + 2] ?? 0;
        const luma = luminance(r, g, b);
        const distance = Math.sqrt(distanceSquared);
        if (distance <= markRadius) {
          markLuma += luma;
          markCount++;
          markSum[0]! += r;
          markSum[1]! += g;
          markSum[2]! += b;
        } else if (distance >= bodyInnerRadius) {
          bodyLuma += luma;
          bodyCount++;
          bodySum[0]! += r;
          bodySum[1]! += g;
          bodySum[2]! += b;
        }
      }
    }
  }

  const bodyLuminance = bodyCount === 0 ? 0 : bodyLuma / bodyCount;
  const bodyColor = meanColor(bodySum, bodyCount);
  return {
    index: square.index,
    backgroundColor,
    backgroundLuminance: luminance(...backgroundColor),
    pieceColor,
    pieceLuminance: luminance(...pieceColor),
    pieceSaturation: diskCount === 0 ? 0 : diskSaturation / diskCount,
    colorDistance:
      Math.hypot(
        pieceColor[0] - backgroundColor[0],
        pieceColor[1] - backgroundColor[1],
        pieceColor[2] - backgroundColor[2],
      ) / RGB_DIAGONAL,
    foregroundRatio: diskCount === 0 ? 0 : foreground / diskCount,
    bodyLuminance,
    // Without piece pixels in the mark area there is no evidence of a mark.
    markLuminance: markCount === 0 ? bodyLuminance : markLuma / markCount,
    bodyColor,
    markColor: markCount === 0 ? bodyColor : meanColor(markSum, markCount),
  };
}

function pixelBounds(
  image: RgbaImage,
  rect: Rect,
): { x0: number; y0: number; x1: number; y1: number } {
  return {
    x0: Math.max(0, Math.ceil(rect.x)),
    y0: Math.max(0, Math.ceil(rect.y)),
    x1: Math.min(image.width, Math.floor(rect.x + rect.width)),
    y1: Math.min(image.height, Math.floor(rect.y + rect.height)),
  };
}

function meanColor(sum: readonly number[], count: number): Rgb {
  return count === 0
    ? [0, 0, 0]
    : [(sum[0] ?? 0) / count, (sum[1] ?? 0) / count, (sum[2] ?? 0) / count];
}
