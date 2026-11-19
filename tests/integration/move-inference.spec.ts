import { PLAYABLE_SQUARES } from '../../src/app/domain/board/board';
import { BoardObservation } from '../../src/app/domain/board/observation';
import { BoardState, ObservedPiece, PlayerColor } from '../../src/app/domain/board/piece';
import { initialBoard } from '../../src/app/domain/engine/board-state';
import { BrazilianCheckersEngine } from '../../src/app/domain/engine/checkers-engine';
import { opponentOf } from '../../src/app/domain/game/game-result';
import { Move } from '../../src/app/domain/move/move';
import { MoveInferenceStatus } from '../../src/app/domain/move/move-inference';
import { PIPELINE_INFERENCE_CONFIG } from '../../src/app/domain/move/inference.config';
import { MoveTracker } from '../../src/app/domain/move/move-tracker';
import { FrameAssessment } from '../../src/app/vision/recognition/recognize-board';
import { ObservationStabilizer } from '../../src/app/vision/recognition/temporal/observation-stabilizer';
import { DEFAULT_VISION_CONFIG } from '../../src/app/vision/vision.config';
import { recognitionResultFrom } from '../fixtures/recognition-results';
import { random } from '../fixtures/synthetic-board';

/**
 * Gate G5 — synthetic observation tests infer legal moves. Seeded random games are
 * "played" as the camera would see them, one frame every 200 ms, through the same chain as
 * the app: per-frame readings → per-square stabilizer (G3) → stable board detector and
 * inference (E5). A physical move is:
 *   hand over the piece → piece lifted → piece placed (captured pieces still on the board)
 *   → captured pieces removed one by one → still board while the opponent thinks (1–3 s).
 * Noise on every frame: an occasional UNKNOWN square and an occasional misread piece.
 * The tracker must infer the move played, once, and never commit anything else.
 */
const engine = new BrazilianCheckersEngine();
const INTERVAL = DEFAULT_VISION_CONFIG.analysisIntervalMs;
const GOOD_FRAME: FrameAssessment = {
  sharpness: 90,
  meanLuminance: 0.5,
  alignmentQuality: 1,
  issues: [],
};
const MISREADS: readonly ObservedPiece[] = ['EMPTY', 'WHITE', 'BLACK', 'WHITE_KING', 'BLACK_KING'];

interface Stats {
  moves: number;
  matched: number;
  falseCommits: number;
  captures: number;
  promotions: number;
  missed: string[];
  /** ms from the frame where the move's squares are visible and settled to MATCHED. */
  latencies: number[];
  statuses: Map<MoveInferenceStatus, number>;
}

/** Frames (cells) of a physical move, from the board before to the board after. */
function physicalMove(before: BoardState, move: Move, next: () => number): ObservedPiece[][] {
  const sequence: ObservedPiece[][] = [];
  const hold = (cells: readonly ObservedPiece[], count: number) => {
    for (let i = 0; i < count; i++) sequence.push([...cells]);
  };
  const board: ObservedPiece[] = [...before.cells];
  const hand = [...board];
  hand[move.from] = 'UNKNOWN';
  hand[move.to] = 'UNKNOWN';
  hold(hand, 1 + Math.floor(next() * 3));
  board[move.from] = 'EMPTY';
  hold(board, 1 + Math.floor(next() * 5)); // lifted
  board[move.to] = move.pieceAfter;
  hold(board, 1 + Math.floor(next() * 8)); // placed, captured pieces still there
  for (const square of move.capturedSquares) {
    board[square] = 'EMPTY';
    hold(board, 1 + Math.floor(next() * 5));
  }
  hold(board, 5 + Math.floor(next() * 11)); // the opponent thinks: 1–3 s
  return sequence.map((cells) => {
    const noisy = [...cells];
    if (next() < 0.15) noisy[PLAYABLE_SQUARES[Math.floor(next() * 32)] ?? 1] = 'UNKNOWN';
    if (next() < 0.05) {
      noisy[PLAYABLE_SQUARES[Math.floor(next() * 32)] ?? 1] =
        MISREADS[Math.floor(next() * 5)] ?? 'EMPTY';
    }
    return noisy;
  });
}

function playGame(seed: number, stats: Stats): void {
  const next = random(seed);
  const stabilizer = new ObservationStabilizer({
    windowSize: DEFAULT_VISION_CONFIG.stabilityWindowSize,
    minAgreeing: DEFAULT_VISION_CONFIG.stableObservationCount,
    maxAgeMs: DEFAULT_VISION_CONFIG.stabilityWindowSize * INTERVAL * 2,
    acceptable: DEFAULT_VISION_CONFIG.confidenceThresholds.acceptable,
  });
  const tracker = new MoveTracker(engine, PIPELINE_INFERENCE_CONFIG);
  let board = initialBoard();
  let player: PlayerColor = 'WHITE';
  let time = 0;
  const see = (cells: readonly ObservedPiece[]): BoardObservation => {
    time += INTERVAL;
    const reading = recognitionResultFrom(cells, { timestamp: time });
    stabilizer.push(reading, GOOD_FRAME);
    return stabilizer.stableResult(reading).board;
  };
  // The game starts on a confirmed, still board.
  for (let i = 0; i < 6; i++) tracker.observe(board, player, see(board.cells));

  for (let ply = 0; ply < 80; ply++) {
    const moves = engine.getLegalMoves(board, player);
    if (moves.length === 0) return;
    const played = moves[Math.floor(next() * moves.length)] as Move;
    stats.moves++;
    if (played.capturedSquares.length > 0) stats.captures++;
    if (played.promotion) stats.promotions++;

    let committed: Move | null = null;
    const expected = engine.simulateMove(board, played).cells;
    const changed = expected.flatMap((cell, i) => (cell !== board.cells[i] ? [i] : []));
    let settledAt: number | null = null;
    const seen: string[] = [];
    for (const cells of physicalMove(board, played, next)) {
      const observation = see(cells);
      if (settledAt === null && changed.every((i) => cells[i] === expected[i])) settledAt = time;
      const inference = tracker.observe(board, player, observation).inference;
      if (!inference) continue;
      seen.push(`${inference.status}/${inference.warnings.join(',')}`);
      stats.statuses.set(inference.status, (stats.statuses.get(inference.status) ?? 0) + 1);
      if (inference.status === 'MATCHED' && inference.selected && !committed) {
        committed = inference.selected.move;
        stats.latencies.push(time - (settledAt ?? time));
        if (committed.id !== played.id) stats.falseCommits++;
      }
    }
    if (committed?.id === played.id) stats.matched++;
    else stats.missed.push(`seed ${seed} ${played.id}: ${seen.join(' > ') || 'never stable'}`);
    // Committed automatically, or confirmed by the user (manual path).
    board = engine.applyMove(board, played);
    player = opponentOf(player);
  }
}

describe('G5 — move inference from synthetic observation sequences', () => {
  it(
    'infers the played move, once, with zero false commits (30 seeded games)',
    { timeout: 30_000 },
    () => {
      const stats: Stats = {
        moves: 0,
        matched: 0,
        falseCommits: 0,
        captures: 0,
        promotions: 0,
        missed: [],
        latencies: [],
        statuses: new Map(),
      };
      for (let seed = 1; seed <= 30; seed++) playGame(seed, stats);

      const latencies = [...stats.latencies].sort((a, b) => a - b);
      const median = latencies[Math.floor(latencies.length / 2)] ?? Infinity;

      expect(stats.falseCommits).toBe(0);
      expect(stats.captures).toBeGreaterThan(50);
      expect(stats.promotions).toBeGreaterThan(3);
      // Spec §16 targets: simple moves ≥ 95 %, captures ≥ 90 %.
      expect(
        stats.matched / stats.moves,
        stats.missed.slice(0, 10).join('\n'),
      ).toBeGreaterThanOrEqual(0.98);
      // Spec §16: confirmation within about 1 s of the board settling.
      expect(median).toBeLessThanOrEqual(1000);
    },
  );
});
