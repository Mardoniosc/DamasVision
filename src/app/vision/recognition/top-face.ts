import { CalibrationCorners } from '../../domain/board/calibration';
import { Point2D } from '../../domain/board/geometry';
import { RgbaImage } from '../perspective';
import { ClassifierConfig } from './classifier.config';
import { chromaDistance, chromaticity, luminance, Rgb } from './square-features';
import { pixelBounds, SquareRegions } from './square-regions';

/**
 * Where the top of a tall piece appears (G3). Seen by an oblique camera, a piece's top
 * face — where a king's mark is — is projected *away from the camera*, by up to a large
 * fraction of a square in the far rows; on the rectified board it is no longer at the
 * square center. The direction comes from the calibration: the far side of the board is
 * foreshortened, so its edge is the shortest in the camera image.
 *
 * Returns the unit vector, in normalized-board coordinates, pointing away from the
 * camera, or null when the board is seen (nearly) from above.
 */
export function awayFromCamera(
  canonicalCorners: CalibrationCorners,
  minObliquity: number,
): Point2D | null {
  const { topLeft, topRight, bottomRight, bottomLeft } = canonicalCorners;
  const length = (a: Point2D, b: Point2D): number => Math.hypot(b.x - a.x, b.y - a.y);
  const top = length(topLeft, topRight);
  const bottom = length(bottomLeft, bottomRight);
  const left = length(topLeft, bottomLeft);
  const right = length(topRight, bottomRight);
  // A shorter edge is farther away: the vector points towards it.
  const x = left + right > 0 ? (left - right) / (left + right) : 0;
  const y = top + bottom > 0 ? (top - bottom) / (top + bottom) : 0;
  const magnitude = Math.hypot(x, y);
  return magnitude < minObliquity ? null : { x: x / magnitude, y: y / magnitude };
}

export interface MarkSearch {
  /** Mark-colored pixels / expected mark area (π · markRadius²); ≈ 1 for a full mark. */
  readonly coverage: number;
  /** Centroid of the mark pixels relative to the square center, in square units. */
  readonly offset: Point2D | null;
}

export interface MarkColors {
  /** Piece body, square background and typical light square. */
  readonly body: Rgb;
  readonly background: Rgb;
  readonly light: Rgb;
  /** Local light reference luminance (0..1): mark brightness is judged relative to it. */
  readonly lightLuminance: number;
}

/** Neutral chromaticity: gray, white and black surfaces (shading on a piece) are never marks. */
const NEUTRAL: readonly [number, number] = [1 / 3, 1 / 3];

/** The concentration disk is this many mark radii wide (pieces are not exactly centered). */
const MARK_DISK_RADII = 1.5;

type Chroma = readonly [number, number];

function distanceToSegment(p: Chroma, a: Chroma, b: Chroma): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared === 0
      ? 0
      : Math.min(1, Math.max(0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lengthSquared));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

/**
 * Looks for a king's colored mark along the line where the piece's top face can be: from
 * the square center towards `away` (`topFaceMaxShiftRatio` squares), within
 * `markSearchRadiusRatio` of that line.
 *
 * A mark pixel (validated on real samples, G3):
 * - is bright enough — relative to the local light, so dim light does not hide a mark — to
 *   have a reliable color;
 * - differs in chromaticity from the piece body;
 * - cannot be explained as a mix of the colors that are there anyway: piece body, square
 *   background, light square and neutral gray (shading). Blurred piece edges against the
 *   board and board reflections on a glossy piece are such mixes; chromaticity is
 *   brightness-invariant, so the board or the piece in shadow is excluded too.
 * The mark must also be compact: coverage is the most mark pixels found in one disk of
 * 1.5 mark radii slid along the line — edge fringes spread out, a mark does not.
 */
export function searchKingMark(
  image: RgbaImage,
  regions: SquareRegions,
  away: Point2D | null,
  colors: MarkColors,
  config: ClassifierConfig,
): MarkSearch {
  const { color, shape } = config;
  const { center, size, markRadius } = regions;
  const shift = away ? shape.topFaceMaxShiftRatio * size : 0;
  const segment = { x: (away?.x ?? 0) * shift, y: (away?.y ?? 0) * shift };
  const radius = shape.markSearchRadiusRatio * size;
  const bounds = pixelBounds(image.width, image.height, {
    x: center.x + Math.min(0, segment.x) - radius,
    y: center.y + Math.min(0, segment.y) - radius,
    width: Math.abs(segment.x) + 2 * radius,
    height: Math.abs(segment.y) + 2 * radius,
  });
  const segmentSquared = segment.x * segment.x + segment.y * segment.y;
  const radiusSquared = radius * radius;
  const data = image.data;
  const minLuminance = color.kingMarkMinLuminance * colors.lightLuminance;
  const anchors: Chroma[] = [
    chromaticity(colors.body),
    chromaticity(colors.background),
    chromaticity(colors.light),
    NEUTRAL,
  ];
  const mixes: [Chroma, Chroma][] = anchors.flatMap((a, i) =>
    anchors.slice(i + 1).map((b): [Chroma, Chroma] => [a, b]),
  );

  // 1. Mark-colored pixels near the line (offsets from the square center).
  const candidates: number[] = [];
  for (let y = bounds.y0; y < bounds.y1; y++) {
    const py = y + 0.5 - center.y;
    for (let x = bounds.x0; x < bounds.x1; x++) {
      const px = x + 0.5 - center.x;
      const t =
        segmentSquared === 0
          ? 0
          : Math.min(1, Math.max(0, (px * segment.x + py * segment.y) / segmentSquared));
      const ex = px - t * segment.x;
      const ey = py - t * segment.y;
      if (ex * ex + ey * ey > radiusSquared) continue;
      const o = (y * image.width + x) * 4;
      const rgb: Rgb = [data[o] ?? 0, data[o + 1] ?? 0, data[o + 2] ?? 0];
      if (luminance(...rgb) < minLuminance) continue;
      if (chromaDistance(rgb, colors.body) < color.kingMarkMinChroma) continue;
      const chroma = chromaticity(rgb);
      if (mixes.some(([a, b]) => distanceToSegment(chroma, a, b) < color.kingMarkBlendTolerance)) {
        continue;
      }
      candidates.push(px, py);
    }
  }

  // 2. The most compact concentration along the line.
  const diskRadius = MARK_DISK_RADII * markRadius;
  const diskSquared = diskRadius * diskRadius;
  const steps = Math.max(1, Math.ceil(Math.sqrt(segmentSquared) / (markRadius / 2)));
  let best = { count: 0, sumX: 0, sumY: 0 };
  for (let step = 0; step <= steps; step++) {
    const cx = (segment.x * step) / steps;
    const cy = (segment.y * step) / steps;
    const disk = { count: 0, sumX: 0, sumY: 0 };
    for (let i = 0; i < candidates.length; i += 2) {
      const dx = (candidates[i] ?? 0) - cx;
      const dy = (candidates[i + 1] ?? 0) - cy;
      if (dx * dx + dy * dy > diskSquared) continue;
      disk.count++;
      disk.sumX += candidates[i] ?? 0;
      disk.sumY += candidates[i + 1] ?? 0;
    }
    if (disk.count > best.count) best = disk;
  }
  const expected = Math.PI * markRadius * markRadius;
  return {
    coverage: expected > 0 ? best.count / expected : 0,
    offset:
      best.count === 0
        ? null
        : { x: best.sumX / best.count / size, y: best.sumY / best.count / size },
  };
}
