import { squareName } from '../board/board-notation';
import { BoardState } from '../board/piece';
import { Move } from '../move/move';
import { initialBoard, InvalidBoardError } from './board-state';
import { BrazilianCheckersEngine, IllegalMoveError } from './checkers-engine';
import { position, sq } from '../../../../tests/fixtures/engine-positions';

const engine = new BrazilianCheckersEngine();
const ids = (moves: readonly Move[]) => moves.map((move) => move.id).sort();
const names = (squares: readonly number[]) => squares.map(squareName);
const only = (moves: readonly Move[]): Move => {
  expect(moves).toHaveLength(1);
  return moves[0] as Move;
};

describe('E4-T02 — regular-piece movement', () => {
  it('opening position: 7 forward moves for each side', () => {
    expect(ids(engine.getLegalMoves(initialBoard(), 'WHITE'))).toEqual([
      'a3-b4',
      'c3-b4',
      'c3-d4',
      'e3-d4',
      'e3-f4',
      'g3-f4',
      'g3-h4',
    ]);
    expect(ids(engine.getLegalMoves(initialBoard(), 'BLACK'))).toEqual([
      'b6-a5',
      'b6-c5',
      'd6-c5',
      'd6-e5',
      'f6-e5',
      'f6-g5',
      'h6-g5',
    ]);
  });

  it('men move one square diagonally forward only, never backwards', () => {
    const board = position({ d4: 'WHITE', e5: 'WHITE', h8: 'BLACK' });

    expect(ids(engine.getLegalMoves(position({ d4: 'WHITE', h8: 'BLACK' }), 'WHITE'))).toEqual([
      'd4-c5',
      'd4-e5',
    ]);
    expect(ids(engine.getLegalMoves(position({ e5: 'BLACK', a1: 'WHITE_KING' }), 'BLACK'))).toEqual(
      ['e5-d4', 'e5-f4'],
    );
    // An occupied square is not a destination.
    expect(ids(engine.getLegalMoves(board, 'WHITE'))).toEqual(['d4-c5', 'e5-d6', 'e5-f6']);
  });

  it('a simple move keeps the piece and promotes nothing', () => {
    const move = engine.getLegalMoves(initialBoard(), 'WHITE').find((m) => m.id === 'c3-d4');

    expect(move).toMatchObject({
      from: sq('c3'),
      to: sq('d4'),
      path: [sq('c3'), sq('d4')],
      capturedSquares: [],
      promotion: false,
      pieceBefore: 'WHITE',
      pieceAfter: 'WHITE',
    });
  });
});

describe('E4-T03 — mandatory captures', () => {
  it('when a capture exists, simple moves are illegal', () => {
    const board = position({ c3: 'WHITE', g3: 'WHITE', d4: 'BLACK' });

    expect(ids(engine.getLegalMoves(board, 'WHITE'))).toEqual(['c3xe5']);
  });

  it('men capture backwards too', () => {
    const board = position({ e5: 'WHITE', d4: 'BLACK' });

    expect(ids(engine.getLegalMoves(board, 'WHITE'))).toEqual(['e5xc3']);
  });

  it('no capture when the square beyond is occupied or off the board', () => {
    expect(
      ids(engine.getLegalMoves(position({ c3: 'WHITE', d4: 'BLACK', e5: 'BLACK' }), 'WHITE')),
    ).toEqual(['c3-b4']);
    expect(ids(engine.getLegalMoves(position({ g3: 'WHITE', h4: 'BLACK' }), 'WHITE'))).toEqual([
      'g3-f4',
    ]);
  });

  it('own pieces are never captured', () => {
    expect(ids(engine.getLegalMoves(position({ c3: 'WHITE', d4: 'WHITE' }), 'WHITE'))).toEqual([
      'c3-b4',
      'd4-c5',
      'd4-e5',
    ]);
  });
});

describe('E4-T04 — multi-capture and the majority rule', () => {
  it('a capture continues while the piece can capture again', () => {
    const move = only(
      engine.getLegalMoves(position({ c3: 'WHITE', d4: 'BLACK', f6: 'BLACK' }), 'WHITE'),
    );

    expect(move.id).toBe('c3xe5xg7');
    expect(names(move.capturedSquares)).toEqual(['d4', 'f6']);
    expect(names(move.path)).toEqual(['c3', 'e5', 'g7']);
  });

  it('only the sequences capturing the most pieces are legal (men and kings count the same)', () => {
    // a3 can take one piece; e3 can take two.
    const board = position({
      a3: 'WHITE',
      b4: 'BLACK',
      e3: 'WHITE',
      f4: 'BLACK',
      f6: 'BLACK_KING',
    });

    expect(ids(engine.getLegalMoves(board, 'WHITE'))).toEqual(['e3xg5xe7']);
  });

  it('with equal counts the player chooses freely', () => {
    const board = position({ c3: 'WHITE', b4: 'BLACK', d4: 'BLACK_KING' });

    expect(ids(engine.getLegalMoves(board, 'WHITE'))).toEqual(['c3xa5', 'c3xe5']);
  });

  it('captured pieces stay on the board until the end: never jumped twice, and they block', () => {
    // c3 → e5 → c7 → a5 → c3 takes four pieces and ends where it started; it cannot
    // jump d4 again. Both directions around the loop are the same move.
    const board = position({ c3: 'WHITE', d4: 'BLACK', d6: 'BLACK', b6: 'BLACK', b4: 'BLACK' });

    const move = only(engine.getLegalMoves(board, 'WHITE'));

    expect(move.from).toBe(sq('c3'));
    expect(move.to).toBe(sq('c3'));
    expect(move.capturedSquares).toHaveLength(4);
    expect(engine.applyMove(board, move)).toEqual(position({ c3: 'WHITE' }));
  });

  it('applying a multi-capture removes every captured piece at once', () => {
    const board = position({ c3: 'WHITE', d4: 'BLACK', f6: 'BLACK', h8: 'BLACK' });
    const move = only(engine.getLegalMoves(board, 'WHITE'));

    expect(engine.applyMove(board, move)).toEqual(position({ g7: 'WHITE', h8: 'BLACK' }));
  });
});

describe('E4-T05 — flying kings', () => {
  it('a king moves any distance along every diagonal', () => {
    const moves = engine.getLegalMoves(position({ d4: 'WHITE_KING', h8: 'BLACK' }), 'WHITE');

    // h8 is occupied: 3 + 3 + 3 + 3 (e5, f6, g7) squares.
    expect(moves).toHaveLength(12);
    expect(ids(moves)).toContain('d4-a1');
    expect(ids(moves)).toContain('d4-g7');
    expect(ids(moves)).not.toContain('d4-h8');
  });

  it('captures at a distance and may land on any empty square beyond', () => {
    const moves = engine.getLegalMoves(position({ a1: 'WHITE_KING', d4: 'BLACK' }), 'WHITE');

    expect(ids(moves)).toEqual(['a1xe5', 'a1xf6', 'a1xg7', 'a1xh8']);
    expect(moves.every((move) => move.capturedSquares[0] === sq('d4'))).toBe(true);
  });

  it('must land where the capture can continue (majority rule)', () => {
    const board = position({ a1: 'WHITE_KING', d4: 'BLACK', c7: 'BLACK' });

    const move = only(engine.getLegalMoves(board, 'WHITE'));

    expect(names(move.path)).toEqual(['a1', 'e5', 'b8']);
    expect(names(move.capturedSquares)).toEqual(['d4', 'c7']);
  });

  it('cannot jump two pieces in a row, nor its own pieces', () => {
    expect(
      engine
        .getLegalMoves(position({ a1: 'WHITE_KING', d4: 'BLACK', e5: 'BLACK' }), 'WHITE')
        .some((move) => move.capturedSquares.length > 0),
    ).toBe(false);
    expect(
      engine
        .getLegalMoves(position({ a1: 'WHITE_KING', b2: 'WHITE', d4: 'BLACK' }), 'WHITE')
        .some((move) => move.capturedSquares.length > 0),
    ).toBe(false);
  });

  it('a black king flies and captures the same way', () => {
    const moves = engine.getLegalMoves(
      position({ h8: 'BLACK_KING', e5: 'WHITE', c3: 'WHITE' }),
      'BLACK',
    );

    // After e5 the only landing square is d4 (c3 is next); from d4 it jumps c3 on the
    // same diagonal and may land on b2 or a1.
    expect(ids(moves)).toEqual(['h8xd4xa1', 'h8xd4xb2']);
  });
});

describe('E4-T06 — promotion', () => {
  it('a man reaching the far row becomes a king', () => {
    const moves = engine.getLegalMoves(position({ c7: 'WHITE', h2: 'BLACK' }), 'WHITE');

    expect(moves.map((m) => [m.id, m.promotion, m.pieceAfter])).toEqual([
      ['c7-b8', true, 'WHITE_KING'],
      ['c7-d8', true, 'WHITE_KING'],
    ]);
    expect(engine.applyMove(position({ c7: 'WHITE', h2: 'BLACK' }), moves[0] as Move)).toEqual(
      position({ b8: 'WHITE_KING', h2: 'BLACK' }),
    );
  });

  it('black men promote on row 1', () => {
    const move = engine.getLegalMoves(position({ b2: 'BLACK', h8: 'WHITE_KING' }), 'BLACK')[0];

    expect(move).toMatchObject({ id: 'b2-a1', promotion: true, pieceAfter: 'BLACK_KING' });
  });

  it('a capture ending on the far row promotes', () => {
    const move = only(engine.getLegalMoves(position({ d6: 'WHITE', e7: 'BLACK' }), 'WHITE'));

    expect(move).toMatchObject({ id: 'd6xf8', promotion: true, pieceAfter: 'WHITE_KING' });
  });

  it('a man passing the far row during a capture continues as a man and is not promoted', () => {
    const move = only(
      engine.getLegalMoves(position({ d6: 'WHITE', e7: 'BLACK', g7: 'BLACK' }), 'WHITE'),
    );

    expect(move).toMatchObject({ id: 'd6xf8xh6', promotion: false, pieceAfter: 'WHITE' });
  });

  it('a man does not capture like a king in the move that reaches the far row', () => {
    // From d8 a king could take f6 at a distance (e7 empty); the man that just arrived cannot.
    const move = only(
      engine.getLegalMoves(position({ b6: 'WHITE', c7: 'BLACK', f6: 'BLACK' }), 'WHITE'),
    );

    expect(move.id).toBe('b6xd8');
    expect(move.promotion).toBe(true);
  });
});

describe('E4-T07 — results', () => {
  it('no result while both sides can move', () => {
    expect(engine.getResult(initialBoard(), 'WHITE')).toBeNull();
  });

  it('a player without pieces loses', () => {
    expect(engine.getResult(position({ c3: 'WHITE' }), 'BLACK')).toEqual({
      status: 'WIN',
      winner: 'WHITE',
      reason: 'NO_PIECES',
    });
  });

  it('a player whose pieces are all blocked loses', () => {
    const board = position({ a3: 'WHITE', b4: 'BLACK', c5: 'BLACK' });

    expect(engine.getResult(board, 'WHITE')).toEqual({
      status: 'WIN',
      winner: 'BLACK',
      reason: 'NO_LEGAL_MOVES',
    });
  });
});

describe('E4-T08 — API', () => {
  it('applyMove rejects illegal moves, including a simple move when a capture is due', () => {
    const board = position({ c3: 'WHITE', g3: 'WHITE', d4: 'BLACK' });
    const simple: Move = {
      id: 'g3-h4',
      from: sq('g3'),
      to: sq('h4'),
      path: [sq('g3'), sq('h4')],
      capturedSquares: [],
      promotion: false,
      pieceBefore: 'WHITE',
      pieceAfter: 'WHITE',
    };

    expect(() => engine.applyMove(board, simple)).toThrow(IllegalMoveError);
    expect(engine.validateMove(board, 'WHITE', simple)).toBe(false);
  });

  it('validateMove checks the player and the pieces', () => {
    const move = engine.getLegalMoves(initialBoard(), 'WHITE')[0] as Move;

    expect(engine.validateMove(initialBoard(), 'WHITE', move)).toBe(true);
    expect(engine.validateMove(initialBoard(), 'BLACK', move)).toBe(false);
    expect(
      engine.validateMove(initialBoard(), 'WHITE', { ...move, pieceAfter: 'WHITE_KING' }),
    ).toBe(false);
  });

  it('accepts another landing path of the same king capture', () => {
    const board = position({ c3: 'WHITE', d4: 'BLACK', d6: 'BLACK', b6: 'BLACK', b4: 'BLACK' });
    const move = only(engine.getLegalMoves(board, 'WHITE'));
    const reversed = {
      ...move,
      path: [...move.path].reverse(),
      capturedSquares: [...move.capturedSquares].reverse(),
    };

    expect(engine.validateMove(board, 'WHITE', reversed)).toBe(true);
  });

  it('simulateMove applies a move without legality checks; inputs are never mutated', () => {
    const board = initialBoard();
    const before = JSON.stringify(board);
    const hypothetical: Move = {
      id: 'c3-e5',
      from: sq('c3'),
      to: sq('e5'),
      path: [sq('c3'), sq('e5')],
      capturedSquares: [],
      promotion: false,
      pieceBefore: 'WHITE',
      pieceAfter: 'WHITE',
    };

    const after = engine.simulateMove(board, hypothetical);

    expect(after.cells[sq('e5')]).toBe('WHITE');
    expect(after.cells[sq('c3')]).toBe('EMPTY');
    expect(JSON.stringify(board)).toBe(before);
    expect(() => engine.simulateMove(board, { ...hypothetical, to: 64 })).toThrow(RangeError);
  });

  it('rejects invalid boards', () => {
    const invalid: BoardState = { cells: initialBoard().cells.slice(1) };

    expect(() => engine.getLegalMoves(invalid, 'WHITE')).toThrow(InvalidBoardError);
    expect(() => engine.getResult(position({ b8: 'WHITE' }), 'WHITE')).toThrow(InvalidBoardError);
  });

  it('isPlayableSquare and serializeBoard', () => {
    expect(engine.isPlayableSquare(sq('a1'))).toBe(true);
    expect(engine.isPlayableSquare(sq('b1'))).toBe(false);
    expect(engine.isPlayableSquare(64)).toBe(false);
    expect(engine.serializeBoard(initialBoard())).toBe(
      '.b.b.b.bb.b.b.b..b.b.b.b................w.w.w.w..w.w.w.ww.w.w.w.',
    );
  });

  it('plays a full sequence of the opening deterministically', () => {
    let board = initialBoard();
    const play = (player: 'WHITE' | 'BLACK', id: string) => {
      const move = engine.getLegalMoves(board, player).find((m) => m.id === id);
      if (!move) throw new Error(`${id} is not legal`);
      board = engine.applyMove(board, move);
    };

    play('WHITE', 'c3-d4');
    play('BLACK', 'f6-e5');
    expect(ids(engine.getLegalMoves(board, 'WHITE'))).toEqual(['d4xf6']);
    play('WHITE', 'd4xf6');
    expect(ids(engine.getLegalMoves(board, 'BLACK'))).toEqual(['e7xg5', 'g7xe5']);
  });
});
