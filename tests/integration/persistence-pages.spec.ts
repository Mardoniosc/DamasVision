import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes } from '../../src/app/app.routes';
import { GAME_REPOSITORY, toPersistedGame } from '../../src/app/core/persistence/game.repository';
import { PersistenceError } from '../../src/app/core/persistence/persistence.models';
import { SETTINGS_REPOSITORY } from '../../src/app/core/persistence/settings.repository';
import { initialBoard } from '../../src/app/domain/engine/board-state';
import { createGameSession, endGame } from '../../src/app/domain/game/game-session';
import { InMemoryGameRepository } from '../fixtures/in-memory-game-repository';
import { InMemorySettings } from '../fixtures/in-memory-settings';

/** E7-T04/T06/T07 pages: settings, history, home "continue". */

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

  it('settings choose the recognizer and test the local vision service (G3.1)', async () => {
    vi.stubGlobal(
      'fetch',
      async () =>
        new Response(
          JSON.stringify({
            status: 'ok',
            contractVersion: 1,
            serviceVersion: '0.1.0',
            opencvVersion: '5.0.0',
          }),
        ),
    );
    const { element, settle } = await open('/settings');
    const form = element.querySelector('[data-testid="vision-provider-form"]') as HTMLFormElement;
    expect(element.querySelector('[data-testid="service-url"]')).toBeNull();

    (element.querySelector('[data-testid="provider-service"]') as HTMLInputElement).click();
    await settle();
    const url = element.querySelector('[data-testid="service-url"]') as HTMLInputElement;
    url.value = 'http://192.168.1.20:8765';
    url.dispatchEvent(new Event('input'));
    form.dispatchEvent(new Event('submit'));
    await settle();
    expect(form.querySelector('[role="alert"]')?.textContent).toContain(
      'endereço deste computador',
    );
    expect(settings.values.has('vision.provider')).toBe(false);

    url.value = 'http://localhost:8765';
    url.dispatchEvent(new Event('input'));
    (element.querySelector('[data-testid="test-service"]') as HTMLButtonElement).click();
    await settle();
    expect(element.querySelector('[data-testid="probe-result"]')?.textContent).toContain(
      'OpenCV 5.0.0',
    );
    form.dispatchEvent(new Event('submit'));
    await settle();

    expect(settings.values.get('vision.provider')).toEqual({
      kind: 'local-service',
      serviceUrl: 'http://localhost:8765',
    });
    expect(element.querySelector('[data-testid="provider-status"]')).not.toBeNull();
    vi.unstubAllGlobals();
  });

  it("settings choose the vision service of the app's server (Docker, ADR-043)", async () => {
    vi.stubGlobal('fetch', async () => new Response('{}', { status: 404 }));
    const { element, settle } = await open('/settings');
    const form = element.querySelector('[data-testid="vision-provider-form"]') as HTMLFormElement;

    (element.querySelector('[data-testid="provider-server"]') as HTMLInputElement).click();
    await settle();
    expect(element.querySelector('[data-testid="service-url"]')).toBeNull();
    form.dispatchEvent(new Event('submit'));
    await settle();

    expect(settings.values.get('vision.provider')).toEqual({
      kind: 'local-service',
      serviceUrl: 'same-origin',
    });
    vi.unstubAllGlobals();
  });
});
