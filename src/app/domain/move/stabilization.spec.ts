import { position } from '../../../../tests/fixtures/engine-positions';
import { frames, observe } from '../../../../tests/fixtures/observations';
import { initialBoard } from '../engine/board-state';
import {
  DEFAULT_INFERENCE_CONFIG,
  InferenceConfigError,
  validateInferenceConfig,
} from './inference.config';
import { ObservationWindow } from './observation-window';
import { StableBoardDetector } from './stable-board-detector';

describe('E5-T01 — bounded observation window', () => {
  it('keeps at most maxSize items, none older than maxAgeMs', () => {
    const window = new ObservationWindow<{ timestamp: number }>(3, 1000);
    [0, 200, 400, 600].forEach((timestamp) => window.push({ timestamp }));

    expect(window.toArray().map((i) => i.timestamp)).toEqual([200, 400, 600]);
    window.push({ timestamp: 1700 });
    expect(window.toArray().map((i) => i.timestamp)).toEqual([1700]);
  });

  it('drops stale (late) items without reordering', () => {
    const window = new ObservationWindow<{ timestamp: number }>(5, 1000);
    window.push({ timestamp: 400 });

    expect(window.push({ timestamp: 300 })).toBe(false);
    expect(window.dropped).toBe(1);
    expect(window.toArray().map((i) => i.timestamp)).toEqual([400]);
  });

  it('validates its configuration', () => {
    expect(() => new ObservationWindow(0, 100)).toThrow(RangeError);
    expect(() =>
      validateInferenceConfig({ ...DEFAULT_INFERENCE_CONFIG, stableObservationCount: 6 }),
    ).toThrow(InferenceConfigError);
    expect(() =>
      validateInferenceConfig({ ...DEFAULT_INFERENCE_CONFIG, acceptableConfidence: 0 }),
    ).toThrow(InferenceConfigError);
  });
});

describe('E5-T02 — stable board detector', () => {
  const board = observe(initialBoard());

  it('is stable after enough identical observations spanning the minimum time', () => {
    const detector = new StableBoardDetector();
    const updates = frames(board, 4, 0).map((o) => detector.push(o));

    expect(updates.map((u) => u.status)).toEqual(['WAITING', 'WAITING', 'WAITING', 'STABLE']);
    expect(updates[3]?.isNew).toBe(true);
    expect(updates[3]?.observation?.cells).toEqual(board.cells);
  });

  it('is unstable while the board keeps changing (a move in progress)', () => {
    const detector = new StableBoardDetector();
    const lifted = observe(initialBoard(), { edits: { c3: 'EMPTY' } });
    const hand = observe(initialBoard(), { edits: { c3: 'UNKNOWN', d4: 'UNKNOWN' } });
    const sequence = [board, lifted, hand, lifted, hand].map((o, i) => ({
      ...o,
      timestamp: i * 200,
    }));

    expect(sequence.map((o) => detector.push(o).status)).toEqual([
      'WAITING',
      'WAITING',
      'UNSTABLE',
      'UNSTABLE',
      'UNSTABLE',
    ]);
  });

  it('an occluded board is stable only if it stays occluded the same way', () => {
    const detector = new StableBoardDetector();
    const hand = observe(initialBoard(), { edits: { d4: 'UNKNOWN' } });

    const updates = frames(hand, 4, 0).map((o) => detector.push(o));

    expect(updates[3]?.status).toBe('STABLE');
    expect(updates[3]?.observation?.cells[35]).toBe('UNKNOWN');
  });

  it('reports a stable board as new only once, and again after another board was stable', () => {
    const detector = new StableBoardDetector();
    const moved = observe(position({ d4: 'WHITE', h8: 'BLACK' }));

    const first = frames(board, 6, 0).map((o) => detector.push(o));
    const second = frames(moved, 4, 1200).map((o) => detector.push(o));
    const back = frames(board, 4, 2000).map((o) => detector.push(o));

    expect(first.filter((u) => u.isNew)).toHaveLength(1);
    expect(second.filter((u) => u.isNew)).toHaveLength(1);
    expect(back.filter((u) => u.isNew)).toHaveLength(1);
  });

  it('a stable board carries the lowest confidence seen per square', () => {
    const detector = new StableBoardDetector();
    const shaky = observe(initialBoard(), { confidenceAt: { c3: 0.7 } });
    [board, shaky, board, board].forEach((o, i) => detector.push({ ...o, timestamp: i * 200 }));

    const update = detector.push({ ...board, timestamp: 800 });

    expect(update.observation?.confidenceBySquare[42]).toBe(0.7);
  });

  it('ignores stale frames and starts over after reset', () => {
    const detector = new StableBoardDetector();
    frames(board, 4, 1000).forEach((o) => detector.push(o));

    expect(detector.push({ ...board, timestamp: 500 }).isNew).toBe(false);
    expect(detector.dropped).toBe(1);
    detector.reset();
    const again = frames(board, 4, 3000).map((o) => detector.push(o));
    expect(again[3]?.isNew).toBe(true);
  });
});
