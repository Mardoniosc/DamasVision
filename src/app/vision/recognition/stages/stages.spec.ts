import { DEFAULT_VISION_CONFIG } from '../../vision.config';
import { resolveClassifierConfig } from '../classifier.config';
import { SquareFeatures } from '../square-features';
import { colorStage } from './color.stage';
import { consolidate } from './consolidate';
import { occupancyStage } from './occupancy.stage';
import { pieceTypeStage } from './piece-type.stage';
import { UNDETERMINED_CONFIDENCE } from './stage.models';

const config = resolveClassifierConfig(DEFAULT_VISION_CONFIG);
const visible = { visibleCorners: 4, backgroundRelative: 0.38 };

/** A brown dark square (luminance ≈ 0.32) with nothing on it. */
function features(overrides: Partial<SquareFeatures> = {}): SquareFeatures {
  return {
    index: 1,
    backgroundColor: [112, 72, 42],
    backgroundLuminance: 0.32,
    pieceColor: [112, 72, 42],
    pieceLuminance: 0.32,
    pieceLuminanceStd: 0,
    colorDistance: 0,
    foregroundRatio: 0,
    shadowRatio: 0,
    ringForegroundRatio: 0,
    markLuminance: 0.32,
    bodyLuminance: 0.32,
    markColor: [112, 72, 42],
    bodyColor: [112, 72, 42],
    ...overrides,
  };
}

const white = {
  foregroundRatio: 1,
  ringForegroundRatio: 1,
  bodyLuminance: 0.9,
  markLuminance: 0.9,
  bodyColor: [230, 230, 230] as const,
  markColor: [230, 230, 230] as const,
};
const black = {
  foregroundRatio: 1,
  ringForegroundRatio: 1,
  bodyLuminance: 0.1,
  markLuminance: 0.1,
  bodyColor: [30, 30, 30] as const,
  markColor: [30, 30, 30] as const,
};

describe('stage B — occupancy', () => {
  it('EMPTY with full confidence when nothing differs from the board', () => {
    expect(occupancyStage(features(), visible, config)).toEqual({
      decision: 'EMPTY',
      confidence: 1,
      reason: 'EMPTY_BACKGROUND',
    });
  });

  it('EMPTY confidence falls towards the empty threshold', () => {
    const near = occupancyStage(features({ foregroundRatio: 0.12 }), visible, config);

    expect(near.decision).toBe('EMPTY');
    expect(near.confidence).toBeCloseTo(0.6, 5);
  });

  it('OCCUPIED above the presence threshold', () => {
    const piece = features({ foregroundRatio: 0.9, ringForegroundRatio: 0.95 });
    expect(occupancyStage(piece, visible, config)).toMatchObject({
      decision: 'OCCUPIED',
      reason: 'OCCUPIED_FOREGROUND',
    });
  });

  it('UNDETERMINED for partial occupancy (off-center piece, finger)', () => {
    expect(occupancyStage(features({ foregroundRatio: 0.3 }), visible, config)).toEqual({
      decision: 'UNDETERMINED',
      confidence: UNDETERMINED_CONFIDENCE,
      reason: 'PARTIAL_OCCUPANCY',
    });
  });

  it('UNDETERMINED when the foreground does not reach the disk edge (glare, fingertip)', () => {
    const spot = features({ foregroundRatio: 0.7, ringForegroundRatio: 0.45 });

    expect(occupancyStage(spot, visible, config)).toMatchObject({
      decision: 'UNDETERMINED',
      reason: 'NOT_PIECE_SHAPED',
    });
    expect(
      occupancyStage(features({ foregroundRatio: 0.7, ringForegroundRatio: 1 }), visible, config)
        .decision,
    ).toBe('OCCUPIED');
  });

  it('UNDETERMINED when no corner shows the board (obstructed ROI)', () => {
    const outcome = occupancyStage(features(), { ...visible, visibleCorners: 0 }, config);

    expect(outcome).toMatchObject({ decision: 'UNDETERMINED', reason: 'ROI_OBSTRUCTED' });
  });

  it('refuses EMPTY on a square too dark to reveal black pieces', () => {
    const outcome = occupancyStage(features(), { ...visible, backgroundRelative: 0.15 }, config);

    expect(outcome).toMatchObject({ decision: 'UNDETERMINED', reason: 'LOW_BOARD_CONTRAST' });
  });

  it('color and king evidence cannot influence an empty square', () => {
    const outcome = occupancyStage(
      features({ bodyLuminance: 0.9, markColor: [255, 0, 0] }),
      visible,
      config,
    );

    expect(outcome.decision).toBe('EMPTY');
  });
});

describe('stage C — color', () => {
  it.each([
    ['WHITE', white],
    ['BLACK', black],
  ] as const)('%s with high confidence', (decision, overrides) => {
    const outcome = colorStage(features(overrides), config);

    expect(outcome.decision).toBe(decision);
    expect(outcome.confidence).toBeGreaterThanOrEqual(config.confidence.high);
  });

  it('UNDETERMINED between the thresholds', () => {
    expect(colorStage(features({ ...white, bodyLuminance: 0.33 }), config)).toMatchObject({
      decision: 'UNDETERMINED',
      reason: 'AMBIGUOUS_COLOR',
    });
  });
});

describe('stage D — piece type', () => {
  const mark = (coverage: number) => ({
    coverage,
    offset: coverage > 0 ? { x: 0, y: -0.3 } : null,
  });

  it('MAN when no mark-colored area is found on the top face', () => {
    expect(pieceTypeStage(mark(0), config)).toEqual({
      decision: 'MAN',
      confidence: 1,
      reason: 'NO_MARK',
    });
  });

  it('KING when the found mark covers most of the expected mark area', () => {
    expect(pieceTypeStage(mark(1.2), config)).toMatchObject({
      decision: 'KING',
      reason: 'COLORED_MARK',
    });
  });

  it('UNDETERMINED near the coverage threshold (a fragment of color is not a king)', () => {
    expect(pieceTypeStage(mark(config.color.kingMarkMinCoverage + 0.02), config)).toMatchObject({
      decision: 'UNDETERMINED',
      reason: 'AMBIGUOUS_MARK',
    });
  });
});

describe('stage E — consolidation', () => {
  const occupied = {
    decision: 'OCCUPIED' as const,
    confidence: 1,
    reason: 'OCCUPIED_FOREGROUND' as const,
  };

  it('EMPTY ignores color and type stages', () => {
    const result = consolidate(
      { decision: 'EMPTY', confidence: 0.97, reason: 'EMPTY_BACKGROUND' },
      null,
      null,
      config,
    );

    expect(result).toMatchObject({
      piece: 'EMPTY',
      decision: 'ACCEPT',
      limitingStage: 'OCCUPANCY',
    });
  });

  it('combines color and type into the piece, with the weakest confidence', () => {
    const result = consolidate(
      occupied,
      { decision: 'BLACK', confidence: 0.85, reason: 'BLACK_CONTRAST' },
      { decision: 'KING', confidence: 0.95, reason: 'COLORED_MARK' },
      config,
    );

    expect(result).toEqual({
      piece: 'BLACK_KING',
      confidence: 0.85,
      decision: 'ACCEPT',
      reason: 'BLACK_CONTRAST',
      limitingStage: 'COLOR',
    });
  });

  it('WARN between the uncertain and acceptable bands', () => {
    const result = consolidate(
      occupied,
      { decision: 'WHITE', confidence: 0.7, reason: 'WHITE_CONTRAST' },
      { decision: 'MAN', confidence: 1, reason: 'NO_MARK' },
      config,
    );

    expect(result).toMatchObject({ piece: 'WHITE', decision: 'WARN' });
  });

  it('UNKNOWN (RETRY) when any needed stage is undetermined, naming that stage', () => {
    const result = consolidate(
      occupied,
      { decision: 'UNDETERMINED', confidence: 0.3, reason: 'AMBIGUOUS_COLOR' },
      { decision: 'MAN', confidence: 1, reason: 'NO_MARK' },
      config,
    );

    expect(result).toMatchObject({
      piece: 'UNKNOWN',
      decision: 'RETRY',
      reason: 'AMBIGUOUS_COLOR',
      limitingStage: 'COLOR',
    });
  });

  it('UNKNOWN below the uncertain band, never a weak guess', () => {
    const result = consolidate(
      { decision: 'EMPTY', confidence: 0.55, reason: 'EMPTY_BACKGROUND' },
      null,
      null,
      config,
    );

    expect(result).toMatchObject({ piece: 'UNKNOWN', decision: 'RETRY' });
  });
});
