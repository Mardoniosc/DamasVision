export interface Point2D {
  readonly x: number;
  readonly y: number;
}

export interface Size2D {
  readonly width: number;
  readonly height: number;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export function distance(a: Point2D, b: Point2D): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Absolute area of a simple polygon (shoelace formula). */
export function polygonArea(points: readonly Point2D[]): number {
  let twiceArea = 0;
  for (let i = 0; i < points.length; i++) {
    const current = points[i];
    const next = points[(i + 1) % points.length];
    if (current && next) {
      twiceArea += current.x * next.y - next.x * current.y;
    }
  }
  return Math.abs(twiceArea) / 2;
}

/** z-component of (b - a) × (c - b). Positive = clockwise turn in y-down image coordinates. */
export function turnDirection(a: Point2D, b: Point2D, c: Point2D): number {
  return (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
}

export function isFinitePoint(point: Point2D): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}
