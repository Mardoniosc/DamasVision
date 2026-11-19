import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

interface NavigationItem {
  readonly label: string;
  readonly path: string;
  readonly exact: boolean;
}

/**
 * Application shell: header, primary navigation and the routed content area.
 * It holds no game, vision or persistence logic.
 */
@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './app.component.html',
})
export class App {
  protected readonly appName = 'Damas Vision';

  protected readonly navigation: readonly NavigationItem[] = [
    { label: 'Início', path: '/', exact: true },
    { label: 'Nova partida', path: '/game/new', exact: false },
    { label: 'Calibração', path: '/calibration', exact: false },
    { label: 'Partidas', path: '/games', exact: false },
    { label: 'Configurações', path: '/settings', exact: false },
  ];
}
