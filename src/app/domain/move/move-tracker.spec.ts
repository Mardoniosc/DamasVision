import { position } from '../../../../tests/fixtures/engine-positions';
import { frames, observe } from '../../../../tests/fixtures/observations';
import { BoardObservation } from '../board/observation';
import { BoardState } from '../board/piece';
import { initialBoard } from '../engine/board-state';
import { BrazilianCheckersEngine } from '../engine/checkers-engine';
import { MoveInferenceResult } from './move-inference';
import { MoveTracker } from './move-tracker';

const engine = new BrazilianCheckersEngine();

function feed(
  tracker: MoveTracker,
  authoritative: BoardState,
  player: 'WHITE' | 'BLACK',
  observations: readonly BoardObservation[],
): MoveInferenceResult[] {
  return observations.flatMap((o) => tracker.observe(authoritative, player, o).inference ?? []);
}

describe('E5-T07 — idempotency and duplicate prevention', () => {
  const start = initialBoard();
  const move = engine.getLegalMoves(start, 'WHITE').find((m) => m.id === 'c3-d4');
  if (!move) throw new Error('setup');
  const moved = engine.applyMove(start, move);

  it('infers once per stable board, however many frames repeat it', () => {
    const tracker = new MoveTracker(engine);

    const results = feed(tracker, start, 'WHITE', frames(observe(moved), 20, 0));

    expect(results.map((r) => r.status)).toEqual(['MATCHED']);
  });

  it('after the commit, the same physical board can never commit the move again', () => {
    const tracker = new MoveTracker(engine);
    feed(tracker, start, 'WHITE', frames(observe(moved), 5, 0));

    // The controller committed: authoritative = moved, Black to move.
    const later = feed(tracker, moved, 'BLACK', frames(observe(moved), 10, 1000));

    expect(later.map((r) => [r.status, r.warnings])).toEqual([['NO_MATCH', ['BOARD_UNCHANGED']]]);
  });

  it('transitional frames (hand, lifted piece) never produce a move', () => {
    const tracker = new MoveTracker(engine);
    const hand = observe(start, { edits: { c3: 'UNKNOWN', d4: 'UNKNOWN', b4: 'UNKNOWN' } });
    const lifted = observe(start, { edits: { c3: 'EMPTY' } });
    const transition = [
      observe(start),
      hand,
      lifted,
      hand,
      observe(moved, { edits: { d4: 'UNKNOWN' } }),
    ].map((o, i) => ({ ...o, timestamp: i * 200 }));

    expect(feed(tracker, start, 'WHITE', transition)).toEqual([]);
    const settled = feed(tracker, start, 'WHITE', frames(observe(moved), 4, 1000));
    expect(settled.map((r) => r.selected?.move.id)).toEqual(['c3-d4']);
  });

  it('a capture: waits while the captured piece is on the board, then matches once', () => {
    const capture = position({ c3: 'WHITE', d4: 'BLACK', h8: 'BLACK' });
    const captureMove = engine.getLegalMoves(capture, 'WHITE')[0];
    if (!captureMove) throw new Error('setup');
    const captured = engine.applyMove(capture, captureMove);
    const tracker = new MoveTracker(engine);

    const waiting = feed(
      tracker,
      capture,
      'WHITE',
      frames(observe(captured, { edits: { d4: 'BLACK' } }), 6, 0),
    );
    const done = feed(tracker, capture, 'WHITE', frames(observe(captured), 6, 1400));

    expect(waiting.map((r) => [r.status, r.warnings[0]])).toEqual([
      ['WAITING_FOR_STABILITY', 'CAPTURED_PIECES_NOT_REMOVED'],
    ]);
    expect(done.map((r) => [r.status, r.selected?.move.id])).toEqual([['MATCHED', 'c3xe5']]);
  });

  it('reset starts over (after a pause or a correction)', () => {
    const tracker = new MoveTracker(engine);
    feed(tracker, start, 'WHITE', frames(observe(moved), 5, 0));
    tracker.reset();

    expect(feed(tracker, start, 'WHITE', frames(observe(moved), 5, 2000))).toHaveLength(1);
  });
});
