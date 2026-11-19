import { position, sq } from '../../../../tests/fixtures/engine-positions';
import { observe } from '../../../../tests/fixtures/observations';
import { BoardState, PlayerColor } from '../board/piece';
import { initialBoard } from '../engine/board-state';
import { BrazilianCheckersEngine, CheckersEngine } from '../engine/checkers-engine';
import { changedSquaresBetween, compareObservedBoard } from './board-diff';
import { reconcileObservation } from './capture-reconciliation';
import { Move } from './move';
import { inferMove } from './move-inference';

const engine = new BrazilianCheckersEngine();

/** The board after the legal move `id` (throws when it is not legal). */
function after(
  board: BoardState,
  player: PlayerColor,
  id: string,
): { board: BoardState; move: Move } {
  const move = engine.getLegalMoves(board, player).find((m) => m.id === id);
  if (!move) throw new Error(`${id} is not legal`);
  return { board: engine.applyMove(board, move), move };
}

describe('E5-T03 — board difference', () => {
  it('separates matches, mismatches and UNKNOWN (uncertainty, not mismatch)', () => {
    const expected = initialBoard();
    const observation = observe(expected, {
      edits: { c3: 'EMPTY', d4: 'UNKNOWN' },
      confidence: 0.9,
    });

    const comparison = compareObservedBoard(expected, observation);

    expect(comparison.mismatchedSquares).toEqual([sq('c3')]);
    expect(comparison.unknownSquares).toEqual([sq('d4')]);
    expect(comparison.matchedSquares).toHaveLength(30);
    expect(comparison).toMatchObject({ consistent: false, exact: false, score: 0.844 });
    expect(compareObservedBoard(expected, observe(expected)).exact).toBe(true);
  });

  it('lists the squares a move changes', () => {
    const { board } = after(initialBoard(), 'WHITE', 'c3-d4');

    expect(changedSquaresBetween(initialBoard(), board)).toEqual([sq('d4'), sq('c3')]);
  });
});

describe('E5-T04/T05 — legal candidate simulation, scoring and ambiguity', () => {
  it('infers a simple move from the stable board', () => {
    const { board } = after(initialBoard(), 'WHITE', 'c3-d4');

    const result = inferMove(initialBoard(), 'WHITE', observe(board), engine);

    expect(result.status).toBe('MATCHED');
    expect(result.selected?.move.id).toBe('c3-d4');
    expect(result.selected?.match).toBe('EXACT');
    expect(result.warnings).toEqual([]);
  });

  it("infers Black's moves too", () => {
    const white = after(initialBoard(), 'WHITE', 'c3-d4').board;
    const { board } = after(white, 'BLACK', 'f6-e5');

    expect(inferMove(white, 'BLACK', observe(board), engine).selected?.move.id).toBe('f6-e5');
  });

  it('an unchanged board is not a move', () => {
    expect(inferMove(initialBoard(), 'WHITE', observe(initialBoard()), engine)).toMatchObject({
      status: 'NO_MATCH',
      warnings: ['BOARD_UNCHANGED'],
    });
  });

  it('an illegal move matches nothing (reconciliation)', () => {
    // c3 → e5 without a capture, and a man moving backwards.
    const jump = observe(initialBoard(), { edits: { c3: 'EMPTY', e5: 'WHITE' } });
    const backwards = observe(position({ d4: 'WHITE', h8: 'BLACK' }), {
      edits: { d4: 'EMPTY', c3: 'WHITE' },
    });

    expect(inferMove(initialBoard(), 'WHITE', jump, engine)).toMatchObject({
      status: 'NO_MATCH',
      warnings: ['NO_LEGAL_MOVE_MATCHES'],
    });
    expect(
      inferMove(position({ d4: 'WHITE', h8: 'BLACK' }), 'WHITE', backwards, engine).status,
    ).toBe('NO_MATCH');
  });

  it('a simple move when a capture was mandatory matches nothing', () => {
    const start = position({ c3: 'WHITE', g3: 'WHITE', d4: 'BLACK' });
    const simple = observe(start, { edits: { g3: 'EMPTY', h4: 'WHITE' } });

    expect(inferMove(start, 'WHITE', simple, engine).status).toBe('NO_MATCH');
  });

  it('the wrong side moving matches nothing', () => {
    const { board } = after(initialBoard(), 'BLACK', 'f6-e5');

    expect(inferMove(initialBoard(), 'WHITE', observe(board), engine).status).toBe('NO_MATCH');
  });

  it('a piece in the hand (only pieces gone) waits for the move to finish', () => {
    const lifted = observe(initialBoard(), { edits: { c3: 'EMPTY' } });

    expect(inferMove(initialBoard(), 'WHITE', lifted, engine)).toMatchObject({
      status: 'WAITING_FOR_STABILITY',
      warnings: ['PIECES_REMOVED_ONLY'],
    });
  });

  it('a decisive square under the hand waits (UNKNOWN is not a mismatch)', () => {
    const occluded = observe(initialBoard(), {
      edits: { c3: 'EMPTY', b4: 'UNKNOWN', d4: 'UNKNOWN' },
    });

    const result = inferMove(initialBoard(), 'WHITE', occluded, engine);

    expect(result).toMatchObject({
      status: 'WAITING_FOR_STABILITY',
      warnings: ['DECISIVE_SQUARES_UNKNOWN'],
    });
    expect(result.candidates.map((c) => c.move.id).sort()).toEqual(['c3-b4', 'c3-d4']);
    expect(result.selected).toBeUndefined();
  });

  it('a non-decisive UNKNOWN does not block a clear move', () => {
    const { board } = after(initialBoard(), 'WHITE', 'c3-d4');

    const result = inferMove(
      initialBoard(),
      'WHITE',
      observe(board, { edits: { h6: 'UNKNOWN' } }),
      engine,
    );

    expect(result.status).toBe('MATCHED');
  });

  it('a low-confidence reading of a changed square asks for confirmation', () => {
    const { board } = after(initialBoard(), 'WHITE', 'c3-d4');

    const result = inferMove(
      initialBoard(),
      'WHITE',
      observe(board, { confidenceAt: { d4: 0.65 } }),
      engine,
    );

    expect(result).toMatchObject({
      status: 'REQUIRES_MANUAL_CORRECTION',
      warnings: ['LOW_CONFIDENCE'],
    });
    expect(result.selected?.move.id).toBe('c3-d4');
  });

  it('a misread square elsewhere gives a partial match that needs confirmation', () => {
    const { board } = after(initialBoard(), 'WHITE', 'c3-d4');

    const result = inferMove(
      initialBoard(),
      'WHITE',
      observe(board, { edits: { b6: 'EMPTY' } }),
      engine,
    );

    expect(result).toMatchObject({
      status: 'REQUIRES_MANUAL_CORRECTION',
      warnings: ['PARTIAL_MATCH'],
    });
    expect(result.candidates[0]).toMatchObject({ match: 'PARTIAL', mismatchedSquares: [sq('b6')] });
    expect(result.selected).toBeUndefined();
  });

  it('too many differences match nothing', () => {
    const { board } = after(initialBoard(), 'WHITE', 'c3-d4');
    const noisy = observe(board, { edits: { b6: 'EMPTY', d6: 'EMPTY', f6: 'EMPTY' } });

    expect(inferMove(initialBoard(), 'WHITE', noisy, engine).status).toBe('NO_MATCH');
  });

  it('several equally matching moves are ambiguous, never guessed', () => {
    // A stub engine offering two moves with the same outcome (defensive path).
    const move = engine
      .getLegalMoves(initialBoard(), 'WHITE')
      .find((m) => m.id === 'c3-d4') as Move;
    const twin: CheckersEngine = {
      getLegalMoves: () => [move, { ...move, id: 'twin' }],
      applyMove: (b, m) => engine.applyMove(b, m),
      simulateMove: (b, m) => engine.simulateMove(b, m),
      validateMove: (b, p, m) => engine.validateMove(b, p, m),
      getResult: (b, p) => engine.getResult(b, p),
      isPlayableSquare: (i) => engine.isPlayableSquare(i),
      serializeBoard: (b) => engine.serializeBoard(b),
    };
    const { board } = after(initialBoard(), 'WHITE', 'c3-d4');

    expect(inferMove(initialBoard(), 'WHITE', observe(board), twin)).toMatchObject({
      status: 'AMBIGUOUS',
      warnings: ['SEVERAL_MOVES_MATCH'],
    });
  });
});

describe('E5 — captures, kings and promotion through inference', () => {
  it('a capture matches once the captured piece is removed', () => {
    const start = position({ c3: 'WHITE', d4: 'BLACK', h8: 'BLACK' });
    const { board } = after(start, 'WHITE', 'c3xe5');

    expect(inferMove(start, 'WHITE', observe(board), engine).selected?.move.id).toBe('c3xe5');
  });

  it('a capture whose captured piece is still on the board waits for its removal', () => {
    const start = position({ c3: 'WHITE', d4: 'BLACK', h8: 'BLACK' });
    const { board } = after(start, 'WHITE', 'c3xe5');

    const result = inferMove(start, 'WHITE', observe(board, { edits: { d4: 'BLACK' } }), engine);

    expect(result).toMatchObject({
      status: 'WAITING_FOR_STABILITY',
      warnings: ['CAPTURED_PIECES_NOT_REMOVED'],
    });
    expect(result.selected?.pendingRemoval).toEqual([sq('d4')]);
  });

  it('a multi-capture waits while some captured pieces remain, then matches', () => {
    const start = position({ c3: 'WHITE', d4: 'BLACK', f6: 'BLACK', h4: 'BLACK' });
    const { board } = after(start, 'WHITE', 'c3xe5xg7');

    expect(
      inferMove(start, 'WHITE', observe(board, { edits: { f6: 'BLACK' } }), engine).status,
    ).toBe('WAITING_FOR_STABILITY');
    expect(inferMove(start, 'WHITE', observe(board), engine)).toMatchObject({
      status: 'MATCHED',
      selected: { move: { id: 'c3xe5xg7' } },
    });
  });

  it('a flying-king capture is identified by its landing square', () => {
    const start = position({ a1: 'WHITE_KING', d4: 'BLACK', h4: 'BLACK' });
    const { board } = after(start, 'WHITE', 'a1xg7');

    const result = inferMove(start, 'WHITE', observe(board), engine);

    expect(result.status).toBe('MATCHED');
    expect(result.selected?.move.id).toBe('a1xg7');
  });

  it('a king moving any distance is inferred', () => {
    const start = position({ b2: 'WHITE_KING', h8: 'BLACK', a7: 'BLACK' });
    const { board } = after(start, 'WHITE', 'b2-g7');

    expect(inferMove(start, 'WHITE', observe(board), engine).selected?.move.id).toBe('b2-g7');
  });

  it('a promotion matches with the crowned piece, or with the crown not placed yet', () => {
    const start = position({ c7: 'WHITE', h2: 'BLACK' });
    const { board } = after(start, 'WHITE', 'c7-d8');

    expect(inferMove(start, 'WHITE', observe(board), engine)).toMatchObject({
      status: 'MATCHED',
      warnings: [],
      selected: { move: { id: 'c7-d8', promotion: true } },
    });
    expect(
      inferMove(start, 'WHITE', observe(board, { edits: { d8: 'WHITE' } }), engine),
    ).toMatchObject({
      status: 'MATCHED',
      warnings: ['PROMOTION_NOT_MARKED'],
      selected: { promotionUnmarked: true },
    });
  });

  it('a capture passing the promotion row (no promotion) is inferred', () => {
    const start = position({ d6: 'WHITE', e7: 'BLACK', g7: 'BLACK', a1: 'BLACK_KING' });
    const { board } = after(start, 'WHITE', 'd6xf8xh6');

    expect(inferMove(start, 'WHITE', observe(board), engine)).toMatchObject({
      status: 'MATCHED',
      selected: { move: { promotion: false } },
    });
  });
});

describe('E5-T06 — capture reconciliation after a commit', () => {
  const start = position({ c3: 'WHITE', d4: 'BLACK', f6: 'BLACK', h4: 'BLACK' });
  const { board, move } = after(start, 'WHITE', 'c3xe5xg7');

  it('reconciled when the physical board equals the authoritative one', () => {
    expect(reconcileObservation(board, observe(board), move, start).status).toBe('RECONCILED');
  });

  it('pending while captured pieces are still on the board', () => {
    const result = reconcileObservation(
      board,
      observe(board, { edits: { d4: 'BLACK' } }),
      move,
      start,
    );

    expect(result).toMatchObject({ status: 'PENDING_REMOVAL', pendingRemoval: [sq('d4')] });
  });

  it('pending while a promoted man is not crowned', () => {
    const promotion = position({ c7: 'WHITE', h2: 'BLACK' });
    const crowned = after(promotion, 'WHITE', 'c7-d8');

    expect(
      reconcileObservation(
        crowned.board,
        observe(crowned.board, { edits: { d8: 'WHITE' } }),
        crowned.move,
        promotion,
      ),
    ).toMatchObject({ status: 'PENDING_PROMOTION_MARK', pendingPromotion: sq('d8') });
  });

  it('occluded while something covers the board', () => {
    expect(
      reconcileObservation(board, observe(board, { edits: { a1: 'UNKNOWN' } }), move, start).status,
    ).toBe('OCCLUDED');
  });

  it('a mismatch otherwise (reconciliation required)', () => {
    const result = reconcileObservation(
      board,
      observe(board, { edits: { h4: 'EMPTY' } }),
      move,
      start,
    );

    expect(result).toMatchObject({ status: 'MISMATCH', mismatchedSquares: [sq('h4')] });
  });
});
