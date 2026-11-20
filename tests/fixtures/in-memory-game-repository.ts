import { GameRepository, PersistedGame } from '../../src/app/core/persistence/game.repository';
import { PersistenceError } from '../../src/app/core/persistence/persistence.models';

/**
 * In-memory `GameRepository` test double (E6 used it in production until E7). Copies on
 * the way in and out, so callers can never mutate what is stored; `failNext` simulates a
 * storage failure on the next write.
 */
export class InMemoryGameRepository implements GameRepository {
  readonly games = new Map<string, PersistedGame>();
  failNext: PersistenceError | null = null;

  async create(game: PersistedGame): Promise<void> {
    this.maybeFail();
    if (this.games.has(game.id)) throw new PersistenceError('ALREADY_EXISTS');
    this.games.set(game.id, structuredClone(game));
  }

  async update(game: PersistedGame): Promise<void> {
    this.maybeFail();
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
    this.maybeFail();
    this.games.delete(id);
  }

  private maybeFail(): void {
    const failure = this.failNext;
    this.failNext = null;
    if (failure) throw failure;
  }
}
