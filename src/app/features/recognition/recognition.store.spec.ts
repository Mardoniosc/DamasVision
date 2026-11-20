import { TestBed } from '@angular/core/testing';
import { FakeFrameSource } from '../../../../tests/fixtures/fake-frames';
import { FakeMediaDevices } from '../../../../tests/fixtures/fake-media-devices';
import { FakeVisionWorker, happyPathReply } from '../../../../tests/fixtures/fake-vision-worker';
import { InMemoryCalibrationRepository } from '../../../../tests/fixtures/in-memory-calibration-repository';
import { recognitionResultFrom } from '../../../../tests/fixtures/recognition-results';
import { startingPosition } from '../../../../tests/fixtures/synthetic-board';
import { CAMERA_ENVIRONMENT } from '../../core/camera/camera.config';
import { FRAME_SOURCE_FACTORY } from '../../core/frame-capture/frame-capture.config';
import { FrameCaptureService } from '../../core/frame-capture/frame-capture.service';
import { CALIBRATION_REPOSITORY } from '../../core/persistence/calibration.repository';
import { PersistedCalibration } from '../../core/persistence/persistence.models';
import { VisionProviderState } from '../../core/workers/vision-provider.state';
import { VISION_WORKER_FACTORY, VisionWorkerClient } from '../../core/workers/vision-worker.client';
import {
  VisionWorkerRequest,
  VisionWorkerResponse,
} from '../../core/workers/vision-worker.protocol';
import { canonicalCorners, scaleCorners } from '../../domain/board/calibration';
import { ObservedPiece } from '../../domain/board/piece';
import { isLabeledSample } from './labeled-sample';
import { RecognitionStore } from './recognition.store';

const PROFILE: PersistedCalibration = {
  id: 'p1',
  name: 'Mesa',
  cameraDeviceId: 'cam-rear',
  sourceWidth: 1280,
  sourceHeight: 960,
  corners: {
    topLeft: { x: 300, y: 120 },
    topRight: { x: 980, y: 130 },
    bottomRight: { x: 1000, y: 820 },
    bottomLeft: { x: 280, y: 800 },
  },
  normalizedWidth: 800,
  normalizedHeight: 800,
  orientation: 'ROTATED_180',
  createdAt: '2026-11-19T10:00:00.000Z',
  updatedAt: '2026-11-19T10:00:00.000Z',
  isActive: true,
};

/** Recognized board: the starting position with two squares the reader is unsure about. */
function readCells(): ObservedPiece[] {
  const cells: ObservedPiece[] = startingPosition();
  cells[17] = 'UNKNOWN';
  cells[44] = 'BLACK'; // misread: the starting position has a white man on 44
  return cells;
}

describe('RecognitionStore', () => {
  let repository: InMemoryCalibrationRepository;
  let devices: FakeMediaDevices;
  let workers: FakeVisionWorker[];
  let reply: (message: VisionWorkerRequest) => VisionWorkerResponse | null;

  beforeEach(() => {
    repository = new InMemoryCalibrationRepository();
    devices = new FakeMediaDevices();
    workers = [];
    reply = (message) =>
      message.type === 'PROCESS_FRAME'
        ? {
            type: 'RECOGNITION_RESULT',
            frameId: message.frameId,
            result: recognitionResultFrom(readCells()),
          }
        : happyPathReply(message);
    TestBed.configureTestingModule({
      providers: [
        RecognitionStore,
        VisionWorkerClient,
        { provide: CALIBRATION_REPOSITORY, useValue: repository },
        {
          provide: CAMERA_ENVIRONMENT,
          useValue: { mediaDevices: devices.asMediaDevices(), isSecureContext: true },
        },
        { provide: FRAME_SOURCE_FACTORY, useValue: () => new FakeFrameSource() },
        {
          provide: VISION_WORKER_FACTORY,
          useValue: () => {
            const worker = new FakeVisionWorker();
            worker.autoReply = (message) => reply(message);
            workers.push(worker);
            return worker;
          },
        },
      ],
    });
  });

  afterEach(() => TestBed.resetTestingModule());

  const store = () => TestBed.inject(RecognitionStore);

  async function startRecognizing(): Promise<RecognitionStore> {
    repository.profiles.set(PROFILE.id, PROFILE);
    await store().start();
    // The board shows the temporally consolidated reading: ≥ 3 agreeing frames (200 ms apart).
    await vi.waitFor(() => expect(store().latest()?.board.cells[1]).toBe('BLACK'), {
      timeout: 3000,
    });
    return store();
  }

  it('asks for a calibration when none is saved', async () => {
    await store().start();

    expect(store().phase()).toBe('NO_CALIBRATION');
    expect(devices.liveTracks()).toEqual([]);
  });

  it('opens the calibrated camera and calibrates the worker for the actual frame size', async () => {
    const recognition = await startRecognizing();

    expect(recognition.phase()).toBe('RECOGNIZING');
    expect(devices.requests[0]?.video).toMatchObject({ deviceId: { exact: 'cam-rear' } });
    const calibrate = workers[0]?.sent('CALIBRATE')[0];
    const expected = canonicalCorners(
      scaleCorners(PROFILE.corners, { width: 1280, height: 960 }, { width: 640, height: 480 }),
      'ROTATED_180',
    );
    expect(calibrate).toEqual({ type: 'CALIBRATE', corners: expected, width: 640, height: 480 });
    expect(recognition.frameSize()).toEqual({ width: 640, height: 480 });
  });

  it('shows the live reading with markers for the 32 playable squares', async () => {
    const recognition = await startRecognizing();

    expect(recognition.cells()?.[17]).toBe('UNKNOWN');
    expect(recognition.unknownCount()).toBe(1);
    expect(recognition.markers()).toHaveLength(32);
    expect(recognition.markers().find((m) => m.index === 17)?.piece).toBe('UNKNOWN');
  });

  it('corrects squares, measures agreement and confirms once nothing is unknown', async () => {
    const recognition = await startRecognizing();

    recognition.pauseForCorrection();
    expect(recognition.phase()).toBe('CORRECTING');
    expect(recognition.canConfirm()).toBe(false);

    recognition.selectSquare(17);
    recognition.setSelectedPiece('BLACK');
    recognition.selectSquare(44);
    recognition.setSelectedPiece('WHITE');

    expect(recognition.changedSquares().sort((a, b) => a - b)).toEqual([17, 44]);
    expect(recognition.metrics()).toEqual({ matched: 30, total: 32, corrected: 2, unknown: 1 });
    expect(recognition.canConfirm()).toBe(true);

    recognition.confirm();

    expect(recognition.phase()).toBe('CONFIRMED');
    expect(recognition.confirmed()?.cells).toEqual(startingPosition());
    expect(recognition.confirmed()?.confidenceBySquare[17]).toBe(1);
    expect(recognition.pieceCounts()).toEqual({ white: 12, black: 12 });
  });

  it('setting a square back to its reading removes the correction', async () => {
    const recognition = await startRecognizing();
    recognition.pauseForCorrection();
    recognition.selectSquare(44);

    recognition.setSelectedPiece('WHITE');
    recognition.setSelectedPiece('BLACK');

    expect(recognition.changedSquares()).toEqual([]);
  });

  it('ignores selection of non-playable squares and outside correction mode', async () => {
    const recognition = await startRecognizing();

    recognition.selectSquare(17);
    expect(recognition.selected()).toBeNull();

    recognition.pauseForCorrection();
    recognition.selectSquare(0);
    expect(recognition.selected()).toBeNull();
  });

  it('pauses capture while correcting and resumes live reading afterwards', async () => {
    const recognition = await startRecognizing();
    const capture = TestBed.inject(FrameCaptureService);

    recognition.pauseForCorrection();
    expect(capture.state()).toBe('PAUSED');

    recognition.resume();
    expect(capture.state()).toBe('RUNNING');
    expect(recognition.phase()).toBe('RECOGNIZING');
    expect(recognition.changedSquares()).toEqual([]);
  });

  it('stops with an explanation when the saved calibration does not fit the camera image', async () => {
    reply = (message) =>
      message.type === 'CALIBRATE'
        ? {
            type: 'CALIBRATION_RESULT',
            result: {
              valid: false,
              issues: [{ code: 'OUT_OF_BOUNDS', corners: ['topLeft'] }],
              normalizedWidth: 800,
              normalizedHeight: 800,
            },
          }
        : happyPathReply(message);
    repository.profiles.set(PROFILE.id, PROFILE);

    await store().start();
    await vi.waitFor(() => expect(store().phase()).toBe('ERROR'));

    expect(store().error()).toContain('Refaça a calibração');
    expect(TestBed.inject(FrameCaptureService).state()).toBe('STOPPED');
  });

  it('reports a camera that cannot be opened', async () => {
    repository.profiles.set(PROFILE.id, PROFILE);
    devices.failNextWith('NotAllowedError');

    await store().start();

    expect(store().phase()).toBe('ERROR');
    expect(store().error()).toContain('negado');
  });

  it('stops capturing when destroyed', async () => {
    await startRecognizing();
    const capture = TestBed.inject(FrameCaptureService);

    TestBed.resetTestingModule();

    expect(capture.state()).toBe('STOPPED');
  });

  it('realigns the calibration, saves it and recalibrates the worker', async () => {
    const recognition = await startRecognizing();
    const calibrationsBefore = workers[0]?.sent('CALIBRATE').length ?? 0;

    await recognition.realign();
    await vi.waitFor(() =>
      expect(workers[0]?.sent('CALIBRATE').length ?? 0).toBeGreaterThan(calibrationsBefore),
    );

    expect(recognition.realignState()).toEqual({ status: 'DONE', shiftPx: 4 });
    const saved = repository.profiles.get(PROFILE.id);
    expect(saved?.corners).not.toEqual(PROFILE.corners);
    expect(TestBed.inject(FrameCaptureService).state()).toBe('RUNNING');
  });

  it('exports a labeled sample of the confirmed position', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: () => undefined,
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(
      'data:image/png;base64,AAAA',
    );
    const recognition = await startRecognizing();
    recognition.pauseForCorrection();
    recognition.selectSquare(17);
    recognition.setSelectedPiece('BLACK');
    recognition.selectSquare(44);
    recognition.setSelectedPiece('WHITE');
    recognition.confirm();

    const sample = await recognition.buildLabeledSample();

    expect(isLabeledSample(sample)).toBe(true);
    expect(sample.labels).toEqual(startingPosition());
    expect(sample.recognized.cells[17]).toBe('UNKNOWN');
    expect(sample.frame).toMatchObject({ width: 640, height: 480 });
    expect(sample.calibration.orientation).toBe('ROTATED_180');
    expect(sample.conditions).toBeUndefined();

    const tagged = await recognition.buildLabeledSample({
      description: '  luz de janela  ',
      conditions: ['LUZ_NATURAL', 'SOMBRAS'],
    });
    expect(tagged).toMatchObject({
      description: 'luz de janela',
      conditions: ['LUZ_NATURAL', 'SOMBRAS'],
    });
    expect(isLabeledSample(tagged)).toBe(true);
    vi.restoreAllMocks();
  });

  it('refuses to export before the position is confirmed', async () => {
    const recognition = await startRecognizing();

    await expect(recognition.buildLabeledSample()).rejects.toThrow('Confirme');
  });

  describe('with the local vision service (G3.1)', () => {
    const useService = () =>
      TestBed.inject(VisionProviderState).set({
        kind: 'local-service',
        serviceUrl: 'http://127.0.0.1:8765',
      });

    it('says the service did not answer when it cannot start', async () => {
      useService();
      reply = (message) =>
        message.type === 'INIT'
          ? { type: 'ERROR', code: 'SERVICE_UNAVAILABLE', message: 'down', requestType: 'INIT' }
          : happyPathReply(message);
      repository.profiles.set(PROFILE.id, PROFILE);

      await store().start();

      expect(store().phase()).toBe('ERROR');
      expect(store().error()).toContain('serviço de visão local não respondeu');
      expect(store().error()).toContain('http://127.0.0.1:8765');
    });

    it('stops with an explicit message after consecutive unanswered frames', async () => {
      useService();
      const recognition = await startRecognizing();
      reply = (message) =>
        message.type === 'PROCESS_FRAME'
          ? {
              type: 'ERROR',
              code: 'SERVICE_UNAVAILABLE',
              message: 'down',
              frameId: message.frameId,
              requestType: 'PROCESS_FRAME',
            }
          : happyPathReply(message);

      await vi.waitFor(() => expect(recognition.phase()).toBe('ERROR'), { timeout: 3000 });

      expect(recognition.error()).toContain('npm run vision:serve');
      expect(devices.liveTracks()).not.toEqual([]); // the camera stays open for a retry
    });

    it('treats isolated failures as dropped frames', async () => {
      useService();
      const recognition = await startRecognizing();
      let failures = 0;
      reply = (message) => {
        if (message.type === 'PROCESS_FRAME' && failures < 2) {
          failures++;
          return {
            type: 'ERROR',
            code: 'SERVICE_UNAVAILABLE',
            message: 'slow',
            frameId: message.frameId,
            requestType: 'PROCESS_FRAME',
          };
        }
        return message.type === 'PROCESS_FRAME'
          ? {
              type: 'RECOGNITION_RESULT',
              frameId: message.frameId,
              result: recognitionResultFrom(readCells()),
            }
          : happyPathReply(message);
      };

      await new Promise((resolve) => setTimeout(resolve, 1200));

      expect(failures).toBe(2);
      expect(recognition.phase()).toBe('RECOGNIZING');
    });
  });
});
