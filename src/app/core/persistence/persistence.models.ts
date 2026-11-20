import { CalibrationProfile } from '../../domain/board/calibration';

/** Spec §11. */
export interface PersistedCalibration extends CalibrationProfile {
  isActive: boolean;
}

/** Spec §11, plus `getActive()` used to restore the last calibration. */
export interface CalibrationRepository {
  create(profile: PersistedCalibration): Promise<void>;
  update(profile: PersistedCalibration): Promise<void>;
  getById(id: string): Promise<PersistedCalibration | undefined>;
  list(): Promise<readonly PersistedCalibration[]>;
  setActive(id: string): Promise<void>;
  getActive(): Promise<PersistedCalibration | undefined>;
}

/** Spec §11. */
export interface AppSetting<T = unknown> {
  key: string;
  value: T;
  updatedAt: string;
}

/** Spec §11. */
export interface SettingsRepository {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
}

export type PersistenceErrorCode =
  'QUOTA_EXCEEDED' | 'UNAVAILABLE' | 'NOT_FOUND' | 'ALREADY_EXISTS' | 'UNKNOWN';

const MESSAGES: Readonly<Record<PersistenceErrorCode, string>> = {
  QUOTA_EXCEEDED: 'Não há espaço disponível para salvar dados neste dispositivo.',
  UNAVAILABLE: 'O armazenamento local não está disponível (por exemplo, em navegação privada).',
  NOT_FOUND: 'O registro não foi encontrado.',
  ALREADY_EXISTS: 'Já existe um registro com este identificador.',
  UNKNOWN: 'Não foi possível acessar o armazenamento local.',
};

/** Storage failure with a user-facing message (pt-BR); `cause` keeps the original error. */
export class PersistenceError extends Error {
  constructor(
    readonly code: PersistenceErrorCode,
    options?: { cause?: unknown },
  ) {
    super(MESSAGES[code], options);
    this.name = 'PersistenceError';
  }
}

const CODE_BY_ERROR_NAME: Readonly<Record<string, PersistenceErrorCode>> = {
  QuotaExceededError: 'QUOTA_EXCEEDED',
  ConstraintError: 'ALREADY_EXISTS',
  InvalidStateError: 'UNAVAILABLE',
  MissingAPIError: 'UNAVAILABLE',
  DatabaseClosedError: 'UNAVAILABLE',
  OpenFailedError: 'UNAVAILABLE',
  SecurityError: 'UNAVAILABLE',
};

/** Maps IndexedDB/Dexie errors (including Dexie's wrapped `inner` errors) to codes. */
export function toPersistenceError(error: unknown): PersistenceError {
  if (error instanceof PersistenceError) {
    return error;
  }
  const names: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 3 && typeof current === 'object' && current !== null; depth++) {
    const record = current as { name?: unknown; inner?: unknown };
    if (typeof record.name === 'string') {
      names.push(record.name);
    }
    current = record.inner;
  }
  const code = names.map((name) => CODE_BY_ERROR_NAME[name]).find((value) => value !== undefined);
  return new PersistenceError(code ?? 'UNKNOWN', { cause: error });
}
