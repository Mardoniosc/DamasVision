import {
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { GameSessionController } from '../../core/app-state/game-session.controller';
import { CameraService } from '../../core/camera/camera.service';
import { VISION_CONFIG, VisionWorkerClient } from '../../core/workers/vision-worker.client';
import { squareName } from '../../domain/board/board-notation';
import { PlayerColor } from '../../domain/board/piece';
import { BoardViewComponent } from '../../shared/components/board-view/board-view.component';
import { RecognitionPreviewComponent } from '../recognition/recognition-preview.component';
import { RecognitionStore } from '../recognition/recognition.store';
import {
  inferenceMessage,
  PHASE_LABELS,
  PLAYER_NAMES,
  reconciliationMessage,
  resultMessage,
} from './game-messages';
import { GameRecoveryComponent } from './game-recovery.component';

type LoadState = 'LOADING' | 'READY' | 'NOT_FOUND';

/**
 * Live game (E6-T04): the authoritative board, the camera with its reading, side to move,
 * last move, history, status and controls. The camera feed goes to the game-session
 * controller, which alone changes the game; this page only shows it and forwards the
 * user's decisions.
 */
@Component({
  selector: 'app-live-game-page',
  imports: [BoardViewComponent, GameRecoveryComponent, RecognitionPreviewComponent, RouterLink],
  providers: [RecognitionStore, VisionWorkerClient],
  templateUrl: './live-game-page.component.html',
})
export class LiveGamePageComponent {
  /** Bound from the `:id` route parameter (withComponentInputBinding). */
  readonly id = input.required<string>();

  protected readonly game = inject(GameSessionController);
  protected readonly recognition = inject(RecognitionStore);
  protected readonly camera = inject(CameraService);
  protected readonly acceptable = inject(VISION_CONFIG).confidenceThresholds.acceptable;
  protected readonly playerNames = PLAYER_NAMES;
  protected readonly loadState = signal<LoadState>('LOADING');
  protected readonly confirmingEnd = signal(false);

  protected readonly session = this.game.session;
  protected readonly phaseLabel = computed(() => PHASE_LABELS[this.game.phase()] ?? '');
  /** Status line; a pending decision is explained in the recovery panel instead. */
  protected readonly statusMessage = computed(() =>
    this.game.pending()
      ? null
      : (reconciliationMessage(this.game.reconciliation()) ??
        inferenceMessage(this.game.inference())),
  );
  protected readonly result = computed(() => resultMessage(this.session()?.result));
  protected readonly lastMoveSquares = computed(() => this.game.lastMove()?.move.path ?? []);
  /** Moves paired by number: 1. white black. */
  protected readonly history = computed(() => {
    const moves = this.session()?.moves ?? [];
    return moves.map((record) => ({
      ply: record.ply,
      notation: record.move.id,
      player: record.player,
      manual: record.source === 'MANUAL',
    }));
  });
  protected readonly lastMoveText = computed(() => {
    const last = this.game.lastMove();
    return last ? `${PLAYER_NAMES[last.player]}: ${last.move.id}` : '—';
  });
  protected readonly canUndo = computed(() => (this.session()?.moves.length ?? 0) > 0);
  protected readonly observedNote = computed(() => {
    const unknown = this.recognition.unknownCount();
    return unknown > 0 ? `${unknown} casa(s) sem leitura no momento.` : null;
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => this.camera.stop());
    // Open the game, then start the camera.
    effect(() => {
      const id = this.id();
      untracked(() => void this.open(id));
    });
    // Every stabilized reading goes to the controller (it ignores them when not watching).
    effect(() => {
      const reading = this.recognition.latest();
      if (!reading || this.recognition.phase() !== 'RECOGNIZING') return;
      untracked(() => void this.game.observe(reading.board));
    });
    // The camera is paused with the game — only on an actual change: resuming restarts
    // the per-square consolidation, which must not happen on every phase change.
    const cameraPaused = computed(
      () => this.game.phase() === 'PAUSED' || this.game.phase() === 'GAME_FINISHED',
    );
    effect(() => {
      const paused = cameraPaused();
      untracked(() => this.recognition.setLivePaused(paused));
    });
  }

  protected square(index: number): string {
    return squareName(index);
  }

  protected toMoveLabel(player: PlayerColor): string {
    const session = this.session();
    const name = player === 'WHITE' ? session?.whitePlayerLabel : session?.blackPlayerLabel;
    return `${PLAYER_NAMES[player]}${name && name !== PLAYER_NAMES[player] ? ` (${name})` : ''}`;
  }

  protected async togglePause(): Promise<void> {
    if (this.game.phase() === 'PAUSED') await this.game.resume();
    else await this.game.pause();
  }

  protected async endGame(kind: 'DRAW' | 'WHITE_RESIGNS' | 'BLACK_RESIGNS'): Promise<void> {
    this.confirmingEnd.set(false);
    await this.game.end(
      kind === 'DRAW'
        ? { status: 'DRAW', reason: 'AGREEMENT' }
        : {
            status: 'WIN',
            winner: kind === 'WHITE_RESIGNS' ? 'BLACK' : 'WHITE',
            reason: 'RESIGNATION',
          },
    );
  }

  private async open(id: string): Promise<void> {
    this.loadState.set('LOADING');
    const session = await this.game.load(id);
    this.loadState.set(session ? 'READY' : 'NOT_FOUND');
    if (session) await this.recognition.start();
  }
}
