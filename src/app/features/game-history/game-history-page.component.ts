import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { GameSessionController } from '../../core/app-state/game-session.controller';
import { GAME_REPOSITORY, PersistedGame } from '../../core/persistence/game.repository';
import { toPersistenceError } from '../../core/persistence/persistence.models';
import { gameStatistics } from '../../domain/game/game-statistics';
import { downloadJson } from '../../shared/utilities/file-export';
import { resultMessage } from '../live-game/game-messages';

const STATUS_LABELS: Readonly<Record<PersistedGame['status'], string>> = {
  ACTIVE: 'Em andamento',
  PAUSED: 'Pausada',
  RECONCILIATION_REQUIRED: 'Aguardando confirmação',
  FINISHED: 'Encerrada',
};

const DATE = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

/** "N pela câmera · M manuais", plus adjustments when any. */
function statisticsText(game: PersistedGame): string | null {
  const stats = gameStatistics(game);
  if (stats.moves === 0) return null;
  const parts = [`${stats.byCamera} pela câmera`, `${stats.manual} manual(is)`];
  if (stats.undos > 0) parts.push(`${stats.undos} desfeito(s)`);
  if (stats.corrections > 0) parts.push(`${stats.corrections} correção(ões) de posição`);
  return parts.join(' · ');
}

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
      stats: statisticsText(game),
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

  /**
   * Exports a game as JSON (E8-T02): the record and its statistics, for the physical test
   * matrix. Positions and moves only — never camera images.
   */
  protected export(id: string): void {
    const game = this.games()?.find((g) => g.id === id);
    if (!game) return;
    downloadJson(`damas-vision-partida-${game.createdAt.replace(/[:.]/g, '-')}.json`, {
      format: 'damas-vision/game',
      version: 1,
      statistics: gameStatistics(game),
      game,
    });
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
