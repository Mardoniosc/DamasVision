import { Routes } from '@angular/router';

const APP_NAME = 'Damas Vision';

function pageTitle(page: string): string {
  return `${page} · ${APP_NAME}`;
}

/**
 * Application routes (docs/execution-specification.md §10).
 * Every feature is lazy loaded; the shell itself contains no feature logic.
 */
export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    title: APP_NAME,
    loadComponent: () =>
      import('./features/home/home-page.component').then((m) => m.HomePageComponent),
  },
  {
    path: 'game/new',
    title: pageTitle('Nova partida'),
    loadComponent: () =>
      import('./features/camera/game-setup-page.component').then((m) => m.GameSetupPageComponent),
  },
  {
    path: 'game/:id',
    title: pageTitle('Partida'),
    loadComponent: () =>
      import('./features/live-game/live-game-page.component').then((m) => m.LiveGamePageComponent),
  },
  {
    path: 'calibration',
    title: pageTitle('Calibração'),
    loadComponent: () =>
      import('./features/calibration/calibration-page.component').then(
        (m) => m.CalibrationPageComponent,
      ),
  },
  {
    // Setup step 3 (E3). Not in the spec §10 route list; see ADR-024.
    path: 'recognition',
    title: pageTitle('Reconhecimento'),
    loadComponent: () =>
      import('./features/recognition/recognition-page.component').then(
        (m) => m.RecognitionPageComponent,
      ),
  },
  {
    path: 'games',
    title: pageTitle('Partidas'),
    loadComponent: () =>
      import('./features/game-history/game-history-page.component').then(
        (m) => m.GameHistoryPageComponent,
      ),
  },
  {
    path: 'settings',
    title: pageTitle('Configurações'),
    loadComponent: () =>
      import('./features/settings/settings-page.component').then((m) => m.SettingsPageComponent),
  },
  { path: '**', redirectTo: '' },
];
