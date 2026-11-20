import { InjectionToken } from '@angular/core';
import Dexie, { DexieOptions, EntityTable } from 'dexie';
import type { PersistedGame } from './game.repository';
import { AppSetting, PersistedCalibration } from './persistence.models';

export const DATABASE_NAME = 'damas-vision';

/**
 * IndexedDB schema (spec §11). Each version only adds to the previous one; add a new
 * `version(n)` with an `upgrade()` for data migrations instead of editing past versions.
 *
 * - v1 (E2): `calibrations` keyed by `id`, indexed by `updatedAt`. `isActive` is not
 *   indexed because booleans are not valid IndexedDB keys; there are only a few profiles.
 * - v2 (E7): `games` keyed by `id`, indexed by `updatedAt` and `status` — a game record
 *   holds its moves, so a game and its moves are always written together in one put;
 *   `settings` keyed by `key`. No video or image is ever stored. The optional
 *   `recognitionLogs` store (spec §11) is not created: nothing needs it yet.
 */
export class DamasVisionDatabase extends Dexie {
  calibrations!: EntityTable<PersistedCalibration, 'id'>;
  games!: EntityTable<PersistedGame, 'id'>;
  settings!: EntityTable<AppSetting, 'key'>;

  constructor(options?: DexieOptions) {
    super(DATABASE_NAME, options);
    this.version(1).stores({
      calibrations: 'id, updatedAt',
    });
    this.version(2).stores({
      games: 'id, updatedAt, status',
      settings: 'key',
    });
  }
}

export const DAMAS_VISION_DB = new InjectionToken<DamasVisionDatabase>('DAMAS_VISION_DB', {
  providedIn: 'root',
  factory: () => new DamasVisionDatabase(),
});
