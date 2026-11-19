import { Component } from '@angular/core';
import { PagePlaceholderComponent } from '../../shared/components/page-placeholder/page-placeholder.component';

@Component({
  selector: 'app-game-history-page',
  imports: [PagePlaceholderComponent],
  template: `
    <app-page-placeholder
      heading="Partidas"
      description="Histórico das partidas salvas neste dispositivo."
      epic="E7 — Persistência"
    />
  `,
})
export class GameHistoryPageComponent {}
