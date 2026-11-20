import { inject, Injectable, signal } from '@angular/core';
import { getSetting, SETTINGS_REPOSITORY, setSetting } from '../persistence/settings.repository';
import {
  DEFAULT_VISION_PROVIDER,
  isVisionProviderSettings,
  DEPLOYMENT_CONFIG_PATH,
  normalizeServiceUrl,
  resolveServiceUrl,
  SAME_ORIGIN,
  serviceEndpoint,
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
  private readonly deploymentState = signal<VisionProviderSettings | null>(null);
  /** The recognizer the server recommends (`/deployment.json`), if any. */
  readonly deploymentDefault = this.deploymentState.asReadonly();

  /**
   * Chooses the recognizer: the one stored on this device; else the deployment's default
   * (the Docker image serves `/deployment.json`: the service on the same origin); else the
   * browser recognizer.
   */
  load(): Promise<void> {
    const loading = (async () => {
      const deployment = await this.readDeploymentDefault();
      this.deploymentState.set(deployment);
      let stored: unknown;
      try {
        stored = await getSetting(this.settings, 'vision.provider');
      } catch {
        stored = undefined;
      }
      this.state.set(
        isVisionProviderSettings(stored) ? stored : (deployment ?? DEFAULT_VISION_PROVIDER),
      );
    })();
    this.state.trackLoad(loading);
    return loading;
  }

  private async readDeploymentDefault(): Promise<VisionProviderSettings | null> {
    const origin = globalThis.location?.origin;
    if (!origin || typeof fetch !== 'function') return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.tuning.healthTimeoutMs);
    try {
      const response = await fetch(serviceEndpoint(origin, DEPLOYMENT_CONFIG_PATH), {
        signal: controller.signal,
      });
      if (!response.ok) return null;
      const body = (await response.json()) as { visionProvider?: unknown };
      return isVisionProviderSettings(body.visionProvider) ? body.visionProvider : null;
    } catch {
      // No deployment file (dev server, static hosting): the built-in default applies.
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Validates and stores a choice. Throws a pt-BR `Error` for an unacceptable URL. */
  async save(settings: VisionProviderSettings): Promise<void> {
    const serviceUrl = normalizeServiceUrl(settings.serviceUrl);
    if (!serviceUrl) {
      throw new Error(
        'Use o serviço deste servidor ou um endereço deste computador, por exemplo http://127.0.0.1:8765.',
      );
    }
    const value = { kind: settings.kind, serviceUrl };
    await setSetting(this.settings, 'vision.provider', value);
    this.state.set(value);
  }

  /** "Testar conexão": the service's health and contract version. */
  async probe(url: string): Promise<ServiceProbe> {
    const normalized = normalizeServiceUrl(url);
    const serviceUrl =
      normalized && resolveServiceUrl(normalized, globalThis.location?.origin ?? '');
    if (!serviceUrl) {
      return {
        ok: false,
        message: 'Endereço inválido: use http://127.0.0.1:<porta> ou http://localhost:<porta>.',
      };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.tuning.healthTimeoutMs);
    try {
      const response = await fetch(serviceEndpoint(serviceUrl, '/v1/health'), {
        signal: controller.signal,
      });
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
        message:
          normalized === SAME_ORIGIN
            ? `O serviço de visão deste servidor (${serviceUrl}) não respondeu. Verifique o contêiner "vision" (docker compose ps).`
            : `Nenhum serviço respondeu em ${serviceUrl}. Inicie-o com "npm run vision:serve".`,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
