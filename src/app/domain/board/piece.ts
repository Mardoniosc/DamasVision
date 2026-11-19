import { SQUARE_COUNT } from './board';

/** Contracts from docs/execution-specification.md §5 (Board conventions). */
export type Piece = 'EMPTY' | 'WHITE' | 'BLACK' | 'WHITE_KING' | 'BLACK_KING';
export type ObservedPiece = Piece | 'UNKNOWN';
export type PlayerColor = 'WHITE' | 'BLACK';

export const PIECES: readonly Piece[] = ['EMPTY', 'WHITE', 'BLACK', 'WHITE_KING', 'BLACK_KING'];
export const OBSERVED_PIECES: readonly ObservedPiece[] = [...PIECES, 'UNKNOWN'];

export interface BoardState {
  /** Exactly 64 cells, indexed `row * 8 + column`. */
  readonly cells: readonly Piece[];
}

export function isPiece(value: unknown): value is Piece {
  return typeof value === 'string' && (PIECES as readonly string[]).includes(value);
}

export function isObservedPiece(value: unknown): value is ObservedPiece {
  return typeof value === 'string' && (OBSERVED_PIECES as readonly string[]).includes(value);
}

export function pieceColor(piece: ObservedPiece): PlayerColor | null {
  switch (piece) {
    case 'WHITE':
    case 'WHITE_KING':
      return 'WHITE';
    case 'BLACK':
    case 'BLACK_KING':
      return 'BLACK';
    default:
      return null;
  }
}

export function isKing(piece: ObservedPiece): boolean {
  return piece === 'WHITE_KING' || piece === 'BLACK_KING';
}

export function emptyBoard(): BoardState {
  return { cells: Array.from({ length: SQUARE_COUNT }, () => 'EMPTY') };
}
