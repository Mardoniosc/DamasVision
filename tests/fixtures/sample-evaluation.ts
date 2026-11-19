import { createVisionWorkerHandler } from '../../src/app/core/workers/vision-worker.handler';
import { VisionWorkerResponse } from '../../src/app/core/workers/vision-worker.protocol';
import { canonicalCorners } from '../../src/app/domain/board/calibration';
import { BoardRecognitionResult } from '../../src/app/domain/board/observation';
import { SquareTrace } from '../../src/app/vision/recognition/square-trace';
import { LabeledSample } from '../../src/app/features/recognition/labeled-sample';
import { OpenCv } from '../../src/app/vision/opencv-loader';
import { RgbaImage } from '../../src/app/vision/perspective';
import { DEFAULT_VISION_CONFIG, VisionConfig } from '../../src/app/vision/vision.config';
import { fakeBitmap, FakeBitmap } from './fake-frames';
import { dataUrlToBytes, decodePng } from './png';
import { RecognitionScore, scoreRecognition } from './synthetic-board';

export interface SampleEvaluation {
  readonly score: RecognitionScore;
  readonly result: BoardRecognitionResult;
  readonly traces: readonly SquareTrace[];
  /** Reading and traces after the automatic corner adjustment. */
  readonly refinedResult: BoardRecognitionResult;
  readonly refinedTraces: readonly SquareTrace[];
  /** Same evaluation after the automatic corner adjustment (ADR-027). */
  readonly refinedScore: RecognitionScore;
}

/**
 * Runs a labeled sample through the real worker pipeline (OpenCV.js) with the sample's
 * calibration, then again after automatic corner refinement, and scores both against
 * the user's confirmed labels.
 */
export async function evaluateSample(
  sample: LabeledSample,
  loadOpenCv: () => Promise<OpenCv>,
  /** The current configuration: the sample's own config is provenance only. */
  config: VisionConfig = DEFAULT_VISION_CONFIG,
): Promise<SampleEvaluation> {
  const frame = await decodePng(dataUrlToBytes(sample.frame.png));
  const posted: VisionWorkerResponse[] = [];
  const handle = createVisionWorkerHandler({
    loadOpenCv,
    post: (message) => posted.push(message),
    readBitmap: (): RgbaImage => frame,
    createBitmap: async (image) =>
      fakeBitmap(image.width, image.height) as FakeBitmap & ImageBitmap,
  });
  const bitmap = () => fakeBitmap(frame.width, frame.height) as FakeBitmap & ImageBitmap;
  const size = { width: frame.width, height: frame.height };
  const canonical = canonicalCorners(sample.calibration.corners, sample.calibration.orientation);

  const recognize = async (
    frameId: string,
  ): Promise<{ result: BoardRecognitionResult; traces: readonly SquareTrace[] }> => {
    await handle({ type: 'PROCESS_FRAME', frame: bitmap(), frameId });
    const response = posted.at(-1);
    if (response?.type !== 'RECOGNITION_RESULT') {
      throw new Error(`recognition failed: ${JSON.stringify(response)}`);
    }
    return { result: response.result, traces: response.traces ?? [] };
  };

  await handle({ type: 'INIT', config });
  await handle({ type: 'CALIBRATE', corners: canonical, ...size });
  const saved = await recognize('as-saved');

  await handle({
    type: 'REFINE_CALIBRATION',
    corners: canonical,
    frame: bitmap(),
    frameId: 'refine',
  });
  const refined = posted.at(-1);
  if (refined?.type !== 'CALIBRATION_REFINED') {
    throw new Error(`refinement failed: ${JSON.stringify(refined)}`);
  }
  await handle({ type: 'CALIBRATE', corners: refined.corners, ...size });
  const refined2 = await recognize('refined');

  return {
    score: scoreRecognition(sample.labels, saved.result.board.cells),
    result: saved.result,
    traces: saved.traces,
    refinedResult: refined2.result,
    refinedTraces: refined2.traces,
    refinedScore: scoreRecognition(sample.labels, refined2.result.board.cells),
  };
}
