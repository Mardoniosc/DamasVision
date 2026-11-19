import { Component, computed, input, output } from '@angular/core';
import { BOARD_SIZE, isPlayableSquare, SQUARE_COUNT } from '../../../domain/board/board';
import { ObservedPiece } from '../../../domain/board/piece';

const PIECE_LABELS: Readonly<Record<ObservedPiece, string>> = {
  EMPTY: 'vazia',
  WHITE: 'peça branca',
  BLACK: 'peça preta',
  WHITE_KING: 'dama branca',
  BLACK_KING: 'dama preta',
  UNKNOWN: 'desconhecida',
};

const FILES = 'abcdefgh';

/** Square name in algebraic style: files a–h left→right, ranks 1–8 from White's side (row 7). */
export function squareName(index: number): string {
  const row = Math.floor(index / BOARD_SIZE);
  const column = index % BOARD_SIZE;
  return `${FILES[column]}${BOARD_SIZE - row}`;
}

interface SquareView {
  readonly index: number;
  readonly playable: boolean;
  readonly piece: ObservedPiece;
  readonly confidence: number | null;
  readonly lowConfidence: boolean;
  readonly changed: boolean;
  readonly selected: boolean;
  readonly label: string;
}

/**
 * Presentational 8×8 board in canonical orientation (White at the bottom). Renders any
 * observation, including UNKNOWN squares and confidence; emits square selections.
 */
@Component({
  selector: 'app-board-view',
  template: `
    <div class="grid grid-cols-[auto_1fr] gap-1">
      <div class="grid grid-rows-8 text-center text-[10px] text-stone-500" aria-hidden="true">
        @for (rank of ranks; track rank) {
          <span class="flex items-center pr-1">{{ rank }}</span>
        }
      </div>
      <div
        class="grid aspect-square grid-cols-8 grid-rows-8 overflow-hidden rounded border border-stone-400"
        role="group"
        [attr.aria-label]="label()"
      >
        @for (square of squares(); track square.index) {
          @if (square.playable) {
            <button
              type="button"
              class="relative flex items-center justify-center bg-board-dark disabled:cursor-default"
              [class.outline]="square.selected"
              [class.outline-3]="square.selected"
              [class.outline-sky-400]="square.selected"
              [class.-outline-offset-3]="square.selected"
              [disabled]="!interactive()"
              [attr.aria-label]="square.label"
              [attr.title]="square.label"
              [attr.aria-pressed]="interactive() ? square.selected : null"
              [attr.data-square]="square.index"
              [attr.data-piece]="square.piece"
              (click)="squareSelect.emit(square.index)"
            >
              @switch (square.piece) {
                @case ('EMPTY') {}
                @case ('UNKNOWN') {
                  <span
                    class="flex aspect-square w-3/4 items-center justify-center rounded-full border-2 border-dashed border-amber-400 font-bold text-amber-300"
                    >?</span
                  >
                }
                @default {
                  <span
                    class="flex aspect-square w-3/4 items-center justify-center rounded-full border-2 shadow"
                    [class]="pieceClass(square.piece)"
                    [class.ring-2]="square.lowConfidence"
                    [class.ring-amber-400]="square.lowConfidence"
                  >
                    @if (square.piece === 'WHITE_KING' || square.piece === 'BLACK_KING') {
                      <span class="text-[0.7em] leading-none" aria-hidden="true">♛</span>
                    }
                  </span>
                }
              }
              @if (square.changed) {
                <span
                  class="absolute top-0.5 right-0.5 h-2 w-2 rounded-full bg-sky-400"
                  aria-hidden="true"
                ></span>
              }
            </button>
          } @else {
            <div class="bg-board-light" aria-hidden="true"></div>
          }
        }
      </div>
      <span></span>
      <div class="grid grid-cols-8 text-center text-[10px] text-stone-500" aria-hidden="true">
        @for (file of files; track file) {
          <span>{{ file }}</span>
        }
      </div>
    </div>
  `,
})
export class BoardViewComponent {
  /** Exactly 64 cells, canonical order. */
  readonly cells = input.required<readonly ObservedPiece[]>();
  readonly confidence = input<readonly number[] | null>(null);
  /** Confidence below which a piece is drawn with a warning ring. */
  readonly lowConfidenceBelow = input(0.8);
  readonly changed = input<readonly number[]>([]);
  readonly selected = input<number | null>(null);
  readonly interactive = input(false);
  readonly label = input('Tabuleiro');
  /** Optional explanation per square (e.g. why it is UNKNOWN), shown as tooltip and read aloud. */
  readonly notes = input<ReadonlyMap<number, string> | null>(null);

  readonly squareSelect = output<number>();

  protected readonly ranks = Array.from({ length: BOARD_SIZE }, (_, i) => BOARD_SIZE - i);
  protected readonly files = FILES.split('');

  protected readonly squares = computed<SquareView[]>(() => {
    const cells = this.cells();
    const confidence = this.confidence();
    const changed = new Set(this.changed());
    const selected = this.selected();
    const notes = this.notes();
    return Array.from({ length: SQUARE_COUNT }, (_, index) => {
      const piece = cells[index] ?? 'UNKNOWN';
      const value = confidence?.[index] ?? null;
      const percent = value === null ? '' : `, confiança ${Math.round(value * 100)}%`;
      return {
        index,
        playable: isPlayableSquare(index),
        piece,
        confidence: value,
        lowConfidence: value !== null && value < this.lowConfidenceBelow(),
        changed: changed.has(index),
        selected: selected === index,
        label: `Casa ${squareName(index)}: ${PIECE_LABELS[piece]}${percent}${changed.has(index) ? ', corrigida' : ''}${notes?.has(index) ? ` (${notes.get(index)})` : ''}`,
      };
    });
  });

  protected pieceClass(piece: ObservedPiece): string {
    return piece === 'WHITE' || piece === 'WHITE_KING'
      ? 'border-stone-300 bg-stone-50 text-red-700'
      : 'border-stone-600 bg-stone-900 text-amber-300';
  }
}
