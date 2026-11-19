import { startingPosition } from '../../../../tests/fixtures/synthetic-board';
import { ObservedPiece, Piece } from '../../domain/board/piece';
import { evaluateRecognition, formatMetricsReport } from './recognition-metrics';

function image(
  name: string,
  edit: (observed: ObservedPiece[], labels: Piece[]) => void = () => undefined,
  conditions: string[] = [],
) {
  const labels: Piece[] = startingPosition();
  const observed: ObservedPiece[] = [...labels];
  edit(observed, labels);
  return { name, conditions, labels, observed };
}

describe('evaluateRecognition (G3 metrics)', () => {
  it('scores a perfect reading', () => {
    const metrics = evaluateRecognition([image('a')]);

    expect(metrics.total).toMatchObject({
      squares: 32,
      correct: 32,
      unknown: 0,
      wrong: 0,
      accuracy: 1,
    });
    expect(metrics.classes.find((c) => c.label === 'EMPTY')).toMatchObject({
      support: 8,
      precision: 1,
      recall: 1,
    });
    expect(metrics.classes.find((c) => c.label === 'WHITE_KING')).toMatchObject({
      support: 0,
      precision: null,
      recall: null,
    });
  });

  it('separates abstentions from confident errors and classifies each error', () => {
    const metrics = evaluateRecognition([
      image('a', (observed, labels) => {
        observed[1] = 'UNKNOWN'; // black man not decided
        observed[33] = 'WHITE'; // empty square invented as a piece
        observed[3] = 'WHITE'; // black man read white
        observed[5] = 'BLACK_KING'; // man read king
        labels[24] = 'BLACK'; // a piece lost: labeled black, read empty
      }),
    ]);

    expect(metrics.total).toMatchObject({ correct: 27, unknown: 1, wrong: 4 });
    expect(metrics.occupancy).toEqual({
      falsePositives: 1,
      falseNegatives: 1,
      unknownOnEmpty: 0,
      unknownOnOccupied: 1,
    });
    expect(metrics.colorErrors).toBe(1);
    expect(metrics.typeErrors).toBe(1);
    expect(metrics.confusion.BLACK.UNKNOWN).toBe(1);
    expect(metrics.confusion.EMPTY.WHITE).toBe(1);
    const empty = metrics.classes.find((c) => c.label === 'EMPTY');
    // Labeled empty: 8 − a5 = 7; read empty: 8 − b4 = 7; both: 8 − a5 − b4 = 6.
    expect(empty).toMatchObject({ support: 7, predicted: 7, truePositives: 6 });
    expect(metrics.errors.map((e) => e.square)).toEqual(['d8', 'f8', 'a5', 'b4']);
  });

  it('breaks results down per image and per capture condition', () => {
    const metrics = evaluateRecognition([
      image('a', () => undefined, ['LUZ_NATURAL']),
      image('b', (observed) => (observed[1] = 'UNKNOWN'), ['LUZ_ARTIFICIAL', 'SOMBRAS']),
    ]);

    expect(metrics.perImage.map((i) => [i.name, i.correct, i.unknown])).toEqual([
      ['a', 32, 0],
      ['b', 31, 1],
    ]);
    expect(metrics.perCondition['SOMBRAS']).toMatchObject({ squares: 32, unknown: 1 });
    expect(Object.keys(metrics.perCondition)).toEqual(['LUZ_ARTIFICIAL', 'LUZ_NATURAL', 'SOMBRAS']);
  });

  it('formats a markdown report with the confusion matrix', () => {
    const report = formatMetricsReport(evaluateRecognition([image('a')]), {
      title: 'Real samples',
      source: 'test',
    });

    expect(report).toContain('## Real samples');
    expect(report).toContain('**confident errors: 0**');
    expect(report).toContain('| EMPTY | 8 | 0 | 0 | 0 | 0 | 0 |');
  });
});
