import { isPlayableSquare, SQUARE_COUNT } from '../../domain/board/board';
import { squareName } from '../../domain/board/board-notation';
import { ObservedPiece, Piece } from '../../domain/board/piece';

/** Ground-truth classes (a label is never UNKNOWN). */
export const LABEL_CLASSES: readonly Piece[] = [
  'EMPTY',
  'WHITE',
  'BLACK',
  'WHITE_KING',
  'BLACK_KING',
];
/** Predicted classes: the labels plus UNKNOWN (an abstention, not an error). */
export const PREDICTED_CLASSES: readonly ObservedPiece[] = [...LABEL_CLASSES, 'UNKNOWN'];

/** One labeled image and what the recognizer read for it. */
export interface EvaluatedImage {
  readonly name: string;
  /** Capture conditions (labeled-sample `conditions`), for the per-condition breakdown. */
  readonly conditions: readonly string[];
  readonly labels: readonly Piece[];
  readonly observed: readonly ObservedPiece[];
}

export interface SquareError {
  readonly image: string;
  readonly square: string;
  readonly expected: Piece;
  readonly observed: ObservedPiece;
}

export interface ClassMetrics {
  readonly label: Piece;
  /** Squares whose label is this class. */
  readonly support: number;
  /** Squares read as this class (UNKNOWN excluded). */
  readonly predicted: number;
  readonly truePositives: number;
  /** Squares of this class read as UNKNOWN. */
  readonly unknown: number;
  /** TP / predicted — how often a reading of this class is right (null: never predicted). */
  readonly precision: number | null;
  /** TP / support, UNKNOWN counting as a miss (null: class absent). */
  readonly recall: number | null;
}

export interface CountSummary {
  readonly squares: number;
  readonly correct: number;
  readonly unknown: number;
  /** Confident errors: a wrong piece reported instead of UNKNOWN. */
  readonly wrong: number;
  readonly accuracy: number;
  readonly unknownRate: number;
}

export interface ImageMetrics extends CountSummary {
  readonly name: string;
  readonly conditions: readonly string[];
  readonly errors: readonly SquareError[];
}

export interface RecognitionMetrics {
  readonly images: number;
  readonly total: CountSummary;
  /** confusion[label][predicted] = squares. */
  readonly confusion: Readonly<Record<Piece, Readonly<Record<ObservedPiece, number>>>>;
  readonly classes: readonly ClassMetrics[];
  readonly occupancy: {
    /** Empty square read as a piece (the error that invents pieces). */
    readonly falsePositives: number;
    /** Occupied square read as EMPTY (the error that loses pieces). */
    readonly falseNegatives: number;
    readonly unknownOnEmpty: number;
    readonly unknownOnOccupied: number;
  };
  /** A piece read with the wrong color (kings included). */
  readonly colorErrors: number;
  /** Right color, wrong type (man ↔ king). */
  readonly typeErrors: number;
  readonly perImage: readonly ImageMetrics[];
  readonly perCondition: Readonly<Record<string, CountSummary>>;
  readonly errors: readonly SquareError[];
}

const colorOf = (piece: ObservedPiece): 'WHITE' | 'BLACK' | null =>
  piece === 'WHITE' || piece === 'WHITE_KING'
    ? 'WHITE'
    : piece === 'BLACK' || piece === 'BLACK_KING'
      ? 'BLACK'
      : null;

const ratio = (numerator: number, denominator: number): number | null =>
  denominator === 0 ? null : numerator / denominator;

function summarize(squares: number, correct: number, unknown: number): CountSummary {
  return {
    squares,
    correct,
    unknown,
    wrong: squares - correct - unknown,
    accuracy: ratio(correct, squares) ?? 0,
    unknownRate: ratio(unknown, squares) ?? 0,
  };
}

/** Metrics over the playable squares of every image (G3 evaluation, docs/vision/recognition.md). */
export function evaluateRecognition(images: readonly EvaluatedImage[]): RecognitionMetrics {
  const confusion = Object.fromEntries(
    LABEL_CLASSES.map((label) => [label, Object.fromEntries(PREDICTED_CLASSES.map((p) => [p, 0]))]),
  ) as Record<Piece, Record<ObservedPiece, number>>;
  const errors: SquareError[] = [];
  const perImage: ImageMetrics[] = [];
  let colorErrors = 0;
  let typeErrors = 0;

  for (const image of images) {
    let squares = 0;
    let correct = 0;
    let unknown = 0;
    const imageErrors: SquareError[] = [];
    for (let index = 0; index < SQUARE_COUNT; index++) {
      if (!isPlayableSquare(index)) continue;
      const expected = image.labels[index] ?? 'EMPTY';
      const observed = image.observed[index] ?? 'UNKNOWN';
      squares++;
      confusion[expected][observed]++;
      if (observed === expected) {
        correct++;
      } else if (observed === 'UNKNOWN') {
        unknown++;
      } else {
        const error = { image: image.name, square: squareName(index), expected, observed };
        imageErrors.push(error);
        const want = colorOf(expected);
        const got = colorOf(observed);
        if (want && got && want !== got) colorErrors++;
        if (want && got && want === got) typeErrors++;
      }
    }
    errors.push(...imageErrors);
    perImage.push({
      name: image.name,
      conditions: image.conditions,
      errors: imageErrors,
      ...summarize(squares, correct, unknown),
    });
  }

  const classes = LABEL_CLASSES.map((label): ClassMetrics => {
    const row = confusion[label];
    const support = PREDICTED_CLASSES.reduce((sum, p) => sum + row[p], 0);
    const predicted = LABEL_CLASSES.reduce((sum, l) => sum + confusion[l][label], 0);
    const truePositives = row[label];
    return {
      label,
      support,
      predicted,
      truePositives,
      unknown: row.UNKNOWN,
      precision: ratio(truePositives, predicted),
      recall: ratio(truePositives, support),
    };
  });

  const occupied = LABEL_CLASSES.filter((label) => label !== 'EMPTY');
  const pieces = occupied as readonly ObservedPiece[];
  const conditions = [...new Set(perImage.flatMap((image) => image.conditions))].sort();
  const perCondition = Object.fromEntries(
    conditions.map((condition) => {
      const subset = perImage.filter((image) => image.conditions.includes(condition));
      const sum = (key: 'squares' | 'correct' | 'unknown') =>
        subset.reduce((total, image) => total + image[key], 0);
      return [condition, summarize(sum('squares'), sum('correct'), sum('unknown'))];
    }),
  );
  const totals = (key: 'squares' | 'correct' | 'unknown') =>
    perImage.reduce((total, image) => total + image[key], 0);

  return {
    images: images.length,
    total: summarize(totals('squares'), totals('correct'), totals('unknown')),
    confusion,
    classes,
    occupancy: {
      falsePositives: pieces.reduce((sum, p) => sum + confusion.EMPTY[p], 0),
      falseNegatives: occupied.reduce((sum, label) => sum + confusion[label].EMPTY, 0),
      unknownOnEmpty: confusion.EMPTY.UNKNOWN,
      unknownOnOccupied: occupied.reduce((sum, label) => sum + confusion[label].UNKNOWN, 0),
    },
    colorErrors,
    typeErrors,
    perImage,
    perCondition,
    errors,
  };
}

const percent = (value: number | null): string =>
  value === null ? '—' : `${(Math.round(value * 1000) / 10).toFixed(1)}%`;

/** Markdown report of the metrics (docs/vision/recognition-metrics.md). */
export function formatMetricsReport(
  metrics: RecognitionMetrics,
  options: { readonly title: string; readonly source: string },
): string {
  const { total, occupancy } = metrics;
  const lines: string[] = [
    `## ${options.title}`,
    '',
    options.source,
    '',
    `- Images: ${metrics.images} · playable squares: ${total.squares}`,
    `- Correct: ${total.correct} (${percent(total.accuracy)}) · UNKNOWN: ${total.unknown} (${percent(total.unknownRate)}) · **confident errors: ${total.wrong}**`,
    `- Occupancy: false positives (empty → piece) ${occupancy.falsePositives} · false negatives (piece → empty) ${occupancy.falseNegatives} · UNKNOWN on empty ${occupancy.unknownOnEmpty} · UNKNOWN on occupied ${occupancy.unknownOnOccupied}`,
    `- Color errors: ${metrics.colorErrors} · type (man ↔ king) errors: ${metrics.typeErrors}`,
    '',
    '### Per class',
    '',
    '| Class | Support | Predicted | Correct | UNKNOWN | Precision | Recall |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...metrics.classes.map(
      (c) =>
        `| ${c.label} | ${c.support} | ${c.predicted} | ${c.truePositives} | ${c.unknown} | ${percent(c.precision)} | ${percent(c.recall)} |`,
    ),
    '',
    '### Confusion matrix (rows: label, columns: reading)',
    '',
    `| Label \\ reading | ${PREDICTED_CLASSES.join(' | ')} |`,
    `| --- | ${PREDICTED_CLASSES.map(() => '---:').join(' | ')} |`,
    ...LABEL_CLASSES.map(
      (label) =>
        `| ${label} | ${PREDICTED_CLASSES.map((p) => metrics.confusion[label][p]).join(' | ')} |`,
    ),
    '',
    '### Per image',
    '',
    '| Image | Conditions | Correct | UNKNOWN | Wrong | Errors |',
    '| --- | --- | ---: | ---: | ---: | --- |',
    ...metrics.perImage.map(
      (image) =>
        `| ${image.name} | ${image.conditions.join(', ') || '—'} | ${image.correct}/${image.squares} | ${image.unknown} | ${image.wrong} | ${
          image.errors.map((e) => `${e.square}: ${e.expected} → ${e.observed}`).join('; ') || '—'
        } |`,
    ),
  ];
  const conditions = Object.entries(metrics.perCondition);
  if (conditions.length > 0) {
    lines.push(
      '',
      '### Per condition',
      '',
      '| Condition | Squares | Accuracy | UNKNOWN | Wrong |',
      '| --- | ---: | ---: | ---: | ---: |',
      ...conditions.map(
        ([condition, s]) =>
          `| ${condition} | ${s.squares} | ${percent(s.accuracy)} | ${percent(s.unknownRate)} | ${s.wrong} |`,
      ),
    );
  }
  return lines.join('\n') + '\n';
}
