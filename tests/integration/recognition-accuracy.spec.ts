import { Piece } from '../../src/app/domain/board/piece';
import { resolveClassifierConfig } from '../../src/app/vision/recognition/classifier.config';
import { recognizeBoard } from '../../src/app/vision/recognition/recognize-board';
import { DEFAULT_VISION_CONFIG } from '../../src/app/vision/vision.config';
import {
  midgamePosition,
  RenderOptions,
  renderNormalizedBoard,
  scoreRecognition,
  startingPosition,
} from '../fixtures/synthetic-board';

/**
 * Recognition accuracy on synthetic normalized boards (E3, Gate G3 "measurable").
 * Targets from spec §16: classification ≥ 95 % and effectively zero confident errors —
 * when the classifier is unsure it must answer UNKNOWN, never a wrong piece.
 * Synthetic data does not replace the physical test matrix (E8-T02).
 */
const config = resolveClassifierConfig(DEFAULT_VISION_CONFIG);

const SCENARIOS: readonly { name: string; position: () => Piece[]; options: RenderOptions }[] = [
  { name: 'ideal, starting position', position: startingPosition, options: {} },
  { name: 'ideal, mid-game with kings', position: midgamePosition, options: {} },
  { name: 'dim light (×0.55)', position: midgamePosition, options: { brightness: 0.55 } },
  {
    name: 'bright light (×1.2, clipping)',
    position: midgamePosition,
    options: { brightness: 1.2 },
  },
  {
    name: 'side lighting gradient (0.6 → 1.15)',
    position: startingPosition,
    options: { gradient: [0.6, 1.15] },
  },
  { name: 'sensor noise (σ = 10)', position: midgamePosition, options: { noise: 10, seed: 3 } },
  {
    name: 'pieces off-center (±8 %)',
    position: startingPosition,
    options: { jitter: 0.08, seed: 5 },
  },
  {
    name: 'local shadow',
    position: midgamePosition,
    options: { shadow: { x: 300, y: 420, radius: 220, factor: 0.6 } },
  },
  {
    name: 'combined: gradient + noise + jitter',
    position: midgamePosition,
    options: { gradient: [0.75, 1.1], noise: 8, jitter: 0.06, seed: 11 },
  },
];

describe('recognition accuracy on synthetic boards', () => {
  for (const scenario of SCENARIOS) {
    it(`${scenario.name}: ≥ 95 % correct, no confident errors`, () => {
      const expected = scenario.position();
      const image = renderNormalizedBoard(expected, scenario.options);

      const { result } = recognizeBoard(image, config, { timestamp: 0 });
      const score = scoreRecognition(expected, result.board.cells);

      expect(score.errors, JSON.stringify(score.errors)).toEqual([]);
      expect(
        score.accuracy,
        `${score.correct}/32 correct, ${score.unknown} unknown`,
      ).toBeGreaterThanOrEqual(0.95);
    });
  }

  it('reports SUCCESS with high overall confidence on an ideal board', () => {
    const { result } = recognizeBoard(renderNormalizedBoard(startingPosition()), config, {
      timestamp: 1,
    });

    expect(result.status).toBe('SUCCESS');
    expect(result.overallConfidence).toBeGreaterThanOrEqual(0.95);
    expect(result.warnings).toEqual([]);
  });

  it('prefers UNKNOWN to a wrong answer when black pieces sit on near-black squares', () => {
    const expected = midgamePosition();
    const image = renderNormalizedBoard(expected, { darkSquare: [38, 34, 34] });

    const { result } = recognizeBoard(image, config, { timestamp: 0 });
    const score = scoreRecognition(expected, result.board.cells);

    expect(score.wrong).toBe(0);
    expect(result.status).toBe('UNCERTAIN');
  });

  it('a hand covering pieces yields UNKNOWN, never "empty" (no false move evidence)', () => {
    const expected = startingPosition();
    const image = renderNormalizedBoard(expected);
    // Skin-colored blob over rows 5–6 (white pieces) and their light squares.
    for (let y = 500; y < 700; y++) {
      for (let x = 100; x < 560; x++) {
        image.data.set([205, 160, 130, 255], (y * 800 + x) * 4);
      }
    }

    const { result } = recognizeBoard(image, config, { timestamp: 0 });
    const score = scoreRecognition(expected, result.board.cells);

    expect(score.errors, JSON.stringify(score.errors)).toEqual([]);
    expect(score.unknown).toBeGreaterThan(0);
    expect(result.warnings.map((w) => w.code)).toContain('UNEXPECTED_OBJECTS');
  });

  it('flags a hand over the board as unexpected objects and never invents pieces', () => {
    const expected = startingPosition();
    // A skin-colored blob across rows 3–4 (empty rows) and light squares.
    const image = renderNormalizedBoard(expected);
    for (let y = 320; y < 480; y++) {
      for (let x = 150; x < 650; x++) {
        image.data.set([205, 160, 130, 255], (y * 800 + x) * 4);
      }
    }

    const { result } = recognizeBoard(image, config, { timestamp: 0 });

    expect(result.warnings.map((w) => w.code)).toContain('UNEXPECTED_OBJECTS');
    expect(result.status).toBe('UNCERTAIN');
    const score = scoreRecognition(expected, result.board.cells);
    // Rows 3–4 are covered: those squares may be wrong pieces or UNKNOWN, but rows 0–2 and 5–7 must be intact.
    const intact = score.errors.filter(
      (e) => Math.floor(e.index / 8) < 3 || Math.floor(e.index / 8) > 4,
    );
    expect(intact).toEqual([]);
  });
});
