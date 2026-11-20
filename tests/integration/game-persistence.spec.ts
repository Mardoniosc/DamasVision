import { TestBed } from '@angular/core/testing';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { GameSessionController } from '../../src/app/core/app-state/game-session.controller';
import {
  DAMAS_VISION_DB,
  DamasVisionDatabase,
} from '../../src/app/core/persistence/damas-vision.db';
import { initialBoard } from '../../src/app/domain/engine/board-state';
import { Move } from '../../src/app/domain/move/move';
import { frames, observe } from '../fixtures/observations';
import { BrazilianCheckersEngine } from '../../src/app/domain/engine/checkers-engine';

/**
 * Gate G7 — data persists and failure handling works: the game-session controller on the
 * real IndexedDB repository (fake IndexedDB), across a simulated page reload (a new
 * controller and a new database connection on the same storage).
 */
describe('G7 — game persistence through the controller', () => {
  const engine = new BrazilianCheckersEngine();
  let storage: IDBFactory;
  let db: DamasVisionDatabase;

  /** A fresh app instance (as after a reload) on the same storage. */
  function boot(): GameSessionController {
    db?.close();
    db = new DamasVisionDatabase({ indexedDB: storage, IDBKeyRange });
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [{ provide: DAMAS_VISION_DB, useValue: db }] });
    return TestBed.inject(GameSessionController);
  }

  beforeEach(() => {
    storage = new IDBFactory();
  });

  afterEach(() => db.close());

  it('a game, its moves and its state survive a reload', async () => {
    let controller = boot();
    const session = await controller.startGame({
      cells: initialBoard().cells,
      whitePlayerLabel: 'Ana',
      blackPlayerLabel: 'Bruno',
    });
    // One move from the camera, one by hand.
    const one = engine.applyMove(
      initialBoard(),
      engine.getLegalMoves(initialBoard(), 'WHITE').find((m) => m.id === 'c3-d4') as Move,
    );
    for (const observation of frames(observe(one), 6, 0)) await controller.observe(observation);
    await controller.confirmMove(controller.legalMoves().find((m) => m.id === 'f6-e5') as Move);
    const before = controller.session();

    controller = boot();
    const restored = await controller.load(session.id);

    expect(restored).toEqual(before);
    expect(restored?.moves.map((m) => [m.move.id, m.source])).toEqual([
      ['c3-d4', 'VISION'],
      ['f6-e5', 'MANUAL'],
    ]);
    expect(controller.phase()).toBe('MONITORING');
    expect(controller.legalMoves().map((m) => m.id)).toEqual(['d4xf6']);
  });

  it('a paused or finished game reopens in that state', async () => {
    let controller = boot();
    const paused = await controller.startGame({
      cells: initialBoard().cells,
      whitePlayerLabel: '',
      blackPlayerLabel: '',
    });
    await controller.pause();
    const finished = await controller.startGame({
      cells: initialBoard().cells,
      whitePlayerLabel: '',
      blackPlayerLabel: '',
    });
    await controller.end({ status: 'DRAW', reason: 'AGREEMENT' });

    controller = boot();
    await controller.load(paused.id);
    expect(controller.phase()).toBe('PAUSED');
    await controller.load(finished.id);
    expect(controller.phase()).toBe('GAME_FINISHED');
    expect(controller.session()?.result).toEqual({ status: 'DRAW', reason: 'AGREEMENT' });
  });

  it('a storage failure while committing keeps the previous state, saved and shown', async () => {
    const controller = boot();
    const session = await controller.startGame({
      cells: initialBoard().cells,
      whitePlayerLabel: '',
      blackPlayerLabel: '',
    });
    const quota = Object.assign(new Error('full'), { name: 'QuotaExceededError' });
    vi.spyOn(db.games, 'put').mockRejectedValueOnce(quota);

    expect(await controller.confirmMove(controller.legalMoves()[0] as Move)).toBe(false);

    expect(controller.session()?.moves).toHaveLength(0);
    expect(controller.error()).toContain('Não há espaço disponível');
    expect((await db.games.get(session.id))?.moves).toHaveLength(0);
    // The next attempt works.
    expect(await controller.confirmMove(controller.legalMoves()[0] as Move)).toBe(true);
    expect((await db.games.get(session.id))?.moves).toHaveLength(1);
    vi.restoreAllMocks();
  });

  it('unavailable storage: a game cannot start, with an explicit message', async () => {
    db = new DamasVisionDatabase({ indexedDB: undefined as unknown as IDBFactory, IDBKeyRange });
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [{ provide: DAMAS_VISION_DB, useValue: db }] });
    const controller = TestBed.inject(GameSessionController);

    await expect(
      controller.startGame({
        cells: initialBoard().cells,
        whitePlayerLabel: '',
        blackPlayerLabel: '',
      }),
    ).rejects.toThrow('armazenamento local não está disponível');
    expect(await controller.load('any')).toBeNull();
    expect(controller.error()).toContain('armazenamento local não está disponível');
  });
});
