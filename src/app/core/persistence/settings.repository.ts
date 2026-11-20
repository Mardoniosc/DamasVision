import { inject, Injectable, InjectionToken } from '@angular/core';
import { DAMAS_VISION_DB } from './damas-vision.db';
import { AppSetting, SettingsRepository, toPersistenceError } from './persistence.models';

/** Keys and value types of the stored settings (E7-T04). */
export interface SettingValues {
  /** Default player names, prefilled when a game starts. */
  'players.defaultLabels': { readonly white: string; readonly black: string };
  /** Recognizer choice (G3.1, ADR-042): additive key, no schema change. */
  'vision.provider': {
    readonly kind: 'browser' | 'local-service';
    readonly serviceUrl: string;
  };
}

export type SettingKey = keyof SettingValues;

/** IndexedDB-backed settings (spec §11 `SettingsRepository`). */
@Injectable({ providedIn: 'root' })
export class DexieSettingsRepository implements SettingsRepository {
  private readonly db = inject(DAMAS_VISION_DB);

  async get<T>(key: string): Promise<T | undefined> {
    try {
      const setting = await this.db.settings.get(key);
      return setting?.value as T | undefined;
    } catch (error) {
      throw toPersistenceError(error);
    }
  }

  async set<T>(key: string, value: T): Promise<void> {
    const setting: AppSetting<T> = { key, value, updatedAt: new Date().toISOString() };
    try {
      await this.db.settings.put(setting);
    } catch (error) {
      throw toPersistenceError(error);
    }
  }
}

export const SETTINGS_REPOSITORY = new InjectionToken<SettingsRepository>('SETTINGS_REPOSITORY', {
  providedIn: 'root',
  factory: () => inject(DexieSettingsRepository),
});

/** Typed access to a known setting. */
export function getSetting<K extends SettingKey>(
  repository: SettingsRepository,
  key: K,
): Promise<SettingValues[K] | undefined> {
  return repository.get<SettingValues[K]>(key);
}

export function setSetting<K extends SettingKey>(
  repository: SettingsRepository,
  key: K,
  value: SettingValues[K],
): Promise<void> {
  return repository.set<SettingValues[K]>(key, value);
}
