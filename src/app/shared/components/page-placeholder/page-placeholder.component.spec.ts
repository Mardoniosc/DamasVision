import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PagePlaceholderComponent } from './page-placeholder.component';

@Component({
  imports: [PagePlaceholderComponent],
  template: `
    <app-page-placeholder heading="Título" description="Descrição" epic="E9 — Teste">
      <p id="projected">conteúdo projetado</p>
    </app-page-placeholder>
  `,
})
class HostComponent {}

describe('PagePlaceholderComponent', () => {
  it('renders heading, description, epic and projected content', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('h1')?.textContent?.trim()).toBe('Título');
    expect(element.textContent).toContain('Descrição');
    expect(element.querySelector('[role="status"]')?.textContent).toContain('E9 — Teste');
    expect(element.querySelector('#projected')).not.toBeNull();
  });
});
