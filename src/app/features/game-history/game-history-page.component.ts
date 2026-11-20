import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { GameSessionController } from '../../core/app-state/game-session.controller';
import { GAME_REPOSITORY, PersistedGame } from '../../core/persistence/game.repository';
import { toPersistenceError } from '../../core/persistence/persistence.models';
import { resultMessage } from '../live-game/game-messages';

const STATUS_LABELS: Readonly<Record<PersistedGame['status'], string>> = {
  ACTIVE: 'Em andamento',
  PAUSED: 'Pausada',
  RECONCILIATION_REQUIRED: 'Aguardando confirmação',
  FINISHED: 'Encerrada',
};

const DATE = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

/** Saved games on this device (E7-T06): open or continue, delete. */
@Component({
  selector: 'app-game-history-page',
  imports: [RouterLink],
  templateUrl: './game-history-page.component.html',
})
export class GameHistoryPageComponent implements OnInit {
  private readonly repository = inject(GAME_REPOSITORY);
  private readonly controller = inject(GameSessionController);

  protected readonly games = signal<readonly PersistedGame[] | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly confirmingDelete = signal<string | null>(null);
  protected readonly rows = computed(() =>
    (this.games() ?? []).map((game) => ({
      id: game.id,
      players: `${game.whitePlayerLabel} × ${game.blackPlayerLabel}`,
      date: DATE.format(new Date(game.createdAt)),
      updated: DATE.format(new Date(game.updatedAt)),
      status: STATUS_LABELS[game.status],
      result: resultMessage(game.result),
      moves: game.moves.length,
      finished: game.status === 'FINISHED',
    })),
  );

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  protected async remove(id: string): Promise<void> {
    if (this.confirmingDelete() !== id) {
      this.confirmingDelete.set(id);
      return;
    }
    this.confirmingDelete.set(null);
    try {
      await this.repository.delete(id);
      if (this.controller.session()?.id === id) this.controller.close();
      await this.load();
    } catch (error) {
      this.error.set(toPersistenceError(error).message);
    }
  }

  private async load(): Promise<void> {
    try {
      this.games.set(await this.repository.list());
      this.error.set(null);
    } catch (error) {
      this.games.set([]);
      this.error.set(toPersistenceError(error).message);
    }
  }
}
