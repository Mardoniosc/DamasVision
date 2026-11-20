import { resolveClassifierConfig } from '../../src/app/vision/recognition/classifier.config';
import { recognizeBoard } from '../../src/app/vision/recognition/recognize-board';
import { DEFAULT_VISION_CONFIG } from '../../src/app/vision/vision.config';
import { EMPTY_SCENARIOS } from '../fixtures/empty-scenarios';
import { renderNormalizedBoard } from '../fixtures/synthetic-board';

/**
 * EMPTY-specific suite (G3). An empty square read as a piece invents a piece (and, later,
 * a move), so on every scenario below no empty square may be read as a piece. Synthetic:
 * these are regression scenarios for known failure modes, not evidence of field accuracy
 * (that comes from tests/fixtures/real-samples).
 */
const config = resolveClassifierConfig(DEFAULT_VISION_CONFIG);
const UP = { x: 0, y: -1 };

describe('EMPTY squares are never read as pieces (G3)', () => {
  for (const scenario of EMPTY_SCENARIOS) {
    it(scenario.name, () => {
      const expected = scenario.position();
      const image = renderNormalizedBoard(expected, scenario.options);
      scenario.paint?.(image);
      const away = scenario.options.pieceHeight ? UP : null;

      const { traces } = recognizeBoard(image, config, { timestamp: 0, awayFromCamera: away });

      const empty = traces.filter((t) => expected[t.squareIndex] === 'EMPTY');
      const invented = empty.filter((t) => t.piece !== 'EMPTY' && t.piece !== 'UNKNOWN');
      expect(invented.map((t) => t.explanation)).toEqual([]);
      const occupied = traces.filter((t) => expected[t.squareIndex] !== 'EMPTY');
      const wrong = occupied.filter(
        (t) => t.piece !== 'UNKNOWN' && t.piece !== expected[t.squareIndex],
      );
      expect(wrong.map((t) => t.explanation)).toEqual([]);
      if (scenario.minEmptyRecall !== undefined) {
        const recall = empty.filter((t) => t.piece === 'EMPTY').length / empty.length;
        expect(recall).toBeGreaterThanOrEqual(scenario.minEmptyRecall);
      }
    });
  }
});
