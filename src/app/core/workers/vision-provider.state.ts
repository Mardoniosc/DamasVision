import { Injectable, InjectionToken, signal } from '@angular/core';
import {
  DEFAULT_REMOTE_VISION_TUNING,
  DEFAULT_VISION_PROVIDER,
  RemoteVisionTuning,
  VisionProviderSettings,
} from './vision-provider';

export const REMOTE_VISION_TUNING = new InjectionToken<RemoteVisionTuning>('REMOTE_VISION_TUNING', {
  providedIn: 'root',
  factory: () => DEFAULT_REMOTE_VISION_TUNING,
});

/**
 * The recognizer in use (G3.1). The worker factory reads it when a page creates its vision
 * worker, so a change applies to the next camera page. Loaded from and saved to the
 * settings by `VisionProviderService` (core/app-state).
 */
@Injectable({ providedIn: 'root' })
export class VisionProviderState {
  private readonly settingsState = signal<VisionProviderSettings>(DEFAULT_VISION_PROVIDER);
  readonly settings = this.settingsState.asReadonly();
  private loading: Promise<void> | null = null;

  /**
   * Records the pending read of the stored choice. It does not block the app start (the
   * first page must render at once); only a vision worker waits for it (`pendingLoad`).
   */
  trackLoad(loading: Promise<void>): void {
    const tracked = loading
      .catch(() => undefined)
      .finally(() => {
        if (this.loading === tracked) this.loading = null;
      });
    this.loading = tracked;
  }

  /** The pending read of the stored choice, or null when it is known. */
  pendingLoad(): Promise<void> | null {
    return this.loading;
  }

  set(settings: VisionProviderSettings): void {
    this.settingsState.set(settings);
  }

  usesService(): boolean {
    return this.settingsState().kind === 'local-service';
  }
}
