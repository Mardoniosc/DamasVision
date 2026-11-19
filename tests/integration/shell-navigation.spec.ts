import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { provideRouter, Router, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes } from '../../src/app/app.routes';

/**
 * Integration: real route table + lazy feature components, rendered through the router.
 */
describe('Shell navigation (integration)', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter(routes, withComponentInputBinding())],
    });
  });

  async function navigate(url: string): Promise<HTMLElement> {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url);
    return harness.routeNativeElement as HTMLElement;
  }

  const cases: readonly { url: string; heading: string; title: string }[] = [
    { url: '/', heading: 'Damas Vision', title: 'Damas Vision' },
    { url: '/game/new', heading: 'Nova partida', title: 'Nova partida · Damas Vision' },
    { url: '/calibration', heading: 'Calibração', title: 'Calibração · Damas Vision' },
    { url: '/games', heading: 'Partidas', title: 'Partidas · Damas Vision' },
    { url: '/settings', heading: 'Configurações', title: 'Configurações · Damas Vision' },
  ];

  for (const { url, heading, title } of cases) {
    it(`loads ${url}`, async () => {
      const element = await navigate(url);

      expect(element.querySelector('h1')?.textContent?.trim()).toBe(heading);
      expect(TestBed.inject(Title).getTitle()).toBe(title);
    });
  }

  it('binds the :id route parameter into the live game page', async () => {
    const element = await navigate('/game/abc-123');

    expect(element.querySelector('h1')?.textContent?.trim()).toBe('Partida');
    expect(element.querySelector('code')?.textContent).toBe('abc-123');
  });

  it('redirects unknown URLs to the home page', async () => {
    const element = await navigate('/does/not/exist');

    expect(TestBed.inject(Router).url).toBe('/');
    expect(element.querySelector('h1')?.textContent?.trim()).toBe('Damas Vision');
  });
});
