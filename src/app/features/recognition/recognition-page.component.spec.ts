import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { GameSessionController } from '../../core/app-state/game-session.controller';
import { FakeFrameSource } from '../../../../tests/fixtures/fake-frames';
import { FakeMediaDevices } from '../../../../tests/fixtures/fake-media-devices';
import { FakeVisionWorker, happyPathReply } from '../../../../tests/fixtures/fake-vision-worker';
import { InMemoryCalibrationRepository } from '../../../../tests/fixtures/in-memory-calibration-repository';
import { recognitionResultFrom } from '../../../../tests/fixtures/recognition-results';
import { startingPosition } from '../../../../tests/fixtures/synthetic-board';
import { CAMERA_ENVIRONMENT } from '../../core/camera/camera.config';
import { FRAME_SOURCE_FACTORY } from '../../core/frame-capture/frame-capture.config';
import { CALIBRATION_REPOSITORY } from '../../core/persistence/calibration.repository';
import { VISION_WORKER_FACTORY } from '../../core/workers/vision-worker.client';
import { defaultCorners } from '../../domain/board/calibration';
import { ObservedPiece } from '../../domain/board/piece';
import { RecognitionPageComponent } from './recognition-page.component';

describe('RecognitionPageComponent (E3-T08)', () => {
  let devices: FakeMediaDevices;
  let repository: InMemoryCalibrationRepository;
  let workers: FakeVisionWorker[];

  beforeEach(() => {
    devices = new FakeMediaDevices();
    repository = new InMemoryCalibrationRepository();
    workers = [];
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    const cells: ObservedPiece[] = startingPosition();
    cells[17] = 'UNKNOWN';
    TestBed.configureTestingModule({
      imports: [RecognitionPageComponent],
      providers: [
        provideRouter([]),
        {
          provide: CAMERA_ENVIRONMENT,
          useValue: { mediaDevices: devices.asMediaDevices(), isSecureContext: true },
        },
        { provide: CALIBRATION_REPOSITORY, useValue: repository },
        { provide: FRAME_SOURCE_FACTORY, useValue: () => new FakeFrameSource() },
        {
          provide: VISION_WORKER_FACTORY,
          useValue: () => {
            const worker = new FakeVisionWorker();
            worker.autoReply = (message) =>
              message.type === 'PROCESS_FRAME'
                ? {
                    type: 'RECOGNITION_RESULT',
                    frameId: message.frameId,
                    result: recognitionResultFrom(cells),
                  }
                : happyPathReply(message);
            workers.push(worker);
            return worker;
          },
        },
      ],
    });
  });

  afterEach(() => vi.restoreAllMocks());

  function saveProfile(): void {
    repository.profiles.set('p', {
      id: 'p',
      name: 'Mesa',
      sourceWidth: 640,
      sourceHeight: 480,
      corners: defaultCorners({ width: 640, height: 480 }),
      normalizedWidth: 800,
      normalizedHeight: 800,
      orientation: 'NORMAL',
      createdAt: '2026-11-19T00:00:00.000Z',
      updatedAt: '2026-11-19T00:00:00.000Z',
      isActive: true,
    });
  }

  async function stable(fixture: ComponentFixture<unknown>): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await fixture.whenStable();
  }

  async function render() {
    const fixture = TestBed.createComponent(RecognitionPageComponent);
    const element = fixture.nativeElement as HTMLElement;
    const button = (text: string) =>
      Array.from(element.querySelectorAll('button')).find((b) => b.textContent?.trim() === text);
    const square = (index: number) =>
      element.querySelector<HTMLButtonElement>(`[data-square="${index}"]`);
    const text = (testId: string) =>
      element.querySelector(`[data-testid="${testId}"]`)?.textContent?.trim();
    await stable(fixture);
    return { fixture, element, button, square, text, stable: () => stable(fixture) };
  }

  it('sends the user to calibration when there is no saved calibration', async () => {
    const { element } = await render();

    expect(element.querySelector('a[href="/calibration"]')?.textContent).toContain(
      'Ir para a calibração',
    );
  });

  it('shows the live reading, its uncertainty and the overlay', async () => {
    saveProfile();
    const { element, square, text, stable } = await render();
    await vi.waitFor(
      async () => {
        await stable();
        expect(square(1)?.getAttribute('data-piece')).toBe('BLACK');
      },
      { timeout: 3000 },
    );
    expect(square(17)?.getAttribute('data-piece')).toBe('UNKNOWN');

    expect(text('recognition-status')).toBe('Leitura com incertezas');
    expect(text('unknown-count')).toBe('1');
    expect(text('piece-counts')).toBe('12 brancas · 11 pretas');
    expect(
      element.querySelectorAll('[data-testid="recognition-overlay"] circle').length,
    ).toBeGreaterThanOrEqual(32);
    expect(square(17)?.disabled).toBe(true);
  });

  it('corrects an UNKNOWN square through the palette and confirms the position', async () => {
    saveProfile();
    const { button, square, text, stable } = await render();
    await vi.waitFor(
      async () => {
        await stable();
        expect(square(1)?.getAttribute('data-piece')).toBe('BLACK');
      },
      { timeout: 3000 },
    );

    button('Pausar e corrigir')?.click();
    await stable();
    expect(button('Confirmar posição')?.disabled).toBe(true);

    square(17)?.click();
    await stable();
    button('Preta')?.click();
    await stable();

    expect(square(17)?.getAttribute('data-piece')).toBe('BLACK');
    expect(text('correction-metrics')).toContain('31 de 32 casas corretas (97%) · 1 corrigida(s)');
    button('Confirmar posição')?.click();
    await stable();

    expect(text('confirmed')).toContain('12 brancas e 12 pretas');
  });

  it('diagnostic mode asks the worker for debug output and shows the diagnostic panel', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    saveProfile();
    const { element, stable } = await render();
    await vi.waitFor(async () => {
      await stable();
      expect(element.querySelector('[data-testid="debug-toggle"]')).not.toBeNull();
    });
    expect(element.querySelector('[data-testid="recognition-debug"]')).toBeNull();

    const toggle = element.querySelector<HTMLInputElement>('[data-testid="debug-toggle"]');
    toggle?.click();
    await stable();

    expect(element.querySelector('[data-testid="recognition-debug"]')).not.toBeNull();
    const sentBefore = workers[0]?.sent('PROCESS_FRAME').length ?? 0;
    await vi.waitFor(async () => {
      await stable();
      const messages = workers[0]?.sent('PROCESS_FRAME') ?? [];
      expect(messages.length).toBeGreaterThan(sentBefore);
      expect(messages.at(-1)).toMatchObject({ debug: true });
    });

    toggle?.click();
    await stable();
    expect(element.querySelector('[data-testid="recognition-debug"]')).toBeNull();
  });

  it('starts a game from the confirmed position (E6-T02)', async () => {
    saveProfile();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const { element, button, square, stable } = await render();
    await vi.waitFor(
      async () => {
        await stable();
        expect(square(1)?.getAttribute('data-piece')).toBe('BLACK');
      },
      { timeout: 3000 },
    );
    button('Pausar e corrigir')?.click();
    await stable();
    square(17)?.click();
    await stable();
    button('Preta')?.click();
    await stable();
    button('Confirmar posição')?.click();
    await stable();

    const white = element.querySelector<HTMLInputElement>('[data-testid="white-label"]');
    if (!white) throw new Error('no label input');
    white.value = 'Ana';
    white.dispatchEvent(new Event('input'));
    button('Iniciar partida')?.click();
    await vi.waitFor(() => expect(navigate).toHaveBeenCalled());

    const session = TestBed.inject(GameSessionController).session();
    expect(session).toMatchObject({
      whitePlayerLabel: 'Ana',
      blackPlayerLabel: 'Pretas',
      currentPlayer: 'WHITE',
    });
    expect(navigate).toHaveBeenCalledWith(['/game', session?.id]);
  });

  it('releases the camera and terminates the worker when leaving', async () => {
    saveProfile();
    const { fixture, stable } = await render();
    await vi.waitFor(async () => {
      await stable();
      expect(workers[0]?.sent('PROCESS_FRAME').length ?? 0).toBeGreaterThan(0);
    });

    fixture.destroy();

    expect(devices.liveTracks()).toEqual([]);
    expect(workers[0]?.terminated).toBe(true);
  });
});
