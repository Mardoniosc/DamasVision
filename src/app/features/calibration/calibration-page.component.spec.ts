import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { FakeFrameSource } from '../../../../tests/fixtures/fake-frames';
import { FakeMediaDevices } from '../../../../tests/fixtures/fake-media-devices';
import { FakeVisionWorker, happyPathReply } from '../../../../tests/fixtures/fake-vision-worker';
import { InMemoryCalibrationRepository } from '../../../../tests/fixtures/in-memory-calibration-repository';
import { CAMERA_ENVIRONMENT } from '../../core/camera/camera.config';
import { FRAME_SOURCE_FACTORY } from '../../core/frame-capture/frame-capture.config';
import { CALIBRATION_REPOSITORY } from '../../core/persistence/calibration.repository';
import { VISION_WORKER_FACTORY } from '../../core/workers/vision-worker.client';
import { CalibrationPageComponent } from './calibration-page.component';
import { CalibrationStore } from './calibration.store';

describe('CalibrationPageComponent (E2)', () => {
  let devices: FakeMediaDevices;
  let repository: InMemoryCalibrationRepository;
  let workers: FakeVisionWorker[];

  beforeEach(() => {
    devices = new FakeMediaDevices();
    repository = new InMemoryCalibrationRepository();
    workers = [];
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    // jsdom has no canvas implementation.
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    TestBed.configureTestingModule({
      imports: [CalibrationPageComponent],
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
            worker.autoReply = happyPathReply;
            workers.push(worker);
            return worker;
          },
        },
      ],
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function stable(fixture: ComponentFixture<unknown>): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await fixture.whenStable();
  }

  /** Renders the page and simulates the camera video reporting a 640×480 size. */
  async function render() {
    const fixture = TestBed.createComponent(CalibrationPageComponent);
    await stable(fixture);
    const element = fixture.nativeElement as HTMLElement;
    const video = element.querySelector('video');
    if (!video) throw new Error('video not rendered');
    Object.defineProperty(video, 'videoWidth', { value: 640 });
    Object.defineProperty(video, 'videoHeight', { value: 480 });
    video.dispatchEvent(new Event('loadedmetadata'));
    await stable(fixture);
    const button = (text: string): HTMLButtonElement | undefined =>
      Array.from(element.querySelectorAll('button')).find((b) => b.textContent?.trim() === text);
    const handle = (corner: string): SVGCircleElement | null =>
      element.querySelector(`[data-corner="${corner}"]`);
    const store = fixture.debugElement.injector.get(CalibrationStore);
    return { fixture, element, button, handle, store, stable: () => stable(fixture) };
  }

  it('opens the camera and shows four handles over a valid default calibration', async () => {
    const { element, handle } = await render();

    expect(devices.liveTracks()).toHaveLength(1);
    expect(element.querySelectorAll('[data-corner]')).toHaveLength(4);
    expect(handle('topLeft')?.getAttribute('aria-label')).toContain('Canto superior esquerdo');
    expect(element.querySelector('[data-testid="calibration-validity"]')?.textContent?.trim()).toBe(
      'Calibração válida',
    );
  });

  it('draws the projected grid with the 32 playable squares and side labels', async () => {
    const { element } = await render();
    const overlay = element.querySelector('[data-testid="corner-overlay"]');

    expect(overlay?.querySelectorAll('line')).toHaveLength(18);
    expect(overlay?.textContent).toContain('Brancas');
    // 32 playable markers + 4 handles.
    expect(overlay?.querySelectorAll('circle')).toHaveLength(36);
  });

  it('moves a handle with the arrow keys (Shift for bigger steps)', async () => {
    const { handle, store, stable } = await render();
    const before = store.corners()?.topLeft;

    handle('topLeft')?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
    );
    handle('topLeft')?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', shiftKey: true, bubbles: true }),
    );
    await stable();

    expect(store.corners()?.topLeft).toEqual({ x: (before?.x ?? 0) + 1, y: (before?.y ?? 0) + 10 });
    expect(handle('topLeft')?.getAttribute('aria-label')).toContain(
      `x ${Math.round((before?.x ?? 0) + 1)}`,
    );
  });

  it('explains why a calibration is invalid and disables saving', async () => {
    const { element, store, button, stable } = await render();

    store.moveCorner('topLeft', store.corners()?.bottomRight ?? { x: 0, y: 0 });
    await stable();

    expect(element.querySelector('[data-testid="calibration-validity"]')?.textContent?.trim()).toBe(
      'Calibração inválida',
    );
    expect(element.querySelector('[data-testid="calibration-issues"]')?.textContent).toContain(
      'muito próximos',
    );
    expect(button('Salvar calibração')?.disabled).toBe(true);
    expect(button('Gerar imagem normalizada')?.disabled).toBe(true);
  });

  it('rotates the canonical orientation', async () => {
    const { element, button, stable } = await render();

    button('Girar 90°')?.click();
    await stable();

    expect(element.querySelector('[data-testid="orientation"]')?.textContent).toBe('90°');
  });

  it('generates the normalized board preview through the vision worker', async () => {
    const { element, button, stable } = await render();

    button('Gerar imagem normalizada')?.click();
    await vi.waitFor(async () => {
      await stable();
      expect(element.querySelector('[data-testid="normalized-preview"]')).not.toBeNull();
    });

    expect(
      element.querySelector('[data-testid="normalized-preview"] canvas')?.getAttribute('role'),
    ).toBe('img');
    expect(workers[0]?.sent('RECTIFY_FRAME')).toHaveLength(1);
  });

  it('saves the calibration and shows it as active', async () => {
    const { element, button, stable } = await render();

    button('Salvar calibração')?.click();
    await vi.waitFor(async () => {
      await stable();
      expect(element.querySelector('[data-testid="save-status"]')).not.toBeNull();
    });

    expect(repository.profiles.size).toBe(1);
    expect(element.textContent).toContain('Calibração ativa: Calibração de');
  });

  it('releases the camera and terminates the vision worker when leaving', async () => {
    const { fixture } = await render();
    await vi.waitFor(() => expect(workers).toHaveLength(1));

    fixture.destroy();

    expect(devices.liveTracks()).toEqual([]);
    expect(workers[0]?.terminated).toBe(true);
  });
});
