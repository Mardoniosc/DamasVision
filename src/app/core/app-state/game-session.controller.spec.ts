import { TestBed } from '@angular/core/testing';
import { position } from '../../../../tests/fixtures/engine-positions';
import { frames, observe } from '../../../../tests/fixtures/observations';
import { BoardState } from '../../domain/board/piece';
import { initialBoard } from '../../domain/engine/board-state';
import { BrazilianCheckersEngine } from '../../domain/engine/checkers-engine';
import { Move } from '../../domain/move/move';
import { InMemoryGameRepository } from '../../../../tests/fixtures/in-memory-game-repository';
import { GAME_REPOSITORY } from '../persistence/game.repository';
import { PersistenceError } from '../persistence/persistence.models';
import { GameSessionController } from './game-session.controller';

const engine = new BrazilianCheckersEngine();

function after(board: BoardState, player: 'WHITE' | 'BLACK', id: string): BoardState {
  const move = engine.getLegalMoves(board, player).find((m) => m.id === id);
  if (!move) throw new Error(`${id} is not legal`);
  return engine.applyMove(board, move);
}

describe('GameSessionController (E6-T01/T03)', () => {
  let controller: GameSessionController;
  let repository: InMemoryGameRepository;
  let time: number;

  /** A still board seen for a few frames (G3-stabilized observations). */
  async function see(board: BoardState, edits = {}, count = 3): Promise<void> {
    for (const observation of frames(observe(board, { edits }), count, time)) {
      await controller.observe(observation);
    }
    time += count * 200 + 200;
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [{ provide: GAME_REPOSITORY, useValue: new InMemoryGameRepository() }],
    });
    controller = TestBed.inject(GameSessionController);
    repository = TestBed.inject(GAME_REPOSITORY) as InMemoryGameRepository;
    time = 0;
  });

  async function start(board = initialBoard()) {
    const session = await controller.startGame({
      cells: board.cells,
      whitePlayerLabel: 'Ana',
      blackPlayerLabel: 'Bruno',
    });
    await see(board);
    return session;
  }

  it('starts a game from a valid confirmed position and saves it', async () => {
    const session = await start();

    expect(controller.phase()).toBe('MONITORING');
    expect(controller.session()?.currentPlayer).toBe('WHITE');
    expect((await repository.getById(session.id))?.whitePlayerLabel).toBe('Ana');
  });

  it('refuses to start from an incomplete position', async () => {
    await expect(
      controller.startGame({
        cells: observe(initialBoard(), { edits: { c3: 'UNKNOWN' } }).cells,
        whitePlayerLabel: '',
        blackPlayerLabel: '',
      }),
    ).rejects.toThrow('não é válida');
  });

  it('commits moves inferred from stable observations, once, and persists them', async () => {
    const session = await start();
    const one = after(initialBoard(), 'WHITE', 'c3-d4');
    await see(one, {}, 6);
    const two = after(one, 'BLACK', 'f6-e5');
    await see(two, {}, 6);

    expect(controller.session()?.moves.map((m) => [m.move.id, m.source])).toEqual([
      ['c3-d4', 'VISION'],
      ['f6-e5', 'VISION'],
    ]);
    expect(controller.phase()).toBe('MONITORING');
    expect((await repository.getById(session.id))?.moves).toHaveLength(2);
    expect(controller.reconciliation()?.status).toBe('RECONCILED');
  });

  it('a capture waits for the captured piece to be removed', async () => {
    const start2 = position({ c3: 'WHITE', d4: 'BLACK', h8: 'BLACK' });
    await start(start2);
    const captured = after(start2, 'WHITE', 'c3xe5');

    await see(captured, { d4: 'BLACK' });
    expect(controller.session()?.moves).toHaveLength(0);
    expect(controller.phase()).toBe('STABILIZING');
    expect(controller.inference()?.warnings).toEqual(['CAPTURED_PIECES_NOT_REMOVED']);

    await see(captured);
    expect(controller.session()?.moves.map((m) => m.move.id)).toEqual(['c3xe5']);
  });

  it('a partial match goes to reconciliation; the user confirms the move', async () => {
    await start();
    const one = after(initialBoard(), 'WHITE', 'c3-d4');

    await see(one, { b6: 'EMPTY' });

    expect(controller.phase()).toBe('RECONCILIATION');
    expect(controller.session()?.status).toBe('RECONCILIATION_REQUIRED');
    const candidate = controller.pending()?.inference.candidates[0]?.move as Move;
    expect(candidate.id).toBe('c3-d4');

    expect(await controller.confirmMove(candidate)).toBe(true);
    expect(controller.session()).toMatchObject({ status: 'ACTIVE', currentPlayer: 'BLACK' });
    expect(controller.session()?.moves[0]?.source).toBe('MANUAL');
    expect(controller.phase()).toBe('MONITORING');
  });

  it('an illegal physical move is reported, never committed; restoring the board resolves it', async () => {
    await start();

    await see(initialBoard(), { c3: 'EMPTY', e5: 'WHITE' });
    expect(controller.session()?.moves).toHaveLength(0);
    expect(controller.pending()?.inference.warnings).toEqual(['NO_LEGAL_MOVE_MATCHES']);
    expect(controller.phase()).toBe('MONITORING');

    await see(initialBoard());
    expect(controller.pending()).toBeNull();
  });

  it('an occluded board does not resolve a pending decision', async () => {
    await start();
    await see(initialBoard(), { c3: 'EMPTY', e5: 'WHITE' });
    expect(controller.pending()).not.toBeNull();

    await see(initialBoard(), { c3: 'UNKNOWN', e5: 'UNKNOWN', d4: 'UNKNOWN' });

    expect(controller.pending()).not.toBeNull();
  });

  it('never stays in a phase that stops watching the board', async () => {
    await start();
    // A stable board full of UNKNOWN (camera restart), then a refused duplicate.
    await see(initialBoard(), { c3: 'UNKNOWN', d4: 'UNKNOWN' });
    expect(controller.phase()).toBe('MONITORING');
    const move = controller.legalMoves().find((m) => m.id === 'c3-d4') as Move;
    await controller.confirmMove(move);
    await controller.confirmMove({ ...move });
    expect(controller.phase()).toBe('MONITORING');
    await see(after(after(initialBoard(), 'WHITE', 'c3-d4'), 'BLACK', 'f6-e5'), {}, 6);
    expect(controller.session()?.moves).toHaveLength(2);
  });

  it('a duplicate confirmation never commits twice', async () => {
    await start();
    const move = controller.legalMoves().find((m) => m.id === 'c3-d4') as Move;

    const [first, second] = await Promise.all([
      controller.confirmMove(move),
      controller.confirmMove(move),
    ]);

    expect([first, second].filter(Boolean)).toHaveLength(1);
    expect(controller.session()?.moves).toHaveLength(1);
  });

  it('pause ignores observations; resume watches again', async () => {
    await start();
    await controller.pause();
    const one = after(initialBoard(), 'WHITE', 'c3-d4');

    await see(one, {}, 6);
    expect(controller.session()).toMatchObject({ status: 'PAUSED', moves: [] });

    await controller.resume();
    await see(one, {}, 6);
    expect(controller.session()?.moves).toHaveLength(1);
  });

  it('undo, explicit position correction and ending the game', async () => {
    await start();
    await see(after(initialBoard(), 'WHITE', 'c3-d4'), {}, 6);

    expect(await controller.undo()).toBe(true);
    expect(controller.session()).toMatchObject({ moves: [], currentPlayer: 'WHITE' });

    const custom = position({ a1: 'WHITE_KING', h8: 'BLACK_KING' });
    expect(await controller.correctPosition(custom, 'BLACK', 'peças derrubadas')).toBe(true);
    expect(controller.session()?.board).toEqual(custom);
    expect(controller.session()?.adjustments.map((a) => a.kind)).toEqual([
      'UNDO',
      'POSITION_CORRECTION',
    ]);

    await controller.end({ status: 'DRAW', reason: 'AGREEMENT' });
    expect(controller.phase()).toBe('GAME_FINISHED');
    expect(controller.session()?.result).toEqual({ status: 'DRAW', reason: 'AGREEMENT' });
  });

  it('a game won on the board finishes', async () => {
    const lastPiece = position({ c3: 'WHITE', d4: 'BLACK' });
    await start(lastPiece);

    await see(after(lastPiece, 'WHITE', 'c3xe5'), {}, 6);

    expect(controller.phase()).toBe('GAME_FINISHED');
    expect(controller.session()?.result).toMatchObject({ winner: 'WHITE', reason: 'NO_PIECES' });
  });

  it('a storage failure keeps the previous authoritative state', async () => {
    await start();
    vi.spyOn(repository, 'update').mockRejectedValue(new PersistenceError('QUOTA_EXCEEDED'));
    const move = controller.legalMoves().find((m) => m.id === 'c3-d4') as Move;

    expect(await controller.confirmMove(move)).toBe(false);

    expect(controller.session()?.moves).toHaveLength(0);
    expect(controller.error()).toContain('Não há espaço disponível');
    vi.restoreAllMocks();
  });

  it('loads a saved game by id', async () => {
    const session = await start();
    controller.close();

    expect((await controller.load(session.id))?.id).toBe(session.id);
    expect(await controller.load('missing')).toBeNull();
  });
});
