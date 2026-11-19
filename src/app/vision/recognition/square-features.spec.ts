import { renderNormalizedBoard } from '../../../../tests/fixtures/synthetic-board';
import { createBoardGrid, SquareGeometry } from '../../domain/board/board-grid';
import { Piece } from '../../domain/board/piece';
import { DEFAULT_COLOR_THRESHOLDS, DEFAULT_SHAPE_THRESHOLDS } from './classifier.config';
import {
  chromaDistance,
  extractSquareFeatures,
  measureCorners,
  medianColor,
  Rgb,
} from './square-features';
import { squareRegions } from './square-regions';

const BROWN: Rgb = [112, 72, 42];
const TEST = { distance: 0.12 * 0.84, color: DEFAULT_COLOR_THRESHOLDS };

/** Board with a white man on 1, a black king on 3, square 5 empty. */
function render(options = {}): ReturnType<typeof renderNormalizedBoard> {
  const cells: Piece[] = Array.from({ length: 64 }, () => 'EMPTY');
  cells[1] = 'WHITE';
  cells[3] = 'BLACK_KING';
  return renderNormalizedBoard(cells, options);
}

describe('square features (G3)', () => {
  const image = render();
  const grid = createBoardGrid(image);
  const square = (index: number): SquareGeometry => grid[index] as SquareGeometry;
  const regions = (index: number) => squareRegions(square(index), DEFAULT_SHAPE_THRESHOLDS);
  const extract = (index: number, img = image, background: Rgb = BROWN) =>
    extractSquareFeatures(img, index, regions(index), background, TEST);

  it('EMPTY: no foreground on a bare square', () => {
    const empty = extract(5);

    expect(empty.foregroundRatio).toBe(0);
    expect(empty.shadowRatio).toBe(0);
    expect(empty.colorDistance).toBeCloseTo(0, 5);
  });

  it('WHITE: full foreground, body brighter than the background', () => {
    const white = extract(1);

    expect(white.foregroundRatio).toBe(1);
    expect(white.bodyLuminance).toBeGreaterThan(white.backgroundLuminance * 2);
  });

  it('measures the king mark separately from the body', () => {
    const king = extract(3);

    expect(king.bodyLuminance).toBeLessThan(0.15);
    expect(chromaDistance(king.markColor, king.bodyColor)).toBeGreaterThan(0.1);
  });

  it('a piece covers the outer ring of the disk', () => {
    expect(extract(1).ringForegroundRatio).toBe(1);
    expect(extract(5).ringForegroundRatio).toBe(0);
  });

  it('EMPTY: a shadow on the board is discarded as shadow, not counted as an object', () => {
    // Darken the whole square 5 to 60 %: same chromaticity, lower luminance.
    const shaded = render({ shadow: { x: 550, y: 50, radius: 80, factor: 0.6 } });

    const features = extract(5, shaded);

    expect(features.foregroundRatio).toBeLessThan(DEFAULT_SHAPE_THRESHOLDS.emptyMaxRatio);
    expect(features.shadowRatio).toBeGreaterThan(0.5);
  });

  it('measures each corner quadrant separately', () => {
    const corners = measureCorners(image, regions(5));

    expect(corners).toHaveLength(4);
    expect(corners.every((c) => c.pixels > 0)).toBe(true);
    expect(corners.map((c) => c.color)).toEqual([BROWN, BROWN, BROWN, BROWN]);
  });

  it('computes median colors and brightness-independent chroma distances', () => {
    expect(medianColor(image, square(0).bounds)).toEqual([232, 214, 176]);
    expect(chromaDistance([100, 50, 25], [200, 100, 50])).toBeCloseTo(0, 10);
    expect(chromaDistance([200, 50, 50], [50, 50, 200])).toBeGreaterThan(0.3);
  });
});
