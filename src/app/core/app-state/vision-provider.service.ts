import { inject, Injectable } from '@angular/core';
import { getSetting, SETTINGS_REPOSITORY, setSetting } from '../persistence/settings.repository';
import {
  DEFAULT_VISION_PROVIDER,
  isVisionProviderSettings,
  normalizeServiceUrl,
  VISION_CONTRACT_VERSION,
  VisionProviderSettings,
} from '../workers/vision-provider';
import { REMOTE_VISION_TUNING, VisionProviderState } from '../workers/vision-provider.state';

export type ServiceProbe =
  | { readonly ok: true; readonly serviceVersion: string; readonly opencvVersion: string }
  | { readonly ok: false; readonly message: string };

/**
 * Loads, saves and checks the recognizer choice (G3.1, ADR-042). The choice is stored in
 * the settings (`vision.provider`) and published to `VisionProviderState`, which the
 * vision worker factory reads.
 */
@Injectable({ providedIn: 'root' })
export class VisionProviderService {
  private readonly settings = inject(SETTINGS_REPOSITORY);
  private readonly state = inject(VisionProviderState);
  private readonly tuning = inject(REMOTE_VISION_TUNING);

  readonly current = this.state.settings;

  /** Reads the stored choice; an unreadable or invalid value means the browser recognizer. */
  load(): Promise<void> {
    const loading = (async () => {
      try {
        const stored = await getSetting(this.settings, 'vision.provider');
        this.state.set(isVisionProviderSettings(stored) ? stored : DEFAULT_VISION_PROVIDER);
      } catch {
        this.state.set(DEFAULT_VISION_PROVIDER);
      }
    })();
    this.state.trackLoad(loading);
    return loading;
  }

  /** Validates and stores a choice. Throws a pt-BR `Error` for an unacceptable URL. */
  async save(settings: VisionProviderSettings): Promise<void> {
    const serviceUrl = normalizeServiceUrl(settings.serviceUrl);
    if (!serviceUrl) {
      throw new Error(
        'Use um endereço deste computador, por exemplo http://127.0.0.1:8765: as imagens nunca saem dele.',
      );
    }
    const value = { kind: settings.kind, serviceUrl };
    await setSetting(this.settings, 'vision.provider', value);
    this.state.set(value);
  }

  /** "Testar conexão": the service's health and contract version. */
  async probe(url: string): Promise<ServiceProbe> {
    const serviceUrl = normalizeServiceUrl(url);
    if (!serviceUrl) {
      return {
        ok: false,
        message: 'Endereço inválido: use http://127.0.0.1:<porta> ou http://localhost:<porta>.',
      };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.tuning.healthTimeoutMs);
    try {
      const response = await fetch(`${serviceUrl}/v1/health`, { signal: controller.signal });
      const body = (await response.json()) as Record<string, unknown>;
      if (!response.ok || body['status'] !== 'ok') {
        return { ok: false, message: 'O serviço respondeu com erro.' };
      }
      if (body['contractVersion'] !== VISION_CONTRACT_VERSION) {
        return {
          ok: false,
          message: `O serviço usa o contrato v${String(body['contractVersion'])}; este app precisa da v${VISION_CONTRACT_VERSION}.`,
        };
      }
      return {
        ok: true,
        serviceVersion: String(body['serviceVersion']),
        opencvVersion: String(body['opencvVersion']),
      };
    } catch {
      return {
        ok: false,
        message: `Nenhum serviço respondeu em ${serviceUrl}. Inicie-o com "npm run vision:serve".`,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
