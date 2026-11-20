import { position } from '../../../../tests/fixtures/engine-positions';
import { initialBoard } from '../engine/board-state';
import { BrazilianCheckersEngine } from '../engine/checkers-engine';
import { gameStatistics } from './game-statistics';
import { commitMove, createGameSession, GameSession, undoLastMove } from './game-session';

const engine = new BrazilianCheckersEngine();
const T = '2026-11-20T10:00:00.000Z';

function play(session: GameSession, id: string, source: 'VISION' | 'MANUAL'): GameSession {
  const move = engine.getLegalMoves(session.board, session.currentPlayer).find((m) => m.id === id);
  if (!move) throw new Error(id);
  return commitMove(
    session,
    { move, source, timestamp: T, expectedPly: session.moves.length },
    engine,
  );
}

describe('gameStatistics (E8-T02)', () => {
  it('counts camera and manual moves, captures, promotions and adjustments', () => {
    let session = createGameSession({
      id: 'g',
      board: initialBoard(),
      whitePlayerLabel: '',
      blackPlayerLabel: '',
      timestamp: T,
    });
    session = play(session, 'c3-d4', 'VISION');
    session = play(session, 'f6-e5', 'VISION');
    session = play(session, 'd4xf6', 'MANUAL');
    session = play(session, 'g7xe5', 'VISION');
    session = undoLastMove(session, T);

    expect(gameStatistics(session)).toEqual({
      moves: 3,
      byCamera: 2,
      manual: 1,
      captures: 1,
      capturesByCamera: 0,
      promotions: 0,
      undos: 1,
      corrections: 0,
      cameraRate: 2 / 3,
      captureCameraRate: 0,
    });
  });

  it('counts promotions; rates are null without moves', () => {
    const empty = createGameSession({
      id: 'g',
      board: position({ c7: 'WHITE', h2: 'BLACK' }),
      whitePlayerLabel: '',
      blackPlayerLabel: '',
      timestamp: T,
    });

    expect(gameStatistics(empty)).toMatchObject({
      moves: 0,
      cameraRate: null,
      captureCameraRate: null,
    });
    expect(gameStatistics(play(empty, 'c7-d8', 'VISION')).promotions).toBe(1);
  });
});
