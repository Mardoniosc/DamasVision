import { CameraError, CameraErrorCode } from './camera.models';

const MESSAGES: Readonly<Record<CameraErrorCode, string>> = {
  PERMISSION_DENIED:
    'Acesso à câmera negado. Permita o uso da câmera nas configurações do navegador e tente novamente.',
  NO_DEVICE: 'Nenhuma câmera disponível. Conecte uma câmera e atualize a lista.',
  DEVICE_BUSY: 'A câmera está em uso por outro aplicativo ou não pôde ser iniciada.',
  UNSUPPORTED: 'Este navegador não oferece acesso à câmera. Use um navegador atualizado.',
  UNKNOWN: 'Não foi possível acessar a câmera.',
};

/** `getUserMedia` / `enumerateDevices` error names → spec error codes. Includes legacy Chrome names. */
const CODE_BY_ERROR_NAME: Readonly<Record<string, CameraErrorCode>> = {
  NotAllowedError: 'PERMISSION_DENIED',
  PermissionDeniedError: 'PERMISSION_DENIED',
  SecurityError: 'PERMISSION_DENIED',
  NotFoundError: 'NO_DEVICE',
  DevicesNotFoundError: 'NO_DEVICE',
  OverconstrainedError: 'NO_DEVICE',
  ConstraintNotSatisfiedError: 'NO_DEVICE',
  NotReadableError: 'DEVICE_BUSY',
  TrackStartError: 'DEVICE_BUSY',
  AbortError: 'DEVICE_BUSY',
};

export function cameraError(code: CameraErrorCode, message: string = MESSAGES[code]): CameraError {
  return { code, message };
}

export function mapCameraError(error: unknown): CameraError {
  const name =
    typeof error === 'object' && error !== null && 'name' in error && typeof error.name === 'string'
      ? error.name
      : '';
  return cameraError(CODE_BY_ERROR_NAME[name] ?? 'UNKNOWN');
}

export function unsupportedCameraError(isSecureContext: boolean): CameraError {
  return isSecureContext
    ? cameraError('UNSUPPORTED')
    : cameraError(
        'UNSUPPORTED',
        'O acesso à câmera exige uma conexão segura. Abra o aplicativo via HTTPS ou localhost.',
      );
}

export function cameraDisconnectedError(): CameraError {
  return cameraError('NO_DEVICE', 'A câmera foi desconectada ou interrompida.');
}
