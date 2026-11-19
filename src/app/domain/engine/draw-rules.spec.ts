import { BoardState, Piece, PlayerColor } from '../board/piece';
import { opponentOf } from '../game/game-result';
import { Move } from '../move/move';
import { initialBoard } from './board-state';
import { BrazilianCheckersEngine } from './checkers-engine';
import { evaluateDraw, PositionRecord } from './draw-rules';
import { position } from '../../../../tests/fixtures/engine-positions';

const engine = new BrazilianCheckersEngine();

/** Plays legal moves given by id (throws otherwise), recording every position. */
function play(start: BoardState, first: PlayerColor, moves: readonly string[]): PositionRecord[] {
  const history: PositionRecord[] = [{ board: start, playerToMove: first, lastMove: null }];
  let board = start;
  let player = first;
  for (const id of moves) {
    const move: Move | undefined = engine.getLegalMoves(board, player).find((m) => m.id === id);
    if (!move) throw new Error(`${id} is not legal for ${player}`);
    board = engine.applyMove(board, move);
    player = opponentOf(player);
    history.push({ board, playerToMove: player, lastMove: move });
  }
  return history;
}

const move = (pieceBefore: Piece, captured = false): Move => ({
  id: 'synthetic',
  from: 0,
  to: 0,
  path: [],
  capturedSquares: captured ? [1] : [],
  promotion: false,
  pieceBefore,
  pieceAfter: pieceBefore,
});

/** Distinct white-king squares, so constructed positions never repeat. */
const SQUARES = [
  'a1',
  'c1',
  'e1',
  'g1',
  'b2',
  'd2',
  'f2',
  'h2',
  'a3',
  'c3',
  'e3',
  'g3',
  'b4',
  'd4',
  'f4',
  'h4',
  'a5',
  'c5',
  'e5',
  'g5',
  'b6',
];

/** A constructed history: position i has a white king on SQUARES[i] plus `others`. */
function history(
  length: number,
  others: Readonly<Record<string, Piece>>,
  lastMove: (i: number) => Move,
) {
  return Array.from({ length }, (_, i): PositionRecord => ({
    board: position({ ...others, [SQUARES[i] as string]: 'WHITE_KING' }),
    playerToMove: i % 2 === 0 ? 'WHITE' : 'BLACK',
    lastMove: i === 0 ? null : lastMove(i),
  }));
}

/*
 * Played routes: white kings stay on files a–b and black kings on files g–h, at most
 * 4 rows apart, so they never share a diagonal and no capture is ever possible.
 */
const TWO_V_ONE = position({ a1: 'WHITE_KING', a3: 'WHITE_KING', h4: 'BLACK_KING' });
const SHUFFLE = [
  'a1-b2',
  'h4-g5',
  'a3-b4',
  'g5-h6',
  'b2-a1',
  'h6-g5',
  'b4-a3',
  'g5-h4',
  'a1-b2',
  'h4-g5',
];

describe('E4-T07 — draw rules (history)', () => {
  it('no draw at the start or after ordinary moves', () => {
    expect(evaluateDraw([])).toBeNull();
    expect(evaluateDraw(play(initialBoard(), 'WHITE', ['c3-d4', 'f6-e5']))).toBeNull();
  });

  it('the same position with the same player to move for the third time is a draw', () => {
    const start = position({ a1: 'WHITE_KING', h4: 'BLACK_KING', b6: 'WHITE', g3: 'BLACK' });
    const cycle = ['a1-b2', 'h4-g5', 'b2-a1', 'g5-h4'];

    expect(evaluateDraw(play(start, 'WHITE', cycle))).toBeNull(); // second occurrence
    expect(evaluateDraw(play(start, 'WHITE', [...cycle, ...cycle]))).toEqual({
      status: 'DRAW',
      reason: 'THREEFOLD_REPETITION',
    });
  });

  it('20 successive king moves without capture or man move are a draw (played)', () => {
    const start = position({ a1: 'WHITE_KING', g1: 'BLACK_KING' });
    // Up the edges and back: no position occurs three times.
    const route = [
      'a1-b2',
      'g1-h2',
      'b2-a3',
      'h2-g3',
      'a3-b4',
      'g3-h4',
      'b4-a5',
      'h4-g5',
      'a5-b6',
      'g5-h6',
      'b6-a7',
      'h6-g7',
      'a7-b8',
      'g7-h8',
      'b8-a7',
      'h8-g7',
      'a7-b6',
      'g7-h6',
      'b6-a5',
      'h6-g5',
    ];

    expect(evaluateDraw(play(start, 'WHITE', route.slice(0, 19)))).toBeNull();
    expect(evaluateDraw(play(start, 'WHITE', route))).toEqual({
      status: 'DRAW',
      reason: 'TWENTY_KING_MOVES',
    });
  });

  it('a man move or a capture restarts the king-move count', () => {
    const others = { h8: 'BLACK_KING', e7: 'BLACK', c7: 'WHITE' } as const;

    expect(evaluateDraw(history(21, others, () => move('WHITE_KING')))).toEqual({
      status: 'DRAW',
      reason: 'TWENTY_KING_MOVES',
    });
    expect(
      evaluateDraw(history(21, others, (i) => move(i === 11 ? 'WHITE' : 'WHITE_KING'))),
    ).toBeNull();
    expect(evaluateDraw(history(21, others, (i) => move('WHITE_KING', i === 11)))).toBeNull();
  });

  it('2 kings vs 1 king: drawn when not won within 5 moves each (played)', () => {
    expect(evaluateDraw(play(TWO_V_ONE, 'WHITE', SHUFFLE.slice(0, 9)))).toBeNull();
    expect(evaluateDraw(play(TWO_V_ONE, 'WHITE', SHUFFLE))).toEqual({
      status: 'DRAW',
      reason: 'ENDGAME_FIVE_MOVES',
    });
  });

  it.each([
    ['2 kings + 1 man vs 1 king', { b8: 'WHITE_KING', d6: 'WHITE', h8: 'BLACK_KING' }],
    ['1 king + 2 men vs 1 king', { d6: 'WHITE', f6: 'WHITE', h8: 'BLACK_KING' }],
    ['black stronger: 2 kings vs 1 king', { b8: 'BLACK_KING', d8: 'BLACK_KING' }],
  ] as const)('%s is a short ending', (_label, others) => {
    // In the last case the white king of each position is the lone king.
    expect(evaluateDraw(history(10, others, () => move('WHITE_KING')))).toBeNull();
    expect(evaluateDraw(history(11, others, () => move('WHITE_KING')))).toEqual({
      status: 'DRAW',
      reason: 'ENDGAME_FIVE_MOVES',
    });
  });

  it('other endings are not short endings (3 kings vs 1)', () => {
    const start = position({
      a1: 'WHITE_KING',
      a3: 'WHITE_KING',
      a5: 'WHITE_KING',
      h4: 'BLACK_KING',
    });

    expect(evaluateDraw(play(start, 'WHITE', SHUFFLE))).toBeNull();
  });

  it('the short-ending count restarts when the material changes', () => {
    const withMan = history(6, { b8: 'WHITE_KING', d6: 'WHITE', h8: 'BLACK_KING' }, () =>
      move('WHITE_KING'),
    );
    const without = history(16, { b8: 'WHITE_KING', h8: 'BLACK_KING' }, () =>
      move('WHITE_KING'),
    ).slice(6);

    // 2K+1M v 1K for 6 positions, then 2K v 1K for 10 positions: 9 plies since it arose.
    expect(evaluateDraw([...withMan, ...without])).toBeNull();
  });
});
