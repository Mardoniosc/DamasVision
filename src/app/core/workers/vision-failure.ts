import { SAME_ORIGIN, VisionProviderSettings } from './vision-provider';
import { VisionWorkerError } from './vision-worker.client';

/** pt-BR message for a recognition that could not start or stopped, by provider. */
export function visionFailureMessage(
  error: unknown,
  settings: VisionProviderSettings,
  fallback: string,
): string {
  if (settings.kind !== 'local-service') return fallback;
  if (
    error instanceof VisionWorkerError &&
    error.workerCode !== undefined &&
    !['SERVICE_UNAVAILABLE', 'INIT_FAILED', 'NOT_INITIALIZED'].includes(error.workerCode)
  ) {
    return `O serviço de visão local recusou o pedido: ${error.message}`;
  }
  if (settings.serviceUrl === SAME_ORIGIN) {
    return (
      'O serviço de visão deste servidor não respondeu. Verifique se o contêiner "vision" está ' +
      'em execução (docker compose ps) ou escolha o reconhecimento do navegador em Configurações.'
    );
  }
  return (
    `O serviço de visão local não respondeu em ${settings.serviceUrl}. ` +
    'Inicie-o com "npm run vision:serve" ou escolha o reconhecimento do navegador em Configurações.'
  );
}
