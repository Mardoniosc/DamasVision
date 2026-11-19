import { Component, input } from '@angular/core';
import { PagePlaceholderComponent } from '../../shared/components/page-placeholder/page-placeholder.component';

@Component({
  selector: 'app-live-game-page',
  imports: [PagePlaceholderComponent],
  template: `
    <app-page-placeholder
      heading="Partida"
      description="Tabuleiro digital autoritativo, pré-visualização da câmera e histórico de lances."
      epic="E6 — Integração da partida"
    >
      <p class="text-sm text-stone-500">
        Identificador da partida: <code class="font-mono">{{ id() }}</code>
      </p>
    </app-page-placeholder>
  `,
})
export class LiveGamePageComponent {
  /** Bound from the `:id` route parameter (withComponentInputBinding). */
  readonly id = input.required<string>();
}
