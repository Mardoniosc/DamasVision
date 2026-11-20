import { SettingsRepository } from '../../src/app/core/persistence/persistence.models';

/** In-memory settings repository (E7-T04 test double). */
export class InMemorySettings implements SettingsRepository {
  readonly values = new Map<string, unknown>();
  async get<T>(key: string): Promise<T | undefined> {
    return this.values.get(key) as T | undefined;
  }
  async set<T>(key: string, value: T): Promise<void> {
    this.values.set(key, value);
  }
}
