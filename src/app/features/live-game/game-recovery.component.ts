import { Component, computed, inject, signal } from '@angular/core';
import { GameSessionController } from '../../core/app-state/game-session.controller';
import { isPlayableSquare } from '../../domain/board/board';
import { squareName } from '../../domain/board/board-notation';
import { ObservedPiece, Piece, PlayerColor } from '../../domain/board/piece';
import { validateInitialPosition } from '../../domain/game/game-session';
import { Move } from '../../domain/move/move';
import { BoardViewComponent } from '../../shared/components/board-view/board-view.component';
import { RecognitionStore } from '../recognition/recognition.store';
import { inferenceMessage, initialPositionMessage } from './game-messages';

const PIECE_OPTIONS: readonly { readonly piece: Piece; readonly label: string }[] = [
  { piece: 'EMPTY', label: 'Vazia' },
  { piece: 'WHITE', label: 'Branca' },
  { piece: 'BLACK', label: 'Preta' },
  { piece: 'WHITE_KING', label: 'Dama branca' },
  { piece: 'BLACK_KING', label: 'Dama preta' },
];

/**
 * Recovery (E6-T05, spec §8 "Recovery"): decide on an uncertain reading, register a move
 * by hand, or set the authoritative position explicitly. Editing the observation never
 * changes the game by itself: every change goes through the controller and the engine.
 */
@Component({
  selector: 'app-game-recovery',
  imports: [BoardViewComponent],
  templateUrl: './game-recovery.component.html',
})
export class GameRecoveryComponent {
  protected readonly game = inject(GameSessionController);
  private readonly recognition = inject(RecognitionStore);

  protected readonly pieceOptions = PIECE_OPTIONS;
  protected readonly editing = signal(false);
  protected readonly draft = signal<readonly ObservedPiece[] | null>(null);
  protected readonly selected = signal<number | null>(null);
  protected readonly draftPlayer = signal<PlayerColor>('WHITE');
  protected readonly reason = signal('');

  protected readonly active = computed(() => {
    const status = this.game.session()?.status;
    return status !== undefined && status !== 'FINISHED' && status !== 'PAUSED';
  });
  protected readonly pending = this.game.pending;
  protected readonly pendingMessage = computed(() =>
    inferenceMessage(this.pending()?.inference ?? null),
  );
  protected readonly candidates = computed(
    () => this.pending()?.inference.candidates.map((c) => c.move) ?? [],
  );
  protected readonly draftValidation = computed(() => {
    const draft = this.draft();
    return draft ? validateInitialPosition({ cells: draft }) : null;
  });
  protected readonly draftProblems = computed(() =>
    (this.draftValidation()?.problems ?? []).map(initialPositionMessage),
  );

  protected moveLabel(move: Move): string {
    return move.capturedSquares.length > 0
      ? `${move.id} (captura ${move.capturedSquares.map(squareName).join(', ')})`
      : move.id;
  }

  protected async confirm(move: Move): Promise<void> {
    await this.game.confirmMove(move);
  }

  /** Starts editing from what the camera sees (or the official board without a reading). */
  protected startEditing(fromCamera: boolean): void {
    const session = this.game.session();
    if (!session) return;
    const seen = fromCamera ? this.recognition.latest()?.board.cells : null;
    this.draft.set(seen ? [...seen] : [...session.board.cells]);
    this.draftPlayer.set(session.currentPlayer);
    this.selected.set(null);
    this.reason.set('');
    this.editing.set(true);
  }

  protected select(index: number): void {
    if (isPlayableSquare(index)) this.selected.set(this.selected() === index ? null : index);
  }

  protected setPiece(piece: Piece): void {
    const index = this.selected();
    const draft = this.draft();
    if (index === null || !draft) return;
    this.draft.set(draft.map((cell, i) => (i === index ? piece : cell)));
  }

  protected setDraftPlayer(event: Event): void {
    this.draftPlayer.set((event.target as HTMLSelectElement).value === 'BLACK' ? 'BLACK' : 'WHITE');
  }

  protected setReason(event: Event): void {
    this.reason.set((event.target as HTMLInputElement).value);
  }

  protected async applyCorrection(): Promise<void> {
    const validation = this.draftValidation();
    if (!validation?.valid || !validation.board) return;
    const done = await this.game.correctPosition(
      validation.board,
      this.draftPlayer(),
      this.reason().trim() || 'Correção manual da posição',
    );
    if (done) this.editing.set(false);
  }
}
