import { squareFromName, squareName } from '../board/board-notation';
import { pieceColor } from '../board/piece';
import {
  boardIssues,
  initialBoard,
  InvalidBoardError,
  parseBoard,
  serializeBoard,
} from './board-state';
import { position } from '../../../../tests/fixtures/engine-positions';

describe('E4-T01 — board and coordinates', () => {
  it('initial position: 12 men per side on the dark squares, rows 3–4 empty', () => {
    const board = initialBoard();
    const count = (color: 'WHITE' | 'BLACK') =>
      board.cells.filter((c) => pieceColor(c) === color).length;

    expect(count('WHITE')).toBe(12);
    expect(count('BLACK')).toBe(12);
    expect(board.cells[squareFromName('a1')]).toBe('WHITE');
    expect(board.cells[squareFromName('h8')]).toBe('BLACK');
    expect(board.cells[squareFromName('b4')]).toBe('EMPTY');
    expect(boardIssues(board)).toEqual([]);
  });

  it('square names: a1 is the bottom-left dark square, h8 the top-right', () => {
    expect(squareFromName('a1')).toBe(56);
    expect(squareFromName('h8')).toBe(7);
    expect(squareName(squareFromName('c3'))).toBe('c3');
    expect(() => squareFromName('i1')).toThrow(RangeError);
    expect(() => squareFromName('a9')).toThrow(RangeError);
  });

  it('reports every invalid board with explicit issues', () => {
    const lightSquare = { cells: initialBoard().cells.map((c, i) => (i === 0 ? 'WHITE' : c)) };
    const thirteen = position({
      ...Object.fromEntries(
        ['a1', 'c1', 'e1', 'g1', 'b2', 'd2', 'f2', 'h2', 'a3', 'c3', 'e3', 'g3', 'b4'].map((n) => [
          n,
          'WHITE',
        ]),
      ),
    });

    expect(boardIssues({ cells: initialBoard().cells.slice(1) })).toEqual([
      'expected 64 cells, got 63',
    ]);
    expect(boardIssues(lightSquare)).toEqual(['WHITE on light square 0']);
    expect(boardIssues(thirteen)).toEqual(['13 WHITE pieces (max 12)']);
    expect(boardIssues(position({ b8: 'WHITE', a1: 'BLACK' }))).toEqual([
      'WHITE man on its promotion row at b8',
      'BLACK man on its promotion row at a1',
    ]);
    expect(boardIssues(position({ b8: 'WHITE_KING', a1: 'BLACK_KING' }))).toEqual([]);
  });

  it('serializes and parses boards (8-line diagrams allowed)', () => {
    const board = position({ c3: 'WHITE', d4: 'BLACK_KING', b8: 'WHITE_KING' });
    const text = serializeBoard(board);

    expect(text).toHaveLength(64);
    expect(parseBoard(text)).toEqual(board);
    expect(
      parseBoard(`
        .W......
        ........
        ........
        ........
        ...B....
        ..w.....
        ........
        ........`),
    ).toEqual(board);
    expect(() => parseBoard('x'.repeat(64))).toThrow(InvalidBoardError);
    expect(() => parseBoard('.'.repeat(63))).toThrow(InvalidBoardError);
  });
});
