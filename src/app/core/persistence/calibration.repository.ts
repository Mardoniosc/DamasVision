import { inject, Injectable, InjectionToken } from '@angular/core';
import { DAMAS_VISION_DB } from './damas-vision.db';
import {
  CalibrationRepository,
  PersistedCalibration,
  PersistenceError,
  toPersistenceError,
} from './persistence.models';

/** Dexie-backed calibration store. All failures surface as {@link PersistenceError}. */
@Injectable({ providedIn: 'root' })
export class DexieCalibrationRepository implements CalibrationRepository {
  private readonly db = inject(DAMAS_VISION_DB);

  async create(profile: PersistedCalibration): Promise<void> {
    await this.run(() => this.db.calibrations.add(profile));
  }

  async update(profile: PersistedCalibration): Promise<void> {
    await this.run(async () => {
      const updated = await this.db.calibrations.update(profile.id, { ...profile });
      if (updated === 0) {
        throw new PersistenceError('NOT_FOUND');
      }
    });
  }

  getById(id: string): Promise<PersistedCalibration | undefined> {
    return this.run(() => this.db.calibrations.get(id));
  }

  /** Most recently updated first. */
  list(): Promise<readonly PersistedCalibration[]> {
    return this.run(() => this.db.calibrations.orderBy('updatedAt').reverse().toArray());
  }

  /** Marks one profile active and every other inactive, atomically. */
  async setActive(id: string): Promise<void> {
    await this.run(() =>
      this.db.transaction('rw', this.db.calibrations, async () => {
        const target = await this.db.calibrations.get(id);
        if (!target) {
          throw new PersistenceError('NOT_FOUND');
        }
        await this.db.calibrations.toCollection().modify((profile) => {
          profile.isActive = profile.id === id;
        });
      }),
    );
  }

  async getActive(): Promise<PersistedCalibration | undefined> {
    const profiles = await this.list();
    return profiles.find((profile) => profile.isActive);
  }

  private async run<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      throw toPersistenceError(error);
    }
  }
}

export const CALIBRATION_REPOSITORY = new InjectionToken<CalibrationRepository>(
  'CALIBRATION_REPOSITORY',
  {
    providedIn: 'root',
    factory: () => inject(DexieCalibrationRepository),
  },
);
