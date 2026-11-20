import { Component, inject, linkedSignal, OnInit, signal } from '@angular/core';
import { ServiceProbe, VisionProviderService } from '../../core/app-state/vision-provider.service';
import { toPersistenceError } from '../../core/persistence/persistence.models';
import { DEFAULT_SERVICE_URL, SAME_ORIGIN } from '../../core/workers/vision-provider';

/** Recognizer options of the form: the browser, the app's server, or another address. */
type ProviderMode = 'browser' | 'server' | 'url';
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

      <form
        class="max-w-xl space-y-3 rounded-lg border border-stone-200 bg-white p-4"
        aria-labelledby="vision-heading"
        (submit)="saveProvider($event)"
        data-testid="vision-provider-form"
      >
        <h2 id="vision-heading" class="font-semibold">Reconhecimento</h2>
        <p class="text-sm text-stone-600">
          Quem lê o tabuleiro. O navegador funciona em qualquer dispositivo, também sem internet. O
          serviço de visão (Python + OpenCV) é opcional: no servidor que publica o app (Docker) ou
          neste computador. As imagens não vão para nenhum outro lugar.
        </p>
        <fieldset class="space-y-2 text-sm">
          <legend class="sr-only">Reconhecedor</legend>
          <label class="flex items-start gap-2">
            <input
              type="radio"
              name="provider"
              value="browser"
              class="mt-1"
              [checked]="mode() === 'browser'"
              (change)="setMode('browser')"
              data-testid="provider-browser"
            />
            <span>Navegador</span>
          </label>
          <label class="flex items-start gap-2">
            <input
              type="radio"
              name="provider"
              value="server"
              class="mt-1"
              [checked]="mode() === 'server'"
              (change)="setMode('server')"
              data-testid="provider-server"
            />
            <span>
              Serviço de visão deste servidor
              @if (serverRecommended()) {
                <span class="text-brand-700">(recomendado por este servidor)</span>
              }
              <span class="block text-xs text-stone-600"
                >O mesmo endereço do app ({{ origin }}), como na instalação com Docker.</span
              >
            </span>
          </label>
          <label class="flex items-start gap-2">
            <input
              type="radio"
              name="provider"
              value="local-service"
              class="mt-1"
              [checked]="mode() === 'url'"
              (change)="setMode('url')"
              data-testid="provider-service"
            />
            <span>Serviço de visão neste computador (outro endereço)</span>
          </label>
        </fieldset>
        @if (mode() === 'url') {
          <label class="block text-sm">
            <span class="text-stone-600">Endereço do serviço</span>
            <input
              class="mt-1 block w-full rounded-md border border-stone-300 px-2 py-1.5 font-mono"
              [value]="serviceUrl()"
              (input)="serviceUrl.set(value($event)); providerState.set('IDLE')"
              data-testid="service-url"
            />
          </label>
          <p class="text-xs text-stone-600">
            Inicie o serviço com <code>npm run vision:serve</code> (veja vision-service/README.md).
          </p>
        }
        <div class="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            class="rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700"
            data-testid="save-provider"
          >
            Salvar
          </button>
          @if (mode() !== 'browser') {
            <button
              type="button"
              class="rounded-md border border-stone-300 px-3 py-2 text-sm hover:bg-stone-50"
              (click)="testService()"
              data-testid="test-service"
            >
              Testar conexão
            </button>
          }
          @if (providerState() === 'SAVED') {
            <span role="status" class="text-sm text-brand-700" data-testid="provider-status"
              >Salvo. Vale a partir da próxima tela de câmera.</span
            >
          }
        </div>
        @if (probe(); as result) {
          @if (result.ok) {
            <p role="status" class="text-sm text-brand-700" data-testid="probe-result">
              Serviço encontrado (versão {{ result.serviceVersion }}, OpenCV
              {{ result.opencvVersion }}).
            </p>
          } @else {
            <p role="alert" class="text-sm text-red-800" data-testid="probe-result">
              {{ result.message }}
            </p>
          }
        }
        @if (providerError(); as message) {
          <p role="alert" class="text-sm text-red-800">{{ message }}</p>
        }
      </form>
    </section>
  `,
})
export class SettingsPageComponent implements OnInit {
  private readonly settings = inject(SETTINGS_REPOSITORY);
  private readonly vision = inject(VisionProviderService);

  protected readonly white = signal('');
  protected readonly black = signal('');
  protected readonly state = signal<SaveState>('IDLE');
  protected readonly error = signal<string | null>(null);

  protected readonly origin = globalThis.location?.origin ?? '';
  // Follow the stored choice, which loads asynchronously at start, until the user changes it.
  protected readonly mode = linkedSignal<ProviderMode>(() => this.modeOf(this.vision.current()));
  protected readonly serviceUrl = linkedSignal(() =>
    this.vision.current().serviceUrl === SAME_ORIGIN
      ? DEFAULT_SERVICE_URL
      : this.vision.current().serviceUrl,
  );
  protected readonly serverRecommended = () =>
    this.vision.deploymentDefault()?.serviceUrl === SAME_ORIGIN;
  protected readonly providerState = signal<SaveState>('IDLE');
  protected readonly providerError = signal<string | null>(null);
  protected readonly probe = signal<ServiceProbe | null>(null);

  async ngOnInit(): Promise<void> {
    try {
      const labels = await getSetting(this.settings, 'players.defaultLabels');
      this.white.set(labels?.white ?? '');
      this.black.set(labels?.black ?? '');
    } catch (error) {
      this.error.set(toPersistenceError(error).message);
    }
  }

  private modeOf(settings: { kind: string; serviceUrl: string }): ProviderMode {
    if (settings.kind === 'browser') return 'browser';
    return settings.serviceUrl === SAME_ORIGIN ? 'server' : 'url';
  }

  /** Address of the chosen service: this server, or the one typed. */
  private chosenUrl(): string {
    return this.mode() === 'server' ? SAME_ORIGIN : this.serviceUrl();
  }

  protected setMode(mode: ProviderMode): void {
    this.mode.set(mode);
    this.providerState.set('IDLE');
    this.probe.set(null);
  }

  protected async saveProvider(event: Event): Promise<void> {
    event.preventDefault();
    try {
      const mode = this.mode();
      await this.vision.save({
        kind: mode === 'browser' ? 'browser' : 'local-service',
        serviceUrl: mode === 'browser' ? this.serviceUrl() : this.chosenUrl(),
      });
      if (mode === 'url') this.serviceUrl.set(this.vision.current().serviceUrl);
      this.providerError.set(null);
      this.providerState.set('SAVED');
    } catch (error) {
      this.providerState.set('ERROR');
      // Both the URL check and the repository (PersistenceError) give pt-BR messages.
      this.providerError.set(
        error instanceof Error ? error.message : toPersistenceError(error).message,
      );
    }
  }

  protected async testService(): Promise<void> {
    this.probe.set(null);
    this.probe.set(await this.vision.probe(this.chosenUrl()));
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
