import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { App } from './app.component';

describe('App shell', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter([])],
    }).compileComponents();
  });

  async function render(): Promise<HTMLElement> {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  it('creates the shell', () => {
    const fixture = TestBed.createComponent(App);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('renders the primary navigation with every top-level route', async () => {
    const element = await render();
    const nav = element.querySelector('nav[aria-label="Navegação principal"]');
    const links = Array.from(nav?.querySelectorAll('a') ?? []);

    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/',
      '/game/new',
      '/calibration',
      '/games',
      '/settings',
    ]);
  });

  it('provides a skip link to the main content and a router outlet', async () => {
    const element = await render();

    expect(element.querySelector('a[href="#main-content"]')).not.toBeNull();
    expect(element.querySelector('main#main-content router-outlet')).not.toBeNull();
  });
});
