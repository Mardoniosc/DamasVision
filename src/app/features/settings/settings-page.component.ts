import { Component, inject, OnInit, signal } from '@angular/core';
import { toPersistenceError } from '../../core/persistence/persistence.models';
import {
  getSetting,
  SETTINGS_REPOSITORY,
  setSetting,
} from '../../core/persistence/settings.repository';

type SaveState = 'IDLE' | 'SAVED' | 'ERROR';

/** Application preferences stored on this device (E7-T04). */
@Component({
  selector: 'app-settings-page',
  template: `
    <section class="space-y-6" aria-labelledby="settings-heading">
      <header class="space-y-2">
        <h1 id="settings-heading" class="text-2xl font-semibold tracking-tight">Configurações</h1>
        <p class="max-w-prose text-stone-600">
          Preferências guardadas neste dispositivo. Nada é enviado para fora dele.
        </p>
      </header>

      <form
        class="max-w-xl space-y-3 rounded-lg border border-stone-200 bg-white p-4"
        aria-labelledby="players-heading"
        (submit)="save($event)"
      >
        <h2 id="players-heading" class="font-semibold">Jogadores</h2>
        <p class="text-sm text-stone-600">Nomes sugeridos ao iniciar uma partida.</p>
        <div class="grid gap-3 sm:grid-cols-2">
          <label class="block text-sm">
            <span class="text-stone-600">Brancas</span>
            <input
              class="mt-1 block w-full rounded-md border border-stone-300 px-2 py-1.5"
              maxlength="40"
              [value]="white()"
              (input)="white.set(value($event))"
              data-testid="default-white"
            />
          </label>
          <label class="block text-sm">
            <span class="text-stone-600">Pretas</span>
            <input
              class="mt-1 block w-full rounded-md border border-stone-300 px-2 py-1.5"
              maxlength="40"
              [value]="black()"
              (input)="black.set(value($event))"
              data-testid="default-black"
            />
          </label>
        </div>
        <div class="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            class="rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            Salvar
          </button>
          @if (state() === 'SAVED') {
            <span role="status" class="text-sm text-brand-700" data-testid="settings-status"
              >Salvo.</span
            >
          }
        </div>
        @if (error(); as message) {
          <p role="alert" class="text-sm text-red-800">{{ message }}</p>
        }
      </form>
    </section>
  `,
})
export class SettingsPageComponent implements OnInit {
  private readonly settings = inject(SETTINGS_REPOSITORY);

  protected readonly white = signal('');
  protected readonly black = signal('');
  protected readonly state = signal<SaveState>('IDLE');
  protected readonly error = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    try {
      const labels = await getSetting(this.settings, 'players.defaultLabels');
      this.white.set(labels?.white ?? '');
      this.black.set(labels?.black ?? '');
    } catch (error) {
      this.error.set(toPersistenceError(error).message);
    }
  }

  protected value(event: Event): string {
    this.state.set('IDLE');
    return (event.target as HTMLInputElement).value;
  }

  protected async save(event: Event): Promise<void> {
    event.preventDefault();
    try {
      await setSetting(this.settings, 'players.defaultLabels', {
        white: this.white().trim(),
        black: this.black().trim(),
      });
      this.error.set(null);
      this.state.set('SAVED');
    } catch (error) {
      this.state.set('ERROR');
      this.error.set(toPersistenceError(error).message);
    }
  }
}
