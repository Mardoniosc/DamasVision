import { InjectionToken } from '@angular/core';
import Dexie, { DexieOptions, EntityTable } from 'dexie';
import { PersistedCalibration } from './persistence.models';

export const DATABASE_NAME = 'damas-vision';

/**
 * IndexedDB schema (spec §11). Each version only adds to the previous one; add a new
 * `version(n)` with an `upgrade()` for data migrations instead of editing past versions.
 *
 * v1 (E2): `calibrations` keyed by `id`, indexed by `updatedAt`. `isActive` is not indexed
 * because booleans are not valid IndexedDB keys; there are only a handful of profiles.
 * `games`, `settings` and `recognitionLogs` are added in E7.
 */
export class DamasVisionDatabase extends Dexie {
  calibrations!: EntityTable<PersistedCalibration, 'id'>;

  constructor(options?: DexieOptions) {
    super(DATABASE_NAME, options);
    this.version(1).stores({
      calibrations: 'id, updatedAt',
    });
  }
}

export const DAMAS_VISION_DB = new InjectionToken<DamasVisionDatabase>('DAMAS_VISION_DB', {
  providedIn: 'root',
  factory: () => new DamasVisionDatabase(),
});
