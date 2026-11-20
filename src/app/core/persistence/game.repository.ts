import { Injectable, InjectionToken, inject } from '@angular/core';
import { BoardState, PlayerColor } from '../../domain/board/piece';
import { GameResult } from '../../domain/game/game-result';
import {
  GameMoveRecord,
  GameSession,
  GameStatus,
  PositionAdjustment,
} from '../../domain/game/game-session';
import { PersistenceError } from './persistence.models';

/** Spec §11, plus the initial player and the position-adjustment audit (ADR-039). */
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
 * In-memory games (E6). Games last until the page is reloaded; E7 replaces this provider
 * with the IndexedDB repository behind the same token. Copies on the way in and out, so
 * callers can never mutate what is stored.
 */
@Injectable({ providedIn: 'root' })
export class InMemoryGameRepository implements GameRepository {
  private readonly games = new Map<string, PersistedGame>();

  async create(game: PersistedGame): Promise<void> {
    if (this.games.has(game.id)) throw new PersistenceError('ALREADY_EXISTS');
    this.games.set(game.id, structuredClone(game));
  }

  async update(game: PersistedGame): Promise<void> {
    if (!this.games.has(game.id)) throw new PersistenceError('NOT_FOUND');
    this.games.set(game.id, structuredClone(game));
  }

  async getById(id: string): Promise<PersistedGame | undefined> {
    const game = this.games.get(id);
    return game ? structuredClone(game) : undefined;
  }

  async list(): Promise<readonly PersistedGame[]> {
    return [...this.games.values()]
      .map((game) => structuredClone(game))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async delete(id: string): Promise<void> {
    this.games.delete(id);
  }
}

export const GAME_REPOSITORY = new InjectionToken<GameRepository>('GAME_REPOSITORY', {
  providedIn: 'root',
  factory: () => inject(InMemoryGameRepository),
});
