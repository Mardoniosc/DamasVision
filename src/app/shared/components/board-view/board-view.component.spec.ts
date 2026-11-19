import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ObservedPiece } from '../../../domain/board/piece';
import { BoardViewComponent, squareName } from './board-view.component';

function cells(): ObservedPiece[] {
  const board: ObservedPiece[] = Array.from({ length: 64 }, () => 'EMPTY');
  board[1] = 'BLACK';
  board[3] = 'UNKNOWN';
  board[56] = 'WHITE_KING';
  return board;
}

@Component({
  imports: [BoardViewComponent],
  template: `
    <app-board-view
      [cells]="cells"
      [confidence]="confidence"
      [changed]="[56]"
      [notes]="notes"
      [selected]="selected()"
      [interactive]="interactive()"
      (squareSelect)="picked.push($event)"
    />
  `,
})
class HostComponent {
  readonly cells = cells();
  readonly confidence = cells().map((piece) => (piece === 'BLACK' ? 0.7 : 1));
  readonly selected = signal<number | null>(null);
  readonly interactive = signal(false);
  readonly picked: number[] = [];
  readonly notes = new Map([[3, 'ocupação ambígua']]);
}

describe('BoardViewComponent', () => {
  async function render() {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    const square = (index: number) =>
      element.querySelector<HTMLButtonElement>(`[data-square="${index}"]`);
    return { fixture, element, square };
  }

  it("names squares from White's side (a1 bottom-left, h8 top-right)", () => {
    expect(squareName(56)).toBe('a1');
    expect(squareName(7)).toBe('h8');
    expect(squareName(1)).toBe('b8');
  });

  it('renders 32 playable squares with pieces, UNKNOWN and labels', async () => {
    const { element, square } = await render();

    expect(element.querySelectorAll('[data-square]')).toHaveLength(32);
    expect(square(1)?.getAttribute('data-piece')).toBe('BLACK');
    expect(square(1)?.getAttribute('aria-label')).toBe('Casa b8: peça preta, confiança 70%');
    expect(square(3)?.textContent).toContain('?');
    expect(square(3)?.getAttribute('title')).toBe(
      'Casa d8: desconhecida, confiança 100% (ocupação ambígua)',
    );
    expect(square(56)?.getAttribute('aria-label')).toContain('dama branca');
    expect(square(56)?.getAttribute('aria-label')).toContain('corrigida');
  });

  it('is read-only unless interactive', async () => {
    const { fixture, square } = await render();
    const host = fixture.componentInstance;

    square(1)?.click();
    expect(square(1)?.disabled).toBe(true);
    expect(host.picked).toEqual([]);

    host.interactive.set(true);
    await fixture.whenStable();
    square(1)?.click();
    expect(host.picked).toEqual([1]);
  });

  it('marks the selected square', async () => {
    const { fixture, square } = await render();
    fixture.componentInstance.interactive.set(true);
    fixture.componentInstance.selected.set(3);
    await fixture.whenStable();

    expect(square(3)?.getAttribute('aria-pressed')).toBe('true');
    expect(square(1)?.getAttribute('aria-pressed')).toBe('false');
  });
});
