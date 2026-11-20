import { Component, inject, OnInit, signal } from '@angular/core';
import { GAME_REPOSITORY } from '../../core/persistence/game.repository';
import { RouterLink } from '@angular/router';

interface SetupStep {
  readonly title: string;
  readonly description: string;
}

@Component({
  selector: 'app-home-page',
  imports: [RouterLink],
  template: `
    <section class="space-y-8" aria-labelledby="home-heading">
      <div class="space-y-3">
        <h1 id="home-heading" class="text-3xl font-semibold tracking-tight">Damas Vision</h1>
        <p class="max-w-prose text-stone-600">
          Acompanhe uma partida de damas brasileiras (64 casas) jogada em um tabuleiro físico. A
          câmera observa o tabuleiro; o motor de regras valida cada lance.
        </p>
      </div>

      @if (resume(); as game) {
        <div
          class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-brand-100 bg-brand-50 p-4"
          data-testid="resume-game"
        >
          <p class="text-sm">
            Partida em andamento: <strong>{{ game.players }}</strong> · {{ game.moves }} lance(s)
          </p>
          <a
            [routerLink]="['/game', game.id]"
            class="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700"
          >
            Continuar partida
          </a>
        </div>
      }

      <div class="flex flex-wrap gap-3">
        <a
          routerLink="/game/new"
          class="rounded-md bg-brand-600 px-4 py-2 font-medium text-white hover:bg-brand-700"
        >
          Nova partida
        </a>
        <a
          routerLink="/games"
          class="rounded-md border border-stone-300 bg-white px-4 py-2 font-medium hover:bg-stone-50"
        >
          Partidas salvas
        </a>
      </div>

      <div class="space-y-3">
        <h2 class="text-lg font-semibold">Como vai funcionar</h2>
        <ol class="grid gap-3 sm:grid-cols-2">
          @for (step of steps; track step.title; let index = $index) {
            <li class="rounded-lg border border-stone-200 bg-white p-4">
              <p class="text-sm font-semibold">{{ index + 1 }}. {{ step.title }}</p>
              <p class="mt-1 text-sm text-stone-600">{{ step.description }}</p>
            </li>
          }
        </ol>
      </div>
    </section>
  `,
})
export class HomePageComponent implements OnInit {
  private readonly games = inject(GAME_REPOSITORY);
  /** The most recent unfinished game, to continue after a reload (E7-T07). */
  protected readonly resume = signal<{ id: string; players: string; moves: number } | null>(null);

  async ngOnInit(): Promise<void> {
    try {
      const game = (await this.games.list()).find((g) => g.status !== 'FINISHED');
      if (game) {
        this.resume.set({
          id: game.id,
          players: `${game.whitePlayerLabel} × ${game.blackPlayerLabel}`,
          moves: game.moves.length,
        });
      }
    } catch {
      // Storage unavailable: nothing to continue (the history page explains the error).
    }
  }

  protected readonly steps: readonly SetupStep[] = [
    { title: 'Câmera', description: 'Escolha a câmera e posicione-a sobre o tabuleiro.' },
    { title: 'Calibração', description: 'Marque os quatro cantos do tabuleiro na imagem.' },
    {
      title: 'Reconhecimento',
      description: 'Confira a posição inicial e corrija casas incertas.',
    },
    { title: 'Partida', description: 'Jogue normalmente; cada lance é validado pelo motor.' },
  ];
}
