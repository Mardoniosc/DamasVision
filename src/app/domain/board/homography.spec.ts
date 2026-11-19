import {
  applyHomography,
  computeHomography,
  Homography,
  invertHomography,
  QuadPoints,
} from './homography';

const SQUARE: QuadPoints = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

const SKEWED: QuadPoints = [
  { x: 112, y: 64 },
  { x: 530, y: 80 },
  { x: 560, y: 450 },
  { x: 90, y: 420 },
];

function expectPoint(actual: { x: number; y: number }, expected: { x: number; y: number }): void {
  expect(actual.x).toBeCloseTo(expected.x, 6);
  expect(actual.y).toBeCloseTo(expected.y, 6);
}

describe('homography', () => {
  it('is the identity for identical quads', () => {
    const h = computeHomography(SQUARE, SQUARE) as Homography;

    [1, 0, 0, 0, 1, 0, 0, 0, 1].forEach((value, i) => expect(h[i]).toBeCloseTo(value, 12));
  });

  it('maps every source corner onto its destination corner', () => {
    const h = computeHomography(SQUARE, SKEWED) as Homography;

    SQUARE.forEach((corner, i) =>
      expectPoint(applyHomography(h, corner), SKEWED[i] as { x: number; y: number }),
    );
  });

  it('maps the square center to the intersection of the diagonals, not the vertex average', () => {
    const h = computeHomography(SQUARE, SKEWED) as Homography;
    const center = applyHomography(h, { x: 0.5, y: 0.5 });
    const average = {
      x: SKEWED.reduce((s, p) => s + p.x, 0) / 4,
      y: SKEWED.reduce((s, p) => s + p.y, 0) / 4,
    };

    expect(Math.abs(center.x - average.x) + Math.abs(center.y - average.y)).toBeGreaterThan(0.5);
  });

  it('inverts correctly', () => {
    const h = computeHomography(SQUARE, SKEWED) as Homography;
    const inverse = invertHomography(h) as Homography;

    expectPoint(applyHomography(inverse, applyHomography(h, { x: 0.3, y: 0.8 })), {
      x: 0.3,
      y: 0.8,
    });
    expect(inverse[8]).toBeCloseTo(1, 12);
  });

  it('returns null for degenerate (collinear) input', () => {
    const collinear: QuadPoints = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 2 },
      { x: 3, y: 3 },
    ];

    expect(computeHomography(collinear, SQUARE)).toBeNull();
    expect(invertHomography([0, 0, 0, 0, 0, 0, 0, 0, 0])).toBeNull();
  });
});
