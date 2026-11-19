import { ColorThresholds } from './classifier.config';
import { chromaDistance, CornerSample, luminance, Rgb } from './square-features';

/** What a dark (playable) square of this board looks like, from all its corners. */
export interface BoardBackground {
  readonly color: Rgb;
  /** Typical corner luminance divided by the local light reference. */
  readonly relativeLuminance: number;
}

export interface SquareBackground {
  /** Background color used by the stages (median of the visible corners). */
  readonly color: Rgb;
  /** Corners that look like the board (0..4); 0 = the ROI is obstructed. */
  readonly visibleCorners: number;
  readonly cornerMatches: readonly boolean[];
}

/** Median over every corner of every playable square: most corners show the bare board. */
export function boardBackground(
  cornersBySquare: readonly (readonly CornerSample[])[],
  lightReferences: readonly number[],
): BoardBackground {
  const colors: Rgb[] = [];
  const ratios: number[] = [];
  cornersBySquare.forEach((corners, i) => {
    const reference = lightReferences[i] ?? 0;
    for (const corner of corners) {
      if (corner.pixels === 0) continue;
      colors.push(corner.color);
      if (reference > 0) ratios.push(luminance(...corner.color) / reference);
    }
  });
  return {
    color: [
      median(colors.map((c) => c[0])),
      median(colors.map((c) => c[1])),
      median(colors.map((c) => c[2])),
    ],
    relativeLuminance: median(ratios),
  };
}

/**
 * Chooses the corners of one square that look like the board: same chromaticity and a
 * similar luminance relative to the local light. Corners covered by the square's own tall
 * piece, by a neighbouring piece or by an object are ignored (G3, real samples: the far
 * corner of h8 was covered by its piece).
 */
export function squareBackground(
  corners: readonly CornerSample[],
  lightReference: number,
  board: BoardBackground,
  color: ColorThresholds,
): SquareBackground {
  const cornerMatches = corners.map((corner) => {
    if (corner.pixels === 0 || lightReference <= 0) return false;
    const ratio = luminance(...corner.color) / lightReference;
    return (
      chromaDistance(corner.color, board.color) <= color.backgroundChromaTolerance &&
      Math.abs(ratio - board.relativeLuminance) <= color.backgroundRatioTolerance
    );
  });
  const visible = corners.filter((_, i) => cornerMatches[i]);
  const used = visible.length > 0 ? visible : corners.filter((c) => c.pixels > 0);
  return {
    color: [
      median(used.map((c) => c.color[0])),
      median(used.map((c) => c.color[1])),
      median(used.map((c) => c.color[2])),
    ],
    visibleCorners: visible.length,
    cornerMatches,
  };
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] as number)
    : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}
