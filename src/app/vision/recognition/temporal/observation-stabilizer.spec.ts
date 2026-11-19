import { recognitionResultFrom } from '../../../../../tests/fixtures/recognition-results';
import { startingPosition } from '../../../../../tests/fixtures/synthetic-board';
import { ObservedPiece } from '../../../domain/board/piece';
import { FrameAssessment } from '../recognize-board';
import { ObservationStabilizer } from './observation-stabilizer';

const CONFIG = { windowSize: 5, minAgreeing: 3, maxAgeMs: 2000, acceptable: 0.8 };
const GOOD: FrameAssessment = {
  sharpness: 90,
  meanLuminance: 0.46,
  alignmentQuality: 1,
  issues: [],
};

function frame(timestamp: number, edit: (cells: ObservedPiece[]) => void = () => undefined) {
  const cells: ObservedPiece[] = startingPosition();
  edit(cells);
  return recognitionResultFrom(cells, { timestamp });
}

describe('ObservationStabilizer (G3 temporal consolidation)', () => {
  it('does not decide from a single frame', () => {
    const stabilizer = new ObservationStabilizer(CONFIG);

    stabilizer.push(frame(0), GOOD);

    const square = stabilizer.squares().find((s) => s.squareIndex === 1);
    expect(square).toMatchObject({ piece: 'UNKNOWN', decision: 'RETRY', frames: 1 });
  });

  it('accepts a piece after enough agreeing frames, with the median confidence (no boosting)', () => {
    const stabilizer = new ObservationStabilizer(CONFIG);
    [0, 200, 400].forEach((t) => stabilizer.push(frame(t), GOOD));

    const square = stabilizer.squares().find((s) => s.squareIndex === 1);

    expect(square).toMatchObject({ piece: 'BLACK', decision: 'ACCEPT', confidence: 0.97 });
  });

  it('a single noisy frame cannot flip a stable square', () => {
    const stabilizer = new ObservationStabilizer(CONFIG);
    [0, 200, 400, 600].forEach((t) => stabilizer.push(frame(t), GOOD));

    stabilizer.push(
      frame(800, (cells) => (cells[1] = 'WHITE')),
      GOOD,
    );

    expect(stabilizer.squares().find((s) => s.squareIndex === 1)?.piece).toBe('BLACK');
  });

  it('occasional UNKNOWN frames do not keep a consistent square UNKNOWN', () => {
    const stabilizer = new ObservationStabilizer(CONFIG);
    stabilizer.push(
      frame(0, (cells) => (cells[33] = 'UNKNOWN')),
      GOOD,
    );
    stabilizer.push(frame(200), GOOD);
    stabilizer.push(
      frame(400, (cells) => (cells[33] = 'UNKNOWN')),
      GOOD,
    );
    stabilizer.push(frame(600), GOOD);
    stabilizer.push(frame(800), GOOD);

    expect(stabilizer.squares().find((s) => s.squareIndex === 33)).toMatchObject({
      piece: 'EMPTY',
      decision: 'ACCEPT',
    });
  });

  it('conflicting evidence stays UNKNOWN and escalates to MANUAL when the window is full', () => {
    const stabilizer = new ObservationStabilizer(CONFIG);
    const pieces: ObservedPiece[] = ['BLACK', 'EMPTY', 'BLACK', 'EMPTY', 'BLACK'];
    pieces.forEach((piece, i) =>
      stabilizer.push(
        frame(i * 200, (cells) => (cells[1] = piece)),
        GOOD,
      ),
    );

    expect(stabilizer.squares().find((s) => s.squareIndex === 1)).toMatchObject({
      piece: 'UNKNOWN',
      decision: 'MANUAL',
      votes: { BLACK: 3, EMPTY: 2 },
    });
  });

  it('blurry or badly exposed frames do not vote', () => {
    const stabilizer = new ObservationStabilizer(CONFIG);

    const accepted = stabilizer.push(frame(0), { ...GOOD, issues: ['LOW_SHARPNESS'] });
    stabilizer.push(frame(200), { ...GOOD, issues: ['OVEREXPOSED'] });

    expect(accepted).toBe(false);
    expect(stabilizer.size).toBe(0);
    expect(stabilizer.skipped).toBe(2);
  });

  it('a misaligned frame still votes (the warning is reported, not hidden)', () => {
    const stabilizer = new ObservationStabilizer(CONFIG);

    expect(stabilizer.push(frame(0), { ...GOOD, issues: ['CALIBRATION_MISALIGNED'] })).toBe(true);
  });

  it('drops stale frames and keeps a bounded window', () => {
    const stabilizer = new ObservationStabilizer(CONFIG);
    [0, 200, 400].forEach((t) => stabilizer.push(frame(t), GOOD));

    stabilizer.push(frame(5000), GOOD);

    expect(stabilizer.size).toBe(1);
    [5200, 5400, 5600, 5800, 6000].forEach((t) => stabilizer.push(frame(t), GOOD));
    expect(stabilizer.size).toBe(5);
  });

  it('builds a stable recognition result with the same contract', () => {
    const stabilizer = new ObservationStabilizer(CONFIG);
    [0, 200, 400].forEach((t) => stabilizer.push(frame(t), GOOD));

    const result = stabilizer.stableResult(frame(400));

    expect(result.board.cells).toEqual(startingPosition());
    expect(result.squares).toHaveLength(32);
    expect(result.status).toBe('SUCCESS');
  });

  it('rejects an impossible configuration', () => {
    expect(() => new ObservationStabilizer({ ...CONFIG, minAgreeing: 6 })).toThrow(RangeError);
  });
});
