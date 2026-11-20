import { PLAYABLE_SQUARES, SquareIndex } from '../board/board';
import { BoardObservation } from '../board/observation';
import { BoardState, Piece, pieceColor, PlayerColor } from '../board/piece';
import { boardProblems, BoardProblem, initialBoard } from '../engine/board-state';
import { CheckersEngine } from '../engine/checkers-engine';
import { evaluateDraw, PositionRecord } from '../engine/draw-rules';
import { Move } from '../move/move';
import { BRAZILIAN_RULES } from '../rules/brazilian-rules';
import { GameResult, opponentOf } from './game-result';

/** Spec §5. */
export type GameStatus = 'ACTIVE' | 'PAUSED' | 'FINISHED' | 'RECONCILIATION_REQUIRED';

/** Spec §5. */
export interface GameMoveRecord {
  readonly id: string;
  readonly gameId: string;
  readonly ply: number;
  readonly player: PlayerColor;
  readonly move: Move;
  readonly beforeBoard: BoardState;
  readonly afterBoard: BoardState;
  readonly timestamp: string;
  readonly source: 'VISION' | 'MANUAL';
  readonly confidence?: number;
}

/**
 * An explicit change of the authoritative position that is not a move (spec §8
 * "Recovery": authoritative position changes must be explicit and recorded).
 */
export interface PositionAdjustment {
  readonly kind: 'UNDO' | 'POSITION_CORRECTION';
  /** Number of moves in the session when the adjustment was made. */
  readonly ply: number;
  readonly timestamp: string;
  readonly before: BoardState;
  readonly after: BoardState;
  readonly playerToMove: PlayerColor;
  readonly reason: string;
}

/**
 * Spec §5 `GameSession`, plus `initialBoard`/`initialPlayer` (as in `PersistedGame`) and
 * the audit of explicit position adjustments (ADR-039).
 */
export interface GameSession {
  readonly id: string;
  readonly status: GameStatus;
  readonly board: BoardState;
  readonly currentPlayer: PlayerColor;
  readonly moves: readonly GameMoveRecord[];
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly result?: GameResult;
  readonly calibrationId?: string;
  readonly whitePlayerLabel: string;
  readonly blackPlayerLabel: string;
  readonly initialBoard: BoardState;
  readonly initialPlayer: PlayerColor;
  readonly adjustments: readonly PositionAdjustment[];
}

export type InitialPositionProblem =
  | { readonly code: 'UNKNOWN_SQUARES'; readonly squares: readonly SquareIndex[] }
  | { readonly code: 'INVALID_BOARD'; readonly problem: BoardProblem }
  | { readonly code: 'MISSING_SIDE'; readonly color: PlayerColor };

export interface InitialPositionValidation {
  readonly valid: boolean;
  readonly problems: readonly InitialPositionProblem[];
  /** The board to start from when valid. */
  readonly board: BoardState | null;
  /** True for the standard opening position. */
  readonly isStandard: boolean;
}

/**
 * E6-T02 — the confirmed observation must be a complete, legal position before a game can
 * start from it: no UNKNOWN square, a valid board (engine rules) and pieces of both sides.
 * A non-standard position is allowed (the players continue a game) but is reported.
 */
export function validateInitialPosition(
  observation: Pick<BoardObservation, 'cells'>,
): InitialPositionValidation {
  const unknown = PLAYABLE_SQUARES.filter((square) => observation.cells[square] === 'UNKNOWN');
  if (unknown.length > 0) {
    return {
      valid: false,
      problems: [{ code: 'UNKNOWN_SQUARES', squares: unknown }],
      board: null,
      isStandard: false,
    };
  }
  const board: BoardState = { cells: observation.cells as readonly Piece[] };
  const problems: InitialPositionProblem[] = boardProblems(board).map((problem) => ({
    code: 'INVALID_BOARD' as const,
    problem,
  }));
  for (const color of ['WHITE', 'BLACK'] as const) {
    if (!board.cells.some((cell) => pieceColor(cell) === color)) {
      problems.push({ code: 'MISSING_SIDE', color });
    }
  }
  const valid = problems.length === 0;
  return {
    valid,
    problems,
    board: valid ? { cells: [...board.cells] } : null,
    isStandard: valid && board.cells.every((cell, i) => cell === initialBoard().cells[i]),
  };
}

export interface NewGame {
  readonly id: string;
  readonly board: BoardState;
  readonly playerToMove?: PlayerColor;
  readonly whitePlayerLabel: string;
  readonly blackPlayerLabel: string;
  readonly timestamp: string;
  readonly calibrationId?: string;
}

export function createGameSession(game: NewGame): GameSession {
  return {
    id: game.id,
    status: 'ACTIVE',
    board: game.board,
    currentPlayer: game.playerToMove ?? BRAZILIAN_RULES.firstPlayer,
    moves: [],
    startedAt: game.timestamp,
    updatedAt: game.timestamp,
    whitePlayerLabel: game.whitePlayerLabel.trim() || 'Brancas',
    blackPlayerLabel: game.blackPlayerLabel.trim() || 'Pretas',
    initialBoard: game.board,
    initialPlayer: game.playerToMove ?? BRAZILIAN_RULES.firstPlayer,
    adjustments: [],
    ...(game.calibrationId ? { calibrationId: game.calibrationId } : {}),
  };
}

export type CommitFailure = 'NOT_ACTIVE' | 'STALE' | 'ILLEGAL';

export class CommitError extends Error {
  constructor(readonly reason: CommitFailure) {
    super(`move not committed: ${reason}`);
    this.name = 'CommitError';
  }
}

export interface CommitRequest {
  readonly move: Move;
  readonly source: 'VISION' | 'MANUAL';
  readonly confidence?: number;
  readonly timestamp: string;
  /**
   * The number of moves the session had when the move was proposed. A different value
   * means the session moved on (a repeated frame, a double click): the commit is STALE
   * and rejected — duplicate prevention (spec §8 "Commit protocol").
   */
  readonly expectedPly: number;
}

/**
 * E6-T03 — validates the move against the current authoritative state, applies it,
 * records it and evaluates the result (win first, then the history-based draws). Pure:
 * the caller persists the returned session and keeps the old one if that fails.
 */
export function commitMove(
  session: GameSession,
  request: CommitRequest,
  engine: CheckersEngine,
): GameSession {
  if (session.status !== 'ACTIVE' && session.status !== 'RECONCILIATION_REQUIRED') {
    throw new CommitError('NOT_ACTIVE');
  }
  if (request.expectedPly !== session.moves.length) throw new CommitError('STALE');
  if (!engine.validateMove(session.board, session.currentPlayer, request.move)) {
    throw new CommitError('ILLEGAL');
  }
  const afterBoard = engine.applyMove(session.board, request.move);
  const ply = session.moves.length + 1;
  const record: GameMoveRecord = {
    id: `${session.id}-${ply}`,
    gameId: session.id,
    ply,
    player: session.currentPlayer,
    move: request.move,
    beforeBoard: session.board,
    afterBoard,
    timestamp: request.timestamp,
    source: request.source,
    ...(request.confidence !== undefined ? { confidence: request.confidence } : {}),
  };
  const next: GameSession = {
    ...session,
    status: 'ACTIVE',
    board: afterBoard,
    currentPlayer: opponentOf(session.currentPlayer),
    moves: [...session.moves, record],
    updatedAt: request.timestamp,
  };
  const result = evaluateResult(next, engine);
  return result ? { ...next, status: 'FINISHED', result } : next;
}

/** Win (engine) first, then the draw rules over the history since the last adjustment. */
export function evaluateResult(session: GameSession, engine: CheckersEngine): GameResult | null {
  const win = engine.getResult(session.board, session.currentPlayer);
  if (win) return win;
  return evaluateDraw(positionHistory(session));
}

/** Positions since the start or the last explicit position correction. */
export function positionHistory(session: GameSession): PositionRecord[] {
  const lastCorrection = [...session.adjustments]
    .reverse()
    .find((adjustment) => adjustment.kind === 'POSITION_CORRECTION');
  const fromPly = lastCorrection?.ply ?? 0;
  const start: PositionRecord = lastCorrection
    ? { board: lastCorrection.after, playerToMove: lastCorrection.playerToMove, lastMove: null }
    : { board: session.initialBoard, playerToMove: session.initialPlayer, lastMove: null };
  const records = session.moves
    .filter((record) => record.ply > fromPly)
    .map((record) => ({
      board: record.afterBoard,
      playerToMove: opponentOf(record.player),
      lastMove: record.move,
    }));
  return [start, ...records];
}

/**
 * E6-T06 — undo is robust here because every record keeps the exact board before the
 * move: the last move is removed, the position and side to move restored, and the undo is
 * recorded. Undoing past a position correction is not allowed (history would not be exact).
 */
export function undoLastMove(
  session: GameSession,
  timestamp: string,
  reason = 'Desfazer',
): GameSession {
  const last = session.moves[session.moves.length - 1];
  const lastCorrection = [...session.adjustments]
    .reverse()
    .find((adjustment) => adjustment.kind === 'POSITION_CORRECTION');
  if (!last || (lastCorrection && last.ply <= lastCorrection.ply)) {
    throw new CommitError('ILLEGAL');
  }
  const rest = withoutResult(session);
  return {
    ...rest,
    status: 'ACTIVE',
    board: last.beforeBoard,
    currentPlayer: last.player,
    moves: session.moves.slice(0, -1),
    updatedAt: timestamp,
    adjustments: [
      ...session.adjustments,
      {
        kind: 'UNDO',
        ply: session.moves.length,
        timestamp,
        before: session.board,
        after: last.beforeBoard,
        playerToMove: last.player,
        reason,
      },
    ],
  };
}

/**
 * Recovery — sets the authoritative position explicitly (the physical board was disturbed,
 * a move was missed). Only a valid board is accepted; the change is recorded and the
 * history-based draw rules restart from it.
 */
export function correctPosition(
  session: GameSession,
  board: BoardState,
  playerToMove: PlayerColor,
  timestamp: string,
  reason: string,
  engine: CheckersEngine,
): GameSession {
  const validation = validateInitialPosition(board);
  if (!validation.valid || !validation.board) throw new CommitError('ILLEGAL');
  const rest = withoutResult(session);
  const corrected: GameSession = {
    ...rest,
    status: 'ACTIVE',
    board: validation.board,
    currentPlayer: playerToMove,
    updatedAt: timestamp,
    adjustments: [
      ...session.adjustments,
      {
        kind: 'POSITION_CORRECTION',
        ply: session.moves.length,
        timestamp,
        before: session.board,
        after: validation.board,
        playerToMove,
        reason,
      },
    ],
  };
  const win = engine.getResult(corrected.board, corrected.currentPlayer);
  return win ? { ...corrected, status: 'FINISHED', result: win } : corrected;
}

/** The session without a result (the game continues). */
function withoutResult(session: GameSession): Omit<GameSession, 'result'> {
  const copy: { -readonly [K in keyof GameSession]?: GameSession[K] } = { ...session };
  delete copy.result;
  return copy as Omit<GameSession, 'result'>;
}

export function setStatus(
  session: GameSession,
  status: 'ACTIVE' | 'PAUSED' | 'RECONCILIATION_REQUIRED',
  timestamp: string,
): GameSession {
  if (session.status === 'FINISHED') return session;
  return { ...session, status, updatedAt: timestamp };
}

/** Ends the game from the UI: a draw by agreement or a resignation. */
export function endGame(session: GameSession, result: GameResult, timestamp: string): GameSession {
  if (session.status === 'FINISHED') return session;
  return { ...session, status: 'FINISHED', result, updatedAt: timestamp };
}
