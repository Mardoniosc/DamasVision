import { TestBed } from '@angular/core/testing';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { PersistedCalibration } from './persistence.models';
import { DAMAS_VISION_DB, DamasVisionDatabase } from './damas-vision.db';
import { CALIBRATION_REPOSITORY } from './calibration.repository';

function profile(id: string, overrides: Partial<PersistedCalibration> = {}): PersistedCalibration {
  return {
    id,
    name: `Calibração ${id}`,
    cameraDeviceId: 'cam-1',
    sourceWidth: 1280,
    sourceHeight: 720,
    corners: {
      topLeft: { x: 100, y: 50 },
      topRight: { x: 600, y: 60 },
      bottomRight: { x: 620, y: 560 },
      bottomLeft: { x: 90, y: 540 },
    },
    normalizedWidth: 800,
    normalizedHeight: 800,
    orientation: 'NORMAL',
    createdAt: '2026-11-19T10:00:00.000Z',
    updatedAt: '2026-11-19T10:00:00.000Z',
    isActive: false,
    ...overrides,
  };
}

describe('DexieCalibrationRepository (fake IndexedDB)', () => {
  let db: DamasVisionDatabase;

  beforeEach(() => {
    // A fresh in-memory IndexedDB per test.
    db = new DamasVisionDatabase({ indexedDB: new IDBFactory(), IDBKeyRange });
    TestBed.configureTestingModule({ providers: [{ provide: DAMAS_VISION_DB, useValue: db }] });
  });

  afterEach(() => {
    db.close();
  });

  const repository = () => TestBed.inject(CALIBRATION_REPOSITORY);

  it('creates and reads back a profile unchanged', async () => {
    await repository().create(profile('a'));

    expect(await repository().getById('a')).toEqual(profile('a'));
    expect(await repository().getById('missing')).toBeUndefined();
  });

  it('refuses to create a duplicate id', async () => {
    await repository().create(profile('a'));

    await expect(repository().create(profile('a'))).rejects.toMatchObject({
      code: 'ALREADY_EXISTS',
    });
  });

  it('updates an existing profile and fails for an unknown one', async () => {
    await repository().create(profile('a'));

    await repository().update(profile('a', { name: 'Mesa da sala', orientation: 'ROTATED_90' }));

    expect(await repository().getById('a')).toMatchObject({
      name: 'Mesa da sala',
      orientation: 'ROTATED_90',
    });
    await expect(repository().update(profile('zzz'))).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('lists the most recently updated first', async () => {
    await repository().create(profile('old', { updatedAt: '2026-01-01T00:00:00.000Z' }));
    await repository().create(profile('new', { updatedAt: '2026-11-01T00:00:00.000Z' }));

    expect((await repository().list()).map((p) => p.id)).toEqual(['new', 'old']);
  });

  it('keeps exactly one active profile', async () => {
    await repository().create(profile('a', { isActive: true }));
    await repository().create(profile('b'));

    await repository().setActive('b');

    expect((await repository().getActive())?.id).toBe('b');
    expect((await repository().list()).filter((p) => p.isActive).map((p) => p.id)).toEqual(['b']);
  });

  it('setActive() with an unknown id changes nothing', async () => {
    await repository().create(profile('a', { isActive: true }));

    await expect(repository().setActive('missing')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((await repository().getActive())?.id).toBe('a');
  });

  it('returns undefined when nothing is active', async () => {
    expect(await repository().getActive()).toBeUndefined();
  });

  it('maps a quota failure to QUOTA_EXCEEDED with a user-facing message', async () => {
    vi.spyOn(db.calibrations, 'add').mockRejectedValue(
      new DOMException('full', 'QuotaExceededError'),
    );

    const error = await repository()
      .create(profile('a'))
      .catch((e: unknown) => e);

    expect(error).toMatchObject({ code: 'QUOTA_EXCEEDED' });
    expect((error as Error).message).toContain('espaço');
  });
});
