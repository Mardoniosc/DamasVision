import { renderNormalizedBoard } from '../../../../tests/fixtures/synthetic-board';
import { createBoardGrid, SquareGeometry } from '../../domain/board/board-grid';
import { Piece } from '../../domain/board/piece';
import { DEFAULT_VISION_CONFIG } from '../vision.config';
import { resolveClassifierConfig } from './classifier.config';
import { squareRegions } from './square-regions';
import { awayFromCamera, MarkColors, searchKingMark } from './top-face';

const config = resolveClassifierConfig(DEFAULT_VISION_CONFIG);
const WOOD: MarkColors = {
  body: [242, 238, 228],
  background: [112, 72, 42],
  light: [232, 214, 176],
  lightLuminance: 0.84,
};
const UP = { x: 0, y: -1 };

describe('awayFromCamera (G3 top-face direction)', () => {
  it('points to the far, foreshortened edge of an oblique view', () => {
    const corners = {
      topLeft: { x: 255, y: 70 },
      topRight: { x: 760, y: 68 },
      bottomRight: { x: 900, y: 500 },
      bottomLeft: { x: 125, y: 505 },
    };

    const away = awayFromCamera(corners, 0.05);

    expect(away?.y).toBeLessThan(-0.99);
    expect(Math.abs(away?.x ?? 1)).toBeLessThan(0.1);
  });

  it('follows the orientation: the far edge on the left points left', () => {
    const corners = {
      topLeft: { x: 200, y: 150 },
      topRight: { x: 700, y: 50 },
      bottomRight: { x: 700, y: 550 },
      bottomLeft: { x: 200, y: 450 },
    };

    expect(awayFromCamera(corners, 0.05)?.x).toBeLessThan(-0.99);
  });

  it('is null for a board seen from above', () => {
    const square = {
      topLeft: { x: 100, y: 100 },
      topRight: { x: 500, y: 100 },
      bottomRight: { x: 500, y: 500 },
      bottomLeft: { x: 100, y: 500 },
    };

    expect(awayFromCamera(square, 0.05)).toBeNull();
  });
});

describe('searchKingMark (G3)', () => {
  function board(piece: Piece, pieceHeight: number) {
    const cells: Piece[] = Array.from({ length: 64 }, () => 'EMPTY');
    cells[44] = piece; // row 5: top shifted 0.3 × 1.23 ≈ 0.37 squares up
    const image = renderNormalizedBoard(cells, { pieceHeight });
    const square = createBoardGrid(image)[44] as SquareGeometry;
    return { image, regions: squareRegions(square, config.shape) };
  }

  it('finds the mark of a flat king at the center', () => {
    const { image, regions } = board('WHITE_KING', 0);

    expect(searchKingMark(image, regions, null, WOOD, config).coverage).toBeGreaterThan(1);
  });

  it('finds the displaced mark of a tall king only when searching away from the camera', () => {
    const { image, regions } = board('WHITE_KING', 0.3);

    const centerOnly = searchKingMark(image, regions, null, WOOD, config);
    const alongTop = searchKingMark(image, regions, UP, WOOD, config);

    expect(centerOnly.coverage).toBeLessThan(config.color.kingMarkMinCoverage);
    expect(alongTop.coverage).toBeGreaterThan(1);
    expect(alongTop.offset?.y).toBeLessThan(-0.3);
  });

  it('finds nothing on a tall man (achromatic body, side and board are not marks)', () => {
    const { image, regions } = board('WHITE', 0.3);

    expect(searchKingMark(image, regions, UP, WOOD, config)).toEqual({ coverage: 0, offset: null });
  });
});
