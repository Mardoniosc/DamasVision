import { isPlayableSquare, isValidSquareIndex, SquareIndex } from '../board/board';
import { BoardState, pieceColor, PlayerColor } from '../board/piece';
import { GameResult, opponentOf } from '../game/game-result';
import { Move, moveKey } from '../move/move';
import { assertValidBoard, serializeBoard } from './board-state';
import { generateLegalMoves } from './move-generator';

/** Spec §6. */
export interface CheckersEngine {
  getLegalMoves(board: BoardState, player: PlayerColor): readonly Move[];
  applyMove(board: BoardState, move: Move): BoardState;
  simulateMove(board: BoardState, move: Move): BoardState;
  validateMove(board: BoardState, player: PlayerColor, move: Move): boolean;
  getResult(board: BoardState, playerToMove: PlayerColor): GameResult | null;
  isPlayableSquare(index: SquareIndex): boolean;
  serializeBoard(board: BoardState): string;
}

export class IllegalMoveError extends Error {
  constructor(readonly move: Move) {
    super(`illegal move ${move.id}`);
    this.name = 'IllegalMoveError';
  }
}

/**
 * Brazilian 64-square checkers (docs/engine/brazilian-checkers-rules.md). Stateless and
 * pure: every method validates its board and never mutates its inputs. The engine is the
 * authority on game state; vision only proposes moves to it.
 */
export class BrazilianCheckersEngine implements CheckersEngine {
  getLegalMoves(board: BoardState, player: PlayerColor): readonly Move[] {
    assertValidBoard(board);
    return generateLegalMoves(board.cells, player);
  }

  /** Applies a legal move of the piece on `move.from`; throws IllegalMoveError otherwise. */
  applyMove(board: BoardState, move: Move): BoardState {
    assertValidBoard(board);
    const player = pieceColor(board.cells[move.from] ?? 'EMPTY');
    const legal = player ? this.findLegal(board, player, move) : null;
    if (!legal) throw new IllegalMoveError(move);
    return this.simulateMove(board, legal);
  }

  /**
   * The board after `move`, without legality checks (move inference compares hypotheses).
   * Throws RangeError for squares outside the board.
   */
  simulateMove(board: BoardState, move: Move): BoardState {
    for (const square of [move.from, move.to, ...move.capturedSquares]) {
      if (!isValidSquareIndex(square)) throw new RangeError(`invalid square ${square}`);
    }
    const cells = [...board.cells];
    cells[move.from] = 'EMPTY';
    for (const square of move.capturedSquares) cells[square] = 'EMPTY';
    cells[move.to] = move.pieceAfter;
    return { cells };
  }

  validateMove(board: BoardState, player: PlayerColor, move: Move): boolean {
    return this.findLegal(board, player, move) !== null;
  }

  /** WIN for the opponent when the player to move has no pieces or no legal move. */
  getResult(board: BoardState, playerToMove: PlayerColor): GameResult | null {
    assertValidBoard(board);
    const winner = opponentOf(playerToMove);
    if (!board.cells.some((cell) => pieceColor(cell) === playerToMove)) {
      return { status: 'WIN', winner, reason: 'NO_PIECES' };
    }
    if (generateLegalMoves(board.cells, playerToMove).length === 0) {
      return { status: 'WIN', winner, reason: 'NO_LEGAL_MOVES' };
    }
    return null;
  }

  isPlayableSquare(index: SquareIndex): boolean {
    return isValidSquareIndex(index) && isPlayableSquare(index);
  }

  serializeBoard(board: BoardState): string {
    assertValidBoard(board);
    return serializeBoard(board);
  }

  /** The legal move equal to `move` (same from, to, captured set and pieces), if any. */
  private findLegal(board: BoardState, player: PlayerColor, move: Move): Move | null {
    const key = moveKey(move);
    return (
      this.getLegalMoves(board, player).find(
        (legal) =>
          moveKey(legal) === key &&
          legal.pieceBefore === move.pieceBefore &&
          legal.pieceAfter === move.pieceAfter,
      ) ?? null
    );
  }
}
