import { TestBed } from '@angular/core/testing';
import Dexie from 'dexie';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { initialBoard } from '../../domain/engine/board-state';
import { BrazilianCheckersEngine } from '../../domain/engine/checkers-engine';
import {
  commitMove,
  createGameSession,
  GameSession,
  undoLastMove,
} from '../../domain/game/game-session';
import { DAMAS_VISION_DB, DATABASE_NAME, DamasVisionDatabase } from './damas-vision.db';
import { GAME_REPOSITORY, toGameSession, toPersistedGame } from './game.repository';
import { PersistenceError } from './persistence.models';
import { getSetting, SETTINGS_REPOSITORY, setSetting } from './settings.repository';

const engine = new BrazilianCheckersEngine();

function game(id: string, updatedAt: string): GameSession {
  return createGameSession({
    id,
    board: initialBoard(),
    whitePlayerLabel: 'Ana',
    blackPlayerLabel: 'Bruno',
    timestamp: updatedAt,
  });
}

function played(session: GameSession, ...ids: string[]): GameSession {
  return ids.reduce((current, id) => {
    const move = engine
      .getLegalMoves(current.board, current.currentPlayer)
      .find((m) => m.id === id);
    if (!move) throw new Error(id);
    return commitMove(
      current,
      {
        move,
        source: 'VISION',
        timestamp: '2026-11-19T12:00:00.000Z',
        expectedPly: current.moves.length,
        confidence: 0.9,
      },
      engine,
    );
  }, session);
}

describe('E7 persistence (fake IndexedDB)', () => {
  let factory: IDBFactory;
  let db: DamasVisionDatabase;

  beforeEach(() => {
    factory = new IDBFactory();
    db = new DamasVisionDatabase({ indexedDB: factory, IDBKeyRange });
    TestBed.configureTestingModule({ providers: [{ provide: DAMAS_VISION_DB, useValue: db }] });
  });

  afterEach(() => db.close());

  const games = () => TestBed.inject(GAME_REPOSITORY);

  describe('E7-T01 — schema and migrations', () => {
    it('v2 adds games and settings and keeps the v1 calibrations', async () => {
      db.close();
      const v1 = new Dexie(DATABASE_NAME, { indexedDB: factory, IDBKeyRange });
      v1.version(1).stores({ calibrations: 'id, updatedAt' });
      await v1.table('calibrations').add({ id: 'c1', updatedAt: '2026-11-19T00:00:00.000Z' });
      v1.close();

      const v2 = new DamasVisionDatabase({ indexedDB: factory, IDBKeyRange });
      await v2.open();

      expect(v2.verno).toBe(2);
      expect((await v2.calibrations.get('c1'))?.id).toBe('c1');
      expect(v2.tables.map((t) => t.name).sort()).toEqual(['calibrations', 'games', 'settings']);
      v2.close();
    });
  });

  describe('E7-T02/T05 — game repository', () => {
    it('stores a game with its moves and adjustments and reads it back unchanged', async () => {
      const session = undoLastMove(
        played(game('g1', '2026-11-19T10:00:00.000Z'), 'c3-d4', 'f6-e5', 'd4xf6'),
        'x',
      );

      await games().create(toPersistedGame(game('g1', '2026-11-19T10:00:00.000Z')));
      await games().update(toPersistedGame(session));
      const stored = await games().getById('g1');

      expect(stored && toGameSession(stored)).toEqual(session);
    });

    it('lists the most recently updated first and deletes', async () => {
      await games().create(toPersistedGame(game('old', '2026-11-18T10:00:00.000Z')));
      await games().create(toPersistedGame(game('new', '2026-11-19T10:00:00.000Z')));

      expect((await games().list()).map((g) => g.id)).toEqual(['new', 'old']);
      await games().delete('old');
      expect((await games().list()).map((g) => g.id)).toEqual(['new']);
    });

    it('reports duplicates, missing games and storage failures as PersistenceErrors', async () => {
      const record = toPersistedGame(game('g1', '2026-11-19T10:00:00.000Z'));
      await games().create(record);

      await expect(games().create(record)).rejects.toMatchObject({ code: 'ALREADY_EXISTS' });
      await expect(games().update({ ...record, id: 'missing' })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });

      const quota = Object.assign(new Error('full'), { name: 'QuotaExceededError' });
      vi.spyOn(db.games, 'put').mockRejectedValueOnce(quota);
      const failure = await games()
        .update(record)
        .catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(PersistenceError);
      expect(failure).toMatchObject({ code: 'QUOTA_EXCEEDED' });
      vi.restoreAllMocks();
    });

    it('reports unavailable storage (private mode, blocked IndexedDB)', async () => {
      db.close();
      const blocked = new DamasVisionDatabase({
        indexedDB: undefined as unknown as IDBFactory,
        IDBKeyRange,
      });
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [{ provide: DAMAS_VISION_DB, useValue: blocked }],
      });

      await expect(TestBed.inject(GAME_REPOSITORY).list()).rejects.toMatchObject({
        code: 'UNAVAILABLE',
      });
    });
  });

  describe('E7-T04 — settings repository', () => {
    it('stores typed settings', async () => {
      const settings = TestBed.inject(SETTINGS_REPOSITORY);

      expect(await getSetting(settings, 'players.defaultLabels')).toBeUndefined();
      await setSetting(settings, 'players.defaultLabels', { white: 'Ana', black: 'Bruno' });
      expect(await getSetting(settings, 'players.defaultLabels')).toEqual({
        white: 'Ana',
        black: 'Bruno',
      });
      expect((await db.settings.get('players.defaultLabels'))?.updatedAt).toMatch(/^\d{4}-/);
    });
  });
});
