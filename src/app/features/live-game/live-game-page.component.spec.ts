import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { FakeFrameSource } from '../../../../tests/fixtures/fake-frames';
import { FakeMediaDevices } from '../../../../tests/fixtures/fake-media-devices';
import { FakeVisionWorker, happyPathReply } from '../../../../tests/fixtures/fake-vision-worker';
import { InMemoryCalibrationRepository } from '../../../../tests/fixtures/in-memory-calibration-repository';
import { recognitionResultFrom } from '../../../../tests/fixtures/recognition-results';
import { GameSessionController } from '../../core/app-state/game-session.controller';
import { CAMERA_ENVIRONMENT } from '../../core/camera/camera.config';
import { FRAME_SOURCE_FACTORY } from '../../core/frame-capture/frame-capture.config';
import { CALIBRATION_REPOSITORY } from '../../core/persistence/calibration.repository';
import { VISION_WORKER_FACTORY } from '../../core/workers/vision-worker.client';
import { defaultCorners } from '../../domain/board/calibration';
import { BoardState, ObservedPiece } from '../../domain/board/piece';
import { initialBoard } from '../../domain/engine/board-state';
import { BrazilianCheckersEngine } from '../../domain/engine/checkers-engine';
import { LiveGamePageComponent } from './live-game-page.component';

/**
 * Gate G6 — the live game end to end with deterministic observations: the fake camera
 * worker returns the board the test sets (as the physical board would look), through the
 * real chain: frame scheduler → recognition stabilizer (G3) → move tracker (E5) →
 * game-session controller → screen.
 */
describe('LiveGamePageComponent (E6-T04/T05)', () => {
  const engine = new BrazilianCheckersEngine();
  let devices: FakeMediaDevices;
  let workers: FakeVisionWorker[];
  /** What the camera sees now. */
  let seen: ObservedPiece[];

  beforeEach(() => {
    devices = new FakeMediaDevices();
    workers = [];
    seen = [...initialBoard().cells];
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    const repository = new InMemoryCalibrationRepository();
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
    TestBed.configureTestingModule({
      imports: [LiveGamePageComponent],
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
                    result: recognitionResultFrom([...seen], { timestamp: Date.now() }),
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

  async function open(board: BoardState = initialBoard()) {
    const controller = TestBed.inject(GameSessionController);
    const session = await controller.startGame({
      cells: board.cells,
      whitePlayerLabel: 'Ana',
      blackPlayerLabel: 'Bruno',
    });
    seen = [...board.cells];
    const fixture = TestBed.createComponent(LiveGamePageComponent);
    fixture.componentRef.setInput('id', session.id);
    const element = fixture.nativeElement as HTMLElement;
    const text = (testId: string) =>
      element.querySelector(`[data-testid="${testId}"]`)?.textContent?.replace(/\s+/g, ' ').trim();
    const settle = async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await fixture.whenStable();
    };
    const until = (check: () => void) =>
      vi.waitFor(
        async () => {
          await settle();
          check();
        },
        { timeout: 6000, interval: 50 },
      );
    await settle();
    return { controller, fixture, element, text, settle, until };
  }

  /** The players make a move on the physical board. */
  function play(board: BoardState, player: 'WHITE' | 'BLACK', id: string): BoardState {
    const move = engine.getLegalMoves(board, player).find((m) => m.id === id);
    if (!move) throw new Error(`${id} is not legal`);
    const next = engine.applyMove(board, move);
    seen = [...next.cells];
    return next;
  }

  it('follows a game from the camera: moves are inferred, committed and shown', async () => {
    const { text, until } = await open();
    await until(() => expect(text('game-phase')).toBe('Acompanhando o tabuleiro'));
    expect(text('to-move')).toBe('Brancas (Ana)');

    const one = play(initialBoard(), 'WHITE', 'c3-d4');
    await until(() => expect(text('last-move')).toBe('Brancas: c3-d4'));
    expect(text('to-move')).toBe('Pretas (Bruno)');

    play(one, 'BLACK', 'f6-e5');
    await until(() => expect(text('move-history')).toContain('f6-e5'));
    expect(text('move-history')).toContain('c3-d4');
  }, 20_000);

  it('an illegal physical move is reported and can be resolved by registering the move by hand', async () => {
    const { controller, element, text, until } = await open();
    await until(() => expect(text('game-phase')).toBe('Acompanhando o tabuleiro'));

    // c3 jumps to e5 without a capture: not a legal outcome.
    seen[42] = 'EMPTY';
    seen[28] = 'WHITE';
    await until(() =>
      expect(element.querySelector('[data-testid="pending-decision"]')).not.toBeNull(),
    );
    expect(text('pending-decision')).toContain('não corresponde a nenhum lance legal');
    expect(controller.session()?.moves).toHaveLength(0);

    // The players put the board back and register c3-d4 by hand.
    seen = [...initialBoard().cells];
    element.querySelector<HTMLButtonElement>('[data-move="c3-d4"]')?.click();
    await until(() => expect(text('last-move')).toBe('Brancas: c3-d4'));
    expect(text('move-history')).toContain('manual');
  }, 20_000);

  it('pause, undo and end of game', async () => {
    const { controller, element, text, until } = await open();
    await until(() => expect(text('game-phase')).toBe('Acompanhando o tabuleiro'));
    const button = (label: string) =>
      Array.from(element.querySelectorAll('button')).find((b) => b.textContent?.trim() === label);

    button('Pausar')?.click();
    await until(() => expect(text('game-phase')).toBe('Partida pausada'));
    play(initialBoard(), 'WHITE', 'c3-d4');
    await new Promise((resolve) => setTimeout(resolve, 1200));
    expect(controller.session()?.moves).toHaveLength(0);

    button('Retomar')?.click();
    await until(() => expect(text('last-move')).toBe('Brancas: c3-d4'));

    button('Desfazer último lance')?.click();
    await until(() => expect(text('last-move')).toBe('—'));

    button('Encerrar partida')?.click();
    await until(() => expect(element.querySelector('[data-testid="end-options"]')).not.toBeNull());
    button('Empate por acordo')?.click();
    await until(() => expect(text('game-result')).toBe('Empate (acordo entre os jogadores).'));
  }, 20_000);

  it('corrects the official position explicitly, and records it', async () => {
    const { controller, element, until } = await open();
    await until(() =>
      expect(element.querySelector('[data-testid="position-correction"]')).not.toBeNull(),
    );
    const button = (label: string) =>
      Array.from(element.querySelectorAll('button')).find((b) => b.textContent?.trim() === label);

    button('Partir da posição oficial')?.click();
    await until(() => expect(button('Confirmar nova posição')).toBeDefined());
    // Remove the black man on b6 (index 17), then confirm.
    element
      .querySelector<HTMLButtonElement>('[data-testid="position-correction"] [data-square="17"]')
      ?.click();
    await until(() => expect(button('Vazia')).toBeDefined());
    button('Vazia')?.click();
    await until(() => expect(button('Confirmar nova posição')?.disabled).toBe(false));
    button('Confirmar nova posição')?.click();

    await until(() => expect(controller.session()?.board.cells[17]).toBe('EMPTY'));
    expect(controller.session()?.adjustments.map((a) => a.kind)).toEqual(['POSITION_CORRECTION']);
  });

  it('shows "not found" for an unknown game and does not open the camera', async () => {
    const fixture = TestBed.createComponent(LiveGamePageComponent);
    fixture.componentRef.setInput('id', 'missing');
    await vi.waitFor(async () => {
      await fixture.whenStable();
      expect((fixture.nativeElement as HTMLElement).textContent).toContain(
        'Partida não encontrada',
      );
    });
    expect(devices.liveTracks()).toEqual([]);
  });

  it('releases the camera when leaving', async () => {
    const { fixture, text, until } = await open();
    await until(() => expect(text('game-phase')).toBe('Acompanhando o tabuleiro'));

    fixture.destroy();

    expect(devices.liveTracks()).toEqual([]);
    expect(workers[0]?.terminated).toBe(true);
  });
});
