import {
  CalibrationRepository,
  PersistedCalibration,
  PersistenceError,
  PersistenceErrorCode,
} from '../../src/app/core/persistence/persistence.models';

/** Deterministic in-memory {@link CalibrationRepository} with failure injection. */
export class InMemoryCalibrationRepository implements CalibrationRepository {
  readonly profiles = new Map<string, PersistedCalibration>();
  failNextWith: PersistenceErrorCode | null = null;

  async create(profile: PersistedCalibration): Promise<void> {
    this.maybeFail();
    if (this.profiles.has(profile.id)) {
      throw new PersistenceError('ALREADY_EXISTS');
    }
    this.profiles.set(profile.id, structuredClone(profile));
  }

  async update(profile: PersistedCalibration): Promise<void> {
    this.maybeFail();
    if (!this.profiles.has(profile.id)) {
      throw new PersistenceError('NOT_FOUND');
    }
    this.profiles.set(profile.id, structuredClone(profile));
  }

  async getById(id: string): Promise<PersistedCalibration | undefined> {
    this.maybeFail();
    const profile = this.profiles.get(id);
    return profile ? structuredClone(profile) : undefined;
  }

  async list(): Promise<readonly PersistedCalibration[]> {
    this.maybeFail();
    return [...this.profiles.values()].map((profile) => structuredClone(profile));
  }

  async setActive(id: string): Promise<void> {
    this.maybeFail();
    if (!this.profiles.has(id)) {
      throw new PersistenceError('NOT_FOUND');
    }
    for (const [key, profile] of this.profiles) {
      this.profiles.set(key, { ...profile, isActive: key === id });
    }
  }

  async getActive(): Promise<PersistedCalibration | undefined> {
    return (await this.list()).find((profile) => profile.isActive);
  }

  private maybeFail(): void {
    const code = this.failNextWith;
    this.failNextWith = null;
    if (code) {
      throw new PersistenceError(code);
    }
  }
}
