import { PLAYABLE_SQUARES } from './board';
import { createBoardGrid, projectBoardOverlay, squareRoi } from './board-grid';
import { CalibrationCorners } from './calibration';

describe('board grid (E2-T05)', () => {
  const grid = createBoardGrid({ width: 800, height: 800 });

  it('creates 64 squares in index order that tile the image exactly', () => {
    expect(grid).toHaveLength(64);
    expect(grid.map((s) => s.index)).toEqual([...Array(64).keys()]);
    expect(grid[0]?.bounds).toEqual({ x: 0, y: 0, width: 100, height: 100 });
    expect(grid[63]?.bounds).toEqual({ x: 700, y: 700, width: 100, height: 100 });
    expect(grid[10]).toMatchObject({ row: 1, column: 2, center: { x: 250, y: 150 } });
    const area = grid.reduce((sum, s) => sum + s.bounds.width * s.bounds.height, 0);
    expect(area).toBe(800 * 800);
  });

  it('marks exactly the 32 playable squares', () => {
    expect(grid.filter((s) => s.isPlayable).map((s) => s.index)).toEqual(PLAYABLE_SQUARES);
  });

  it('supports non-square normalized images', () => {
    expect(createBoardGrid({ width: 400, height: 800 })[9]?.bounds).toEqual({
      x: 50,
      y: 100,
      width: 50,
      height: 100,
    });
  });

  it('insets the region of interest on every edge', () => {
    const square = grid[1];
    if (!square) throw new Error('missing square');

    expect(squareRoi(square, 0.15)).toEqual({ x: 115, y: 15, width: 70, height: 70 });
    expect(squareRoi(square, 0)).toEqual(square.bounds);
    expect(() => squareRoi(square, 0.5)).toThrow(RangeError);
  });

  it('rejects an empty board size', () => {
    expect(() => createBoardGrid({ width: 0, height: 800 })).toThrow(RangeError);
  });

  describe('projected overlay', () => {
    const corners: CalibrationCorners = {
      topLeft: { x: 100, y: 100 },
      topRight: { x: 900, y: 100 },
      bottomRight: { x: 900, y: 900 },
      bottomLeft: { x: 100, y: 900 },
    };

    it('projects 18 grid lines and 32 playable centers onto the image', () => {
      const overlay = projectBoardOverlay(corners);
      if (!overlay) throw new Error('expected overlay');

      expect(overlay.gridLines).toHaveLength(18);
      expect(overlay.gridLines[0]?.from.x).toBeCloseTo(100);
      expect(overlay.playableCenters).toHaveLength(32);
      // Square 1 = row 0, column 1 → center at (1.5/8, 0.5/8) of the board.
      expect(overlay.playableCenters[0]?.x).toBeCloseTo(250);
      expect(overlay.playableCenters[0]?.y).toBeCloseTo(150);
      expect(overlay.whiteSideMidpoint.y).toBeCloseTo(900);
      expect(overlay.blackSideMidpoint.y).toBeCloseTo(100);
    });

    it('returns null for degenerate corners', () => {
      const p = { x: 5, y: 5 };
      expect(
        projectBoardOverlay({ topLeft: p, topRight: p, bottomRight: p, bottomLeft: p }),
      ).toBeNull();
    });
  });
});
