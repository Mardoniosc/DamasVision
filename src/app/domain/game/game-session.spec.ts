import { position, sq } from '../../../../tests/fixtures/engine-positions';
import { observe } from '../../../../tests/fixtures/observations';
import { initialBoard } from '../engine/board-state';
import { BrazilianCheckersEngine } from '../engine/checkers-engine';
import { Move } from '../move/move';
import {
  CommitError,
  commitMove,
  correctPosition,
  createGameSession,
  endGame,
  GameSession,
  undoLastMove,
  validateInitialPosition,
} from './game-session';
import { canTransition, InvalidTransitionError, transition } from './game-state-machine';

const engine = new BrazilianCheckersEngine();
const T = '2026-11-19T12:00:00.000Z';

function legal(session: GameSession, id: string): Move {
  const move = engine.getLegalMoves(session.board, session.currentPlayer).find((m) => m.id === id);
  if (!move) throw new Error(`${id} is not legal`);
  return move;
}

function play(
  session: GameSession,
  id: string,
  source: 'VISION' | 'MANUAL' = 'VISION',
): GameSession {
  return commitMove(
    session,
    { move: legal(session, id), source, timestamp: T, expectedPly: session.moves.length },
    engine,
  );
}

const newGame = (board = initialBoard()) =>
  createGameSession({
    id: 'g1',
    board,
    whitePlayerLabel: ' Ana ',
    blackPlayerLabel: '',
    timestamp: T,
  });

describe('E6-T02 — initial position validation', () => {
  it('accepts the standard opening and reports it', () => {
    expect(validateInitialPosition(observe(initialBoard()))).toMatchObject({
      valid: true,
      isStandard: true,
    });
  });

  it('accepts a legal non-standard position (a game continued)', () => {
    const result = validateInitialPosition(observe(position({ c3: 'WHITE', f6: 'BLACK_KING' })));

    expect(result).toMatchObject({ valid: true, isStandard: false });
  });

  it('rejects UNKNOWN squares, invalid boards and a missing side', () => {
    expect(
      validateInitialPosition(observe(initialBoard(), { edits: { c3: 'UNKNOWN' } })).problems,
    ).toEqual([{ code: 'UNKNOWN_SQUARES', squares: [sq('c3')] }]);
    expect(
      validateInitialPosition(observe(position({ b8: 'WHITE', a1: 'BLACK' }))).problems.map(
        (p) => p.code,
      ),
    ).toEqual(['INVALID_BOARD', 'INVALID_BOARD']);
    expect(validateInitialPosition(observe(position({ c3: 'WHITE' }))).problems).toEqual([
      { code: 'MISSING_SIDE', color: 'BLACK' },
    ]);
  });
});

describe('E6-T03 — commit protocol (pure part)', () => {
  it('creates an active session with labels and White to move', () => {
    expect(newGame()).toMatchObject({
      status: 'ACTIVE',
      currentPlayer: 'WHITE',
      whitePlayerLabel: 'Ana',
      blackPlayerLabel: 'Pretas',
      moves: [],
    });
  });

  it('applies a legal move and records it', () => {
    const session = play(newGame(), 'c3-d4');

    expect(session.currentPlayer).toBe('BLACK');
    expect(session.moves).toHaveLength(1);
    expect(session.moves[0]).toMatchObject({
      id: 'g1-1',
      ply: 1,
      player: 'WHITE',
      source: 'VISION',
    });
    expect(session.moves[0]?.afterBoard).toEqual(session.board);
  });

  it('rejects an illegal move, a stale (duplicate) commit and a finished game', () => {
    const session = newGame();
    const move = legal(session, 'c3-d4');
    const after = play(session, 'c3-d4');

    expect(() =>
      commitMove(after, { move, source: 'VISION', timestamp: T, expectedPly: 0 }, engine),
    ).toThrow(new CommitError('STALE'));
    expect(() =>
      commitMove(after, { move, source: 'VISION', timestamp: T, expectedPly: 1 }, engine),
    ).toThrow(new CommitError('ILLEGAL'));
    const finished = endGame(after, { status: 'DRAW', reason: 'AGREEMENT' }, T);
    expect(() =>
      commitMove(
        finished,
        { move: legal(after, 'f6-e5'), source: 'MANUAL', timestamp: T, expectedPly: 1 },
        engine,
      ),
    ).toThrow(new CommitError('NOT_ACTIVE'));
  });

  it('finishes the game when the opponent has no pieces left', () => {
    const session = play(newGame(position({ c3: 'WHITE', d4: 'BLACK' })), 'c3xe5');

    expect(session).toMatchObject({
      status: 'FINISHED',
      result: { status: 'WIN', winner: 'WHITE', reason: 'NO_PIECES' },
    });
  });

  it('finishes the game by a history draw (threefold repetition)', () => {
    let session = newGame(
      position({ a1: 'WHITE_KING', h4: 'BLACK_KING', b6: 'WHITE', g3: 'BLACK' }),
    );
    for (const id of ['a1-b2', 'h4-g5', 'b2-a1', 'g5-h4', 'a1-b2', 'h4-g5', 'b2-a1', 'g5-h4']) {
      session = play(session, id);
    }

    expect(session.result).toEqual({ status: 'DRAW', reason: 'THREEFOLD_REPETITION' });
  });
});

describe('E6-T06 — undo and explicit position correction', () => {
  it('undo restores the exact previous position and records the adjustment', () => {
    const before = newGame();
    const undone = undoLastMove(play(before, 'c3-d4'), T);

    expect(undone.board).toEqual(before.board);
    expect(undone.currentPlayer).toBe('WHITE');
    expect(undone.moves).toHaveLength(0);
    expect(undone.adjustments.map((a) => a.kind)).toEqual(['UNDO']);
  });

  it('undo reopens a finished game', () => {
    const finished = play(newGame(position({ c3: 'WHITE', d4: 'BLACK' })), 'c3xe5');

    expect(undoLastMove(finished, T)).toMatchObject({ status: 'ACTIVE' });
    expect(undoLastMove(finished, T).result).toBeUndefined();
  });

  it('cannot undo without moves or past a position correction', () => {
    expect(() => undoLastMove(newGame(), T)).toThrow(CommitError);
    const corrected = correctPosition(
      play(newGame(), 'c3-d4'),
      initialBoard(),
      'WHITE',
      T,
      'teste',
      engine,
    );
    expect(() => undoLastMove(corrected, T)).toThrow(CommitError);
  });

  it('a position correction is explicit, validated and recorded', () => {
    const session = play(newGame(), 'c3-d4');
    const target = position({ a1: 'WHITE_KING', h8: 'BLACK_KING' });

    const corrected = correctPosition(session, target, 'BLACK', T, 'tabuleiro esbarrado', engine);

    expect(corrected).toMatchObject({ board: target, currentPlayer: 'BLACK', status: 'ACTIVE' });
    expect(corrected.adjustments[0]).toMatchObject({
      kind: 'POSITION_CORRECTION',
      before: session.board,
      after: target,
      reason: 'tabuleiro esbarrado',
    });
    expect(() =>
      correctPosition(session, position({ b8: 'WHITE' }), 'WHITE', T, 'x', engine),
    ).toThrow(CommitError);
  });
});

describe('E6-T01 — state machine (spec §12)', () => {
  it('follows the move-tracking cycle', () => {
    let phase = transition('READY', 'START');
    phase = transition(phase, 'BOARD_CHANGED');
    phase = transition(phase, 'SETTLING');
    phase = transition(phase, 'STABLE');
    phase = transition(phase, 'ACCEPTED');
    expect(phase).toBe('MOVE_COMMIT');
    expect(transition(phase, 'CONTINUE')).toBe('MONITORING');
    expect(transition(phase, 'RESULT')).toBe('GAME_FINISHED');
  });

  it('ambiguity goes to reconciliation; no match returns to monitoring', () => {
    expect(transition('MOVE_INFERENCE', 'AMBIGUOUS')).toBe('RECONCILIATION');
    expect(transition('MOVE_INFERENCE', 'NO_MATCH')).toBe('MONITORING');
    expect(transition('RECONCILIATION', 'RESOLVED')).toBe('MONITORING');
  });

  it('rejects transitions the spec does not define', () => {
    expect(canTransition('PAUSED', 'ACCEPTED')).toBe(false);
    expect(() => transition('GAME_FINISHED', 'BOARD_CHANGED')).toThrow(InvalidTransitionError);
  });
});
