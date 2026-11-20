import { Injectable, InjectionToken, inject } from '@angular/core';
import { BoardState, PlayerColor } from '../../domain/board/piece';
import { GameResult } from '../../domain/game/game-result';
import {
  GameMoveRecord,
  GameSession,
  GameStatus,
  PositionAdjustment,
} from '../../domain/game/game-session';
import { DAMAS_VISION_DB } from './damas-vision.db';
import { PersistenceError, toPersistenceError } from './persistence.models';

/** Spec §11, plus the initial player and the position-adjustment audit (ADR-039, ADR-040). */
export interface PersistedGame {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: GameStatus;
  mode: 'PHYSICAL_HUMAN_VS_HUMAN';
  whitePlayerLabel: string;
  blackPlayerLabel: string;
  currentPlayer: PlayerColor;
  initialBoard: BoardState;
  initialPlayer: PlayerColor;
  currentBoard: BoardState;
  moves: readonly GameMoveRecord[];
  adjustments: readonly PositionAdjustment[];
  result?: GameResult;
  calibrationId?: string;
}

/** Spec §11. */
export interface GameRepository {
  create(game: PersistedGame): Promise<void>;
  update(game: PersistedGame): Promise<void>;
  getById(id: string): Promise<PersistedGame | undefined>;
  list(): Promise<readonly PersistedGame[]>;
  delete(id: string): Promise<void>;
}

export function toPersistedGame(session: GameSession): PersistedGame {
  return {
    id: session.id,
    createdAt: session.startedAt,
    updatedAt: session.updatedAt,
    status: session.status,
    mode: 'PHYSICAL_HUMAN_VS_HUMAN',
    whitePlayerLabel: session.whitePlayerLabel,
    blackPlayerLabel: session.blackPlayerLabel,
    currentPlayer: session.currentPlayer,
    initialBoard: session.initialBoard,
    initialPlayer: session.initialPlayer,
    currentBoard: session.board,
    moves: session.moves,
    adjustments: session.adjustments,
    ...(session.result ? { result: session.result } : {}),
    ...(session.calibrationId ? { calibrationId: session.calibrationId } : {}),
  };
}

export function toGameSession(game: PersistedGame): GameSession {
  return {
    id: game.id,
    status: game.status,
    board: game.currentBoard,
    currentPlayer: game.currentPlayer,
    moves: game.moves,
    startedAt: game.createdAt,
    updatedAt: game.updatedAt,
    whitePlayerLabel: game.whitePlayerLabel,
    blackPlayerLabel: game.blackPlayerLabel,
    initialBoard: game.initialBoard,
    initialPlayer: game.initialPlayer,
    adjustments: game.adjustments,
    ...(game.result ? { result: game.result } : {}),
    ...(game.calibrationId ? { calibrationId: game.calibrationId } : {}),
  };
}

/**
 * IndexedDB-backed games (E7-T02/T05). A game record embeds its moves and adjustments, so
 * a game and its moves are always written together in a single put (spec §11). Every
 * failure surfaces as a {@link PersistenceError} with a pt-BR message.
 */
@Injectable({ providedIn: 'root' })
export class DexieGameRepository implements GameRepository {
  private readonly db = inject(DAMAS_VISION_DB);

  async create(game: PersistedGame): Promise<void> {
    await this.run(() => this.db.games.add(game));
  }

  /** Replaces the whole record; the game must exist. */
  async update(game: PersistedGame): Promise<void> {
    await this.run(() =>
      this.db.transaction('rw', this.db.games, async () => {
        if (!(await this.db.games.get(game.id))) throw new PersistenceError('NOT_FOUND');
        await this.db.games.put(game);
      }),
    );
  }

  getById(id: string): Promise<PersistedGame | undefined> {
    return this.run(() => this.db.games.get(id));
  }

  /** Most recently updated first. */
  list(): Promise<readonly PersistedGame[]> {
    return this.run(() => this.db.games.orderBy('updatedAt').reverse().toArray());
  }

  async delete(id: string): Promise<void> {
    await this.run(() => this.db.games.delete(id));
  }

  private async run<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      throw toPersistenceError(error);
    }
  }
}

export const GAME_REPOSITORY = new InjectionToken<GameRepository>('GAME_REPOSITORY', {
  providedIn: 'root',
  factory: () => inject(DexieGameRepository),
});
