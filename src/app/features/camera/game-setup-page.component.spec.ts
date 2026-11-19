import { TestBed } from '@angular/core/testing';
import { FakeFrameSource } from '../../../../tests/fixtures/fake-frames';
import { FakeMediaDevices } from '../../../../tests/fixtures/fake-media-devices';
import { CAMERA_ENVIRONMENT, CameraEnvironment } from '../../core/camera/camera.config';
import { FRAME_SOURCE_FACTORY } from '../../core/frame-capture/frame-capture.config';
import { GameSetupPageComponent } from './game-setup-page.component';

describe('GameSetupPageComponent (E1-T03)', () => {
  let devices: FakeMediaDevices;
  let sources: FakeFrameSource[];

  beforeEach(() => {
    devices = new FakeMediaDevices();
    sources = [];
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function render(environment?: CameraEnvironment) {
    TestBed.configureTestingModule({
      imports: [GameSetupPageComponent],
      providers: [
        {
          provide: CAMERA_ENVIRONMENT,
          useValue: environment ?? {
            mediaDevices: devices.asMediaDevices(),
            isSecureContext: true,
          },
        },
        {
          provide: FRAME_SOURCE_FACTORY,
          useValue: () => {
            const source = new FakeFrameSource();
            sources.push(source);
            return source;
          },
        },
      ],
    });
    const fixture = TestBed.createComponent(GameSetupPageComponent);
    const element = fixture.nativeElement as HTMLElement;
    const stable = async (): Promise<void> => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await fixture.whenStable();
    };
    const button = (text: string): HTMLButtonElement | undefined =>
      Array.from(element.querySelectorAll('button')).find((b) => b.textContent?.trim() === text);
    await stable();
    return { fixture, element, stable, button };
  }

  function statusText(element: HTMLElement): string | undefined {
    return element.querySelector('[role="status"]')?.textContent?.trim();
  }

  it('starts in IDLE with hidden device names and a disabled device selector', async () => {
    const { element, button } = await render();

    expect(statusText(element)).toBe('Câmera desligada');
    expect(element.textContent).toContain('Os nomes das câmeras aparecem depois');
    expect(element.querySelector('select')?.disabled).toBe(true);
    expect(button('Ativar câmera')?.disabled).toBe(false);
    expect(element.querySelector('video')).toBeNull();
  });

  it('activates the camera, shows the preview and lists devices', async () => {
    const { element, stable, button } = await render();

    button('Ativar câmera')?.click();
    await stable();

    expect(statusText(element)).toBe('Transmitindo');
    expect(element.querySelector('video')?.srcObject).toBe(devices.lastStream.asMediaStream());
    const options = Array.from(element.querySelectorAll('option')).map((o) =>
      o.textContent?.trim(),
    );
    expect(options).toEqual(['Front Camera', 'Rear Camera']);
    expect(button('Desligar câmera')).toBeDefined();
  });

  it('switches device from the selector', async () => {
    const { element, stable, button } = await render();
    button('Ativar câmera')?.click();
    await stable();

    const select = element.querySelector('select');
    if (!select) throw new Error('select not rendered');
    select.value = 'cam-rear';
    select.dispatchEvent(new Event('change'));
    await stable();

    expect(devices.liveTracks().map((t) => t.device.deviceId)).toEqual(['cam-rear']);
    expect(statusText(element)).toBe('Transmitindo');
  });

  it('shows an explicit message when permission is denied', async () => {
    devices.failNextWith('NotAllowedError');
    const { element, stable, button } = await render();

    button('Ativar câmera')?.click();
    await stable();

    expect(statusText(element)).toBe('Erro');
    expect(element.querySelector('[role="alert"]')?.textContent).toContain(
      'Acesso à câmera negado',
    );
    expect(button('Tentar novamente')).toBeDefined();
  });

  it('explains when the browser does not support the camera', async () => {
    const { element, button } = await render({ mediaDevices: null, isSecureContext: false });

    expect(element.querySelector('[role="alert"]')?.textContent).toContain('HTTPS');
    expect(button('Tentar novamente')?.disabled).toBe(true);
  });

  it('runs, pauses and stops the capture diagnostics', async () => {
    const { element, stable, button } = await render();
    expect(button('Iniciar captura')?.disabled).toBe(true);

    button('Ativar câmera')?.click();
    await stable();
    button('Iniciar captura')?.click();
    await stable();

    const captureState = (): string | undefined =>
      element.querySelector('[data-testid="capture-state"]')?.textContent?.trim();
    expect(captureState()).toBe('Em execução');
    expect(
      Number(element.querySelector('[data-testid="frames-processed"]')?.textContent),
    ).toBeGreaterThan(0);

    button('Pausar')?.click();
    await stable();
    expect(captureState()).toBe('Pausada');

    button('Parar captura')?.click();
    await stable();
    expect(captureState()).toBe('Parada');
    expect(sources[0]?.disposed).toBe(true);
  });

  it('turning the camera off also stops the capture', async () => {
    const { element, stable, button } = await render();
    button('Ativar câmera')?.click();
    await stable();
    button('Iniciar captura')?.click();
    await stable();

    button('Desligar câmera')?.click();
    await stable();

    expect(statusText(element)).toBe('Câmera disponível');
    expect(devices.liveTracks()).toEqual([]);
    expect(sources[0]?.disposed).toBe(true);
  });

  it('releases the camera and capture when leaving the page (no leaked streams)', async () => {
    const { fixture, stable, button } = await render();
    button('Ativar câmera')?.click();
    await stable();
    button('Iniciar captura')?.click();
    await stable();

    fixture.destroy();

    expect(devices.liveTracks()).toEqual([]);
    expect(sources[0]?.disposed).toBe(true);
  });
});
