import { renderNormalizedBoard } from '../../../../tests/fixtures/synthetic-board';
import { createBoardGrid, SquareGeometry } from '../../domain/board/board-grid';
import { Piece } from '../../domain/board/piece';
import { DEFAULT_SHAPE_THRESHOLDS } from './classifier.config';
import { chromaDistance, extractSquareFeatures, medianColor } from './square-features';

/** Board with a white man on 1, a black king on 3, square 5 empty. */
function render(): ReturnType<typeof renderNormalizedBoard> {
  const cells: Piece[] = Array.from({ length: 64 }, () => 'EMPTY');
  cells[1] = 'WHITE';
  cells[3] = 'BLACK_KING';
  return renderNormalizedBoard(cells);
}

describe('square features (E3-T02/T03)', () => {
  const image = render();
  const grid = createBoardGrid(image);
  const square = (index: number): SquareGeometry => grid[index] as SquareGeometry;
  const extract = (index: number) =>
    extractSquareFeatures(image, square(index), DEFAULT_SHAPE_THRESHOLDS, 0.12);

  it('sees the board through the corners of an empty square', () => {
    const empty = extract(5);

    expect(empty.foregroundRatio).toBe(0);
    expect(empty.backgroundColor).toEqual([112, 72, 42]);
    expect(empty.colorDistance).toBeCloseTo(0, 5);
  });

  it('measures a piece: full foreground, brighter body than background', () => {
    const white = extract(1);

    expect(white.foregroundRatio).toBe(1);
    expect(white.backgroundColor).toEqual([112, 72, 42]);
    expect(white.bodyLuminance).toBeGreaterThan(white.backgroundLuminance * 2);
  });

  it('measures the king mark separately from the body', () => {
    const king = extract(3);

    expect(king.bodyLuminance).toBeLessThan(0.15);
    expect(king.markLuminance - king.bodyLuminance).toBeGreaterThan(0.4);
  });

  it('computes median colors and brightness-independent chroma distances', () => {
    expect(medianColor(image, square(0).bounds)).toEqual([232, 214, 176]);
    expect(chromaDistance([100, 50, 25], [200, 100, 50])).toBeCloseTo(0, 10);
    expect(chromaDistance([200, 50, 50], [50, 50, 200])).toBeGreaterThan(0.3);
  });
});
