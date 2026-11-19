import { SquareGeometry, squareRoi } from '../../domain/board/board-grid';
import { Point2D, Rect } from '../../domain/board/geometry';
import { ShapeThresholds } from './classifier.config';

/**
 * The analysis regions of one square, in normalized-board pixels — the single definition
 * used by the classifier and drawn by the diagnostic view (G3: "the ROI shown is the ROI
 * used"). All sizes derive from the calibrated square geometry; none are fixed pixels.
 *
 *   ┌───────────────┐  outer square (grid)
 *   │ ┌───────────┐ │  `area`: square minus `edgeMarginRatio` (grid lines, neighbours)
 *   │ │◣         ◢│ │  corners (distance ≥ backgroundRadius): board background, per quadrant
 *   │ │   ( ◯ )   │ │  piece disk (≤ pieceRadius); mark disk (≤ markRadius) inside it;
 *   │ │◤         ◥│ │  body ring between bodyInnerRadius and pieceRadius
 *   │ └───────────┘ │
 *   └───────────────┘
 */
export interface SquareRegions {
  readonly center: Point2D;
  /** Side of the (square) cell, in pixels. */
  readonly size: number;
  readonly area: Rect;
  readonly pieceRadius: number;
  readonly markRadius: number;
  readonly bodyInnerRadius: number;
  readonly backgroundRadius: number;
}

/** The body ring starts this far outside the mark radius, to skip anti-aliased edges. */
const BODY_INNER_GAP = 1.6;

export function squareRegions(square: SquareGeometry, shape: ShapeThresholds): SquareRegions {
  const size = Math.min(square.bounds.width, square.bounds.height);
  const margin = size * shape.edgeMarginRatio;
  const pieceRadius = shape.pieceRadiusRatio * size;
  const markRadius = shape.kingMarkRadiusRatio * size;
  return {
    center: square.center,
    size,
    area: {
      x: square.bounds.x + margin,
      y: square.bounds.y + margin,
      width: square.bounds.width - 2 * margin,
      height: square.bounds.height - 2 * margin,
    },
    pieceRadius,
    markRadius,
    bodyInnerRadius: Math.min(markRadius * BODY_INNER_GAP, pieceRadius * 0.9),
    backgroundRadius: shape.backgroundMinRadiusRatio * size,
  };
}

/** Light-square region used for the illumination reference. */
export function lightSquareRoi(square: SquareGeometry, insetRatio: number): Rect {
  return squareRoi(square, insetRatio);
}

/** Corner quadrant of a pixel offset from the square center: 0 TL, 1 TR, 2 BR, 3 BL. */
export function cornerQuadrant(dx: number, dy: number): 0 | 1 | 2 | 3 {
  if (dy < 0) return dx < 0 ? 0 : 1;
  return dx < 0 ? 3 : 2;
}

/** Integer pixel bounds of a rect, clipped to the image. */
export function pixelBounds(
  width: number,
  height: number,
  rect: Rect,
): { x0: number; y0: number; x1: number; y1: number } {
  return {
    x0: Math.max(0, Math.ceil(rect.x)),
    y0: Math.max(0, Math.ceil(rect.y)),
    x1: Math.min(width, Math.floor(rect.x + rect.width)),
    y1: Math.min(height, Math.floor(rect.y + rect.height)),
  };
}
