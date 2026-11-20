/**
 * Which recognizer answers the vision-worker protocol (G3.1, ADR-042):
 * - `browser` (default): OpenCV.js in a Web Worker; works offline and on any device;
 * - `local-service`: the optional Python + OpenCV service on this machine
 *   (`vision-service/`), reached over HTTP on the loopback interface only.
 *
 * Both implement the same protocol and return the same contract, so nothing above
 * `core/workers` depends on the choice. The choice is explicit: the app never switches
 * silently when the service is down.
 */
export type VisionProviderKind = 'browser' | 'local-service';

export interface VisionProviderSettings {
  readonly kind: VisionProviderKind;
  /** Base URL of the local service, e.g. `http://127.0.0.1:8765`. */
  readonly serviceUrl: string;
}

/** Transport tuning for the local service (central values; see the G3.1 design §2–§5). */
export interface RemoteVisionTuning {
  /** JPEG quality of the frames sent (0..1). */
  readonly jpegQuality: number;
  readonly healthTimeoutMs: number;
  /** Frames, calibration and rectification. Below the client's own request timeout. */
  readonly requestTimeoutMs: number;
  /** The automatic corner adjustment runs ~1 s on the service. */
  readonly refineTimeoutMs: number;
  /**
   * Consecutive frames the service fails to answer before recognition stops with an
   * explicit message (≈ 1 s at the 200 ms interval). Isolated failures are dropped frames.
   */
  readonly maxConsecutiveFailures: number;
  /**
   * After DISPOSE the remote worker closes its service session, then itself; it is
   * terminated anyway after this delay.
   */
  readonly disposeGraceMs: number;
}

export const DEFAULT_SERVICE_URL = 'http://127.0.0.1:8765';

export const DEFAULT_VISION_PROVIDER: VisionProviderSettings = {
  kind: 'browser',
  serviceUrl: DEFAULT_SERVICE_URL,
};

export const DEFAULT_REMOTE_VISION_TUNING: RemoteVisionTuning = {
  jpegQuality: 0.9,
  healthTimeoutMs: 3000,
  requestTimeoutMs: 5000,
  refineTimeoutMs: 14_000,
  maxConsecutiveFailures: 5,
  disposeGraceMs: 1000,
};

/** The contract version this app speaks (`BoardRecognitionResult` v1). */
export const VISION_CONTRACT_VERSION = 1;

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Normalizes a service URL, accepting only http(s) on the loopback interface: frames
 * must never leave this machine (no cloud, ADR-042). Returns null when not acceptable.
 */
export function normalizeServiceUrl(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol) || !LOOPBACK_HOSTS.has(url.hostname)) {
    return null;
  }
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    return null;
  }
  return url.origin;
}

export function isVisionProviderSettings(value: unknown): value is VisionProviderSettings {
  if (typeof value !== 'object' || value === null) return false;
  const settings = value as Record<string, unknown>;
  return (
    (settings['kind'] === 'browser' || settings['kind'] === 'local-service') &&
    typeof settings['serviceUrl'] === 'string' &&
    normalizeServiceUrl(settings['serviceUrl']) !== null
  );
}

/** First message to the remote worker, before `INIT`: where the service is. */
export interface RemoteVisionConfigMessage {
  readonly type: 'REMOTE_CONFIG';
  readonly serviceUrl: string;
  readonly tuning: RemoteVisionTuning;
}

export function isRemoteVisionConfigMessage(value: unknown): value is RemoteVisionConfigMessage {
  if (typeof value !== 'object' || value === null) return false;
  const message = value as Record<string, unknown>;
  const tuning = message['tuning'] as Record<string, unknown> | undefined;
  return (
    message['type'] === 'REMOTE_CONFIG' &&
    typeof message['serviceUrl'] === 'string' &&
    normalizeServiceUrl(message['serviceUrl']) !== null &&
    typeof tuning === 'object' &&
    tuning !== null &&
    ['jpegQuality', 'healthTimeoutMs', 'requestTimeoutMs', 'refineTimeoutMs'].every(
      (key) => typeof tuning[key] === 'number' && Number.isFinite(tuning[key]),
    )
  );
}
