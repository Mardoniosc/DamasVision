import { isKing, pieceColor, PlayerColor } from '../board/piece';
import { opponentOf } from '../game/game-result';
import { moveKey } from '../move/move';
import { boardIssues, initialBoard, parseBoard, serializeBoard } from './board-state';
import { BrazilianCheckersEngine } from './checkers-engine';
import { evaluateDraw, PositionRecord } from './draw-rules';

/**
 * Property checks over seeded random games (E4, Gate G4): every legal move keeps the board
 * valid and obeys the rules' invariants. Deterministic: same seeds, same games.
 */
const engine = new BrazilianCheckersEngine();

function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const count = (cells: readonly string[], player: PlayerColor) =>
  cells.filter((cell) => pieceColor(cell as never) === player).length;

describe('engine invariants over random games', () => {
  const GAMES = 40;
  const MAX_PLIES = 200;

  it(`${GAMES} seeded games: valid boards, mandatory captures, majority rule, consistent results`, () => {
    const endings = new Map<string, number>();
    let capturesSeen = 0;
    let kingsSeen = 0;

    for (let seed = 1; seed <= GAMES; seed++) {
      const next = random(seed);
      let board = initialBoard();
      let player: PlayerColor = 'WHITE';
      const history: PositionRecord[] = [{ board, playerToMove: player, lastMove: null }];
      let ending = 'MAX_PLIES';

      for (let ply = 0; ply < MAX_PLIES; ply++) {
        const result = engine.getResult(board, player);
        const draw = result ? null : evaluateDraw(history);
        if (result || draw) {
          ending = (result ?? draw)?.reason ?? 'unknown';
          break;
        }
        const moves = engine.getLegalMoves(board, player);
        expect(moves.length).toBeGreaterThan(0);

        // All moves capture the same (maximal) number of pieces, and keys are unique.
        const capturedCounts = new Set(moves.map((m) => m.capturedSquares.length));
        expect(capturedCounts.size).toBe(1);
        expect(new Set(moves.map(moveKey)).size).toBe(moves.length);

        const move = moves[Math.floor(next() * moves.length)];
        if (!move) throw new Error('no move');
        expect(engine.validateMove(board, player, move)).toBe(true);
        expect(pieceColor(move.pieceBefore)).toBe(player);
        expect(new Set(move.capturedSquares).size).toBe(move.capturedSquares.length);
        expect(
          move.capturedSquares.every(
            (s) => pieceColor(board.cells[s] ?? 'EMPTY') === opponentOf(player),
          ),
        ).toBe(true);

        const after = engine.applyMove(board, move);
        expect(boardIssues(after)).toEqual([]);
        expect(count(after.cells, player)).toBe(count(board.cells, player));
        expect(count(after.cells, opponentOf(player))).toBe(
          count(board.cells, opponentOf(player)) - move.capturedSquares.length,
        );
        expect(parseBoard(serializeBoard(after))).toEqual(after);
        if (move.capturedSquares.length > 0) capturesSeen++;
        if (move.promotion) kingsSeen++;
        if (isKing(move.pieceBefore)) expect(move.promotion).toBe(false);

        board = after;
        player = opponentOf(player);
        history.push({ board, playerToMove: player, lastMove: move });
      }
      endings.set(ending, (endings.get(ending) ?? 0) + 1);
    }

    // The random games exercise captures, promotions and several endings.
    expect(capturesSeen).toBeGreaterThan(100);
    expect(kingsSeen).toBeGreaterThan(5);
    expect(endings.size).toBeGreaterThan(1);
  });
});
