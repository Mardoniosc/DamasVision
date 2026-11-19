import { DEFAULT_VISION_CONFIG } from '../vision.config';
import { resolveClassifierConfig } from './classifier.config';
import { AMBIGUOUS_CONFIDENCE, classifySquare } from './square-classifier';
import { SquareFeatures } from './square-features';

const config = resolveClassifierConfig(DEFAULT_VISION_CONFIG);
const LIGHT = 0.84;
const context = { lightReference: LIGHT, occluded: false };

/** A brown dark square (luminance ≈ 0.32) with nothing on it. */
function features(overrides: Partial<SquareFeatures> = {}): SquareFeatures {
  return {
    index: 1,
    backgroundColor: [112, 72, 42],
    backgroundLuminance: 0.32,
    pieceColor: [112, 72, 42],
    pieceLuminance: 0.32,
    pieceSaturation: 0.6,
    colorDistance: 0,
    foregroundRatio: 0,
    markLuminance: 0.32,
    bodyLuminance: 0.32,
    markColor: [112, 72, 42],
    bodyColor: [112, 72, 42],
    ...overrides,
  };
}

const whitePiece = {
  foregroundRatio: 1,
  bodyLuminance: 0.9,
  markLuminance: 0.9,
  bodyColor: [230, 230, 230] as const,
  markColor: [230, 230, 230] as const,
};
const blackPiece = {
  foregroundRatio: 1,
  bodyLuminance: 0.1,
  markLuminance: 0.1,
  bodyColor: [30, 30, 30] as const,
  markColor: [30, 30, 30] as const,
};

describe('classifySquare', () => {
  it('recognizes an empty square with full confidence', () => {
    expect(classifySquare(features(), context, config)).toEqual({
      piece: 'EMPTY',
      confidence: 1,
      limitedBy: 'NONE',
    });
  });

  it.each([
    ['WHITE', whitePiece],
    ['BLACK', blackPiece],
    ['WHITE_KING', { ...whitePiece, markLuminance: 0.3, markColor: [150, 30, 30] as const }],
    ['BLACK_KING', { ...blackPiece, markLuminance: 0.7, markColor: [222, 180, 60] as const }],
  ] as const)('recognizes %s', (piece, overrides) => {
    const result = classifySquare(features(overrides), context, config);

    expect(result.piece).toBe(piece);
    expect(result.confidence).toBeGreaterThanOrEqual(config.confidence.high);
  });

  it('is UNKNOWN when only part of the disk differs (off-square piece, finger)', () => {
    const result = classifySquare(features({ foregroundRatio: 0.3 }), context, config);

    expect(result).toEqual({
      piece: 'UNKNOWN',
      confidence: AMBIGUOUS_CONFIDENCE,
      limitedBy: 'PRESENCE',
    });
  });

  it('is UNKNOWN when the piece is neither clearly lighter nor darker than the square', () => {
    const result = classifySquare(
      features({ foregroundRatio: 1, bodyLuminance: 0.33 }),
      context,
      config,
    );

    expect(result.limitedBy).toBe('COLOR');
    expect(result.piece).toBe('UNKNOWN');
  });

  it('lowers confidence near a threshold and turns it into UNKNOWN below the uncertain band', () => {
    const borderline = classifySquare(
      features({ foregroundRatio: 0.47, bodyLuminance: 0.9 }),
      context,
      config,
    );

    expect(borderline.piece).toBe('UNKNOWN');
    expect(borderline.confidence).toBeLessThan(config.confidence.uncertain);
    expect(borderline.limitedBy).toBe('PRESENCE');
  });

  it('is UNKNOWN for an ambiguous king mark', () => {
    // Mark chromaticity ≈ 0.082 from the gray body: just past the 0.08 threshold.
    const result = classifySquare(
      features({ ...whitePiece, markColor: [240, 175, 175] }),
      context,
      config,
    );

    expect(result).toMatchObject({ piece: 'UNKNOWN', limitedBy: 'KING' });
  });

  it('ignores achromatic center shading (grooves, hollows)', () => {
    const result = classifySquare(
      features({ ...whitePiece, markLuminance: 0.55, markColor: [140, 140, 140] }),
      context,
      config,
    );

    expect(result.piece).toBe('WHITE');
  });

  it('refuses to call a square empty when the board is too dark to see black pieces', () => {
    const result = classifySquare(features({ backgroundLuminance: 0.12 }), context, config);

    expect(result).toMatchObject({ piece: 'UNKNOWN', limitedBy: 'BOARD_CONTRAST' });
  });

  it('is UNKNOWN for an occluded square whatever the features say', () => {
    const result = classifySquare(features(whitePiece), { ...context, occluded: true }, config);

    expect(result).toMatchObject({ piece: 'UNKNOWN', limitedBy: 'OCCLUSION' });
  });
});
