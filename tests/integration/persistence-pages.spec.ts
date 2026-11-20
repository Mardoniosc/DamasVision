import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes } from '../../src/app/app.routes';
import { GAME_REPOSITORY, toPersistedGame } from '../../src/app/core/persistence/game.repository';
import {
  PersistenceError,
  SettingsRepository,
} from '../../src/app/core/persistence/persistence.models';
import { SETTINGS_REPOSITORY } from '../../src/app/core/persistence/settings.repository';
import { initialBoard } from '../../src/app/domain/engine/board-state';
import { createGameSession, endGame } from '../../src/app/domain/game/game-session';
import { InMemoryGameRepository } from '../fixtures/in-memory-game-repository';

/** E7-T04/T06/T07 pages: settings, history, home "continue". */
class InMemorySettings implements SettingsRepository {
  readonly values = new Map<string, unknown>();
  async get<T>(key: string): Promise<T | undefined> {
    return this.values.get(key) as T | undefined;
  }
  async set<T>(key: string, value: T): Promise<void> {
    this.values.set(key, value);
  }
}

describe('Persistence pages (E7)', () => {
  let games: InMemoryGameRepository;
  let settings: InMemorySettings;

  const game = (id: string, updatedAt: string) =>
    createGameSession({
      id,
      board: initialBoard(),
      whitePlayerLabel: 'Ana',
      blackPlayerLabel: 'Bruno',
      timestamp: updatedAt,
    });

  beforeEach(async () => {
    games = new InMemoryGameRepository();
    settings = new InMemorySettings();
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes),
        { provide: GAME_REPOSITORY, useValue: games },
        { provide: SETTINGS_REPOSITORY, useValue: settings },
      ],
    });
    await games.create(
      toPersistedGame(
        endGame(
          game('done', '2026-11-18T10:00:00.000Z'),
          { status: 'DRAW', reason: 'AGREEMENT' },
          '2026-11-18T11:00:00.000Z',
        ),
      ),
    );
    await games.create(toPersistedGame(game('live', '2026-11-19T10:00:00.000Z')));
  });

  async function open(url: string) {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url);
    const element = harness.routeNativeElement as HTMLElement;
    const settle = async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      harness.detectChanges();
      await harness.fixture.whenStable();
    };
    await settle();
    return { element, settle };
  }

  it('the history lists saved games, newest first, with status and result', async () => {
    const { element } = await open('/games');
    const items = [...element.querySelectorAll('[data-game]')].map(
      (li) => li.textContent?.replace(/\s+/g, ' ') ?? '',
    );

    expect(items).toHaveLength(2);
    expect(items[0]).toContain('Ana × Bruno');
    expect(items[0]).toContain('Em andamento');
    expect(items[0]).toContain('Continuar');
    expect(items[1]).toContain('Empate (acordo entre os jogadores).');
    expect(items[1]).toContain('Abrir');
  });

  it('deleting a game asks for confirmation first', async () => {
    const { element, settle } = await open('/games');
    const deleteButton = () =>
      [...element.querySelectorAll<HTMLButtonElement>('[data-game="done"] button')].at(
        -1,
      ) as HTMLButtonElement;

    deleteButton().click();
    await settle();
    expect(games.games.has('done')).toBe(true);
    expect(deleteButton().textContent?.trim()).toBe('Confirmar exclusão');

    deleteButton().click();
    await settle();
    expect(games.games.has('done')).toBe(false);
    expect(element.querySelectorAll('[data-game]')).toHaveLength(1);
  });

  it('the history explains a storage failure', async () => {
    vi.spyOn(games, 'list').mockRejectedValue(new PersistenceError('UNAVAILABLE'));

    const { element } = await open('/games');

    expect(element.querySelector('[role="alert"]')?.textContent).toContain(
      'armazenamento local não está disponível',
    );
  });

  it('the home page offers to continue the latest unfinished game', async () => {
    const { element } = await open('/');

    expect(element.querySelector('[data-testid="resume-game"]')?.textContent).toContain(
      'Ana × Bruno',
    );
    expect(element.querySelector('[data-testid="resume-game"] a')?.getAttribute('href')).toBe(
      '/game/live',
    );
  });

  it('settings save the default player names', async () => {
    await settings.set('players.defaultLabels', { white: 'Ana', black: '' });
    const { element, settle } = await open('/settings');
    const white = element.querySelector<HTMLInputElement>(
      '[data-testid="default-white"]',
    ) as HTMLInputElement;
    const black = element.querySelector<HTMLInputElement>(
      '[data-testid="default-black"]',
    ) as HTMLInputElement;
    expect(white.value).toBe('Ana');

    black.value = ' Bruno ';
    black.dispatchEvent(new Event('input'));
    element.querySelector('form')?.dispatchEvent(new Event('submit'));
    await settle();

    expect(settings.values.get('players.defaultLabels')).toEqual({ white: 'Ana', black: 'Bruno' });
    expect(element.querySelector('[data-testid="settings-status"]')?.textContent?.trim()).toBe(
      'Salvo.',
    );
  });
});
