"""Board conventions (spec §5; src/app/domain/board/board.ts).

8 × 8, linear index `row * 8 + column`, row 0 at the top of the normalized board,
playable (dark) squares where `row + column` is odd.
"""

from __future__ import annotations

BOARD_SIZE = 8
SQUARE_COUNT = BOARD_SIZE * BOARD_SIZE
FILES = "abcdefgh"


def is_on_board(row: int, column: int) -> bool:
    return 0 <= row < BOARD_SIZE and 0 <= column < BOARD_SIZE


def square_index(row: int, column: int) -> int:
    if not is_on_board(row, column):
        raise ValueError(f"square ({row}, {column}) is outside the board")
    return row * BOARD_SIZE + column


def row_of(index: int) -> int:
    return index // BOARD_SIZE


def column_of(index: int) -> int:
    return index % BOARD_SIZE


def is_playable(index: int) -> bool:
    return (row_of(index) + column_of(index)) % 2 == 1


PLAYABLE_SQUARES: tuple[int, ...] = tuple(i for i in range(SQUARE_COUNT) if is_playable(i))


def square_name(index: int) -> str:
    """Algebraic name ("a1" bottom-left), as `board-notation.ts` `squareName`."""
    return f"{FILES[column_of(index)]}{BOARD_SIZE - row_of(index)}"
