import { routes } from '../../src/app/app.routes';

/**
 * Route contract from docs/execution-specification.md §10.
 * Guards against accidentally dropping a required route or making a feature eager.
 */
describe('Application route contract', () => {
  const REQUIRED_PATHS = ['', 'game/new', 'calibration', 'game/:id', 'games', 'settings'];

  it('declares every route required by the specification', () => {
    const paths = routes.map((route) => route.path);
    for (const path of REQUIRED_PATHS) {
      expect(paths).toContain(path);
    }
  });

  it('lazy loads every feature route', () => {
    for (const route of routes.filter((r) => r.path !== '**')) {
      expect(route.loadComponent, `route "${route.path}" must be lazy`).toBeTypeOf('function');
      expect(route.component, `route "${route.path}" must not be eager`).toBeUndefined();
    }
  });

  it('declares "game/new" before "game/:id" so it is not captured as an id', () => {
    const paths = routes.map((route) => route.path);
    expect(paths.indexOf('game/new')).toBeLessThan(paths.indexOf('game/:id'));
  });

  it('ends with a wildcard fallback to the home page', () => {
    const last = routes.at(-1);
    expect(last?.path).toBe('**');
    expect(last?.redirectTo).toBe('');
  });

  it('gives every navigable route a document title', () => {
    for (const route of routes.filter((r) => r.path !== '**')) {
      expect(route.title, `route "${route.path}" needs a title`).toBeTypeOf('string');
    }
  });
});
