# Brazilian 64-square checkers rules

Requirements: `docs/execution-specification.md` §6. Implementation: `src/app/domain/engine/` (pure TypeScript, epic E4). The interpretations below were written before the implementation; every rule has deterministic tests (`src/app/domain/engine/*.spec.ts`).

Reference: the Brazilian game (_damas brasileiras_) follows the international (FMJD) rules on an 8 × 8 board, as adopted by the Confederação Brasileira de Damas. Generic checkers rules are **not** assumed: English/American checkers differ in men capturing backwards, flying kings and the majority rule.

## Board and coordinates

- 8 × 8 board, linear index `row * 8 + column`; `row 0` is the top of the canonical board, `column 0` its left (spec §5, `domain/board/board.ts`).
- Playable squares are the dark squares, `(row + column)` odd. The bottom-left square a1 (row 7, column 0) is dark: each player has a dark square in the left corner.
- **White** starts on rows 5–7 (ranks 1–3) and moves **up** (towards row 0). **Black** starts on rows 0–2 (ranks 6–8) and moves **down** (towards row 7). Calibration maps the camera to this canonical orientation; it never changes the engine conventions.
- Notation: files a–h left to right, ranks 1–8 from White's side (`squareName`). Moves are written `c3-d4`; captures `c3xe5xc7`.
- Initial position: 12 white men on the dark squares of rows 5–7, 12 black men on rows 0–2, rows 3–4 empty. **White moves first.**

## Men

- A man moves one square diagonally **forward** onto an empty square.
- A man captures **forwards and backwards**: it jumps over an adjacent opponent piece onto the empty square immediately beyond.

## Kings (_damas_)

- A man that **ends its move** on the opponent's back row (row 0 for White, row 7 for Black) becomes a king.
- A king is **flying**: it moves any number of empty squares along a diagonal, forwards or backwards.
- A king captures at a distance: along a diagonal it may pass any number of empty squares, jump a single opponent piece, and land on **any** empty square beyond it (before the next obstacle), subject to the capture rules below.

## Captures

- **Capture is mandatory.** When a player can capture, no simple move is legal.
- **Multi-capture:** after a jump, if the same piece can capture again from its landing square, it must continue, in the same move, until no further capture is possible.
- **Majority rule (_lei da maioria_):** among all capture sequences of all the player's pieces, only those that capture the **largest number of pieces** are legal. Men and kings count the same; with equal counts the player chooses freely (no priority for kings, for capturing with a king or for capturing kings).
- **Captured pieces are removed only after the whole sequence** (_tomada em bloco_). During the sequence a captured piece stays on the board as an obstacle and **cannot be jumped twice**; an opponent piece can therefore block the rest of a sequence (Turkish strike rule).
- The capturing piece's starting square counts as empty during its own sequence (it may pass over or land on it).
- **Promotion during a capture:** a man that reaches the back row in the middle of a sequence and can continue capturing (backwards, as a man) must continue, and **is not promoted**. It is promoted only if the sequence **ends** on the back row. A man never captures as a king within the move in which it is promoted.
- **Same move, several paths:** with flying kings, two landing paths can capture the same pieces and end on the same square. They are the same move: the engine lists it once (`from`, `to` and the set of captured squares identify a move) and accepts any of those paths.

## End of the game

- A player **loses** when it is their turn and they have **no pieces** or **no legal move** (all pieces blocked). `getResult` reports `WIN` for the other side, reason `NO_PIECES` or `NO_LEGAL_MOVES`.
- **Draws** need the move history, so they live in `evaluateDraw(history)` (`domain/engine/draw-rules.ts`), outside `getResult(board, playerToMove)`:
  1. **Repetition:** the same position, with the same player to move, occurs for the **third** time → `THREEFOLD_REPETITION`.
  2. **King moves only:** **20 successive moves** (plies, both players counted) by kings only, without any capture or man move → `TWENTY_KING_MOVES`.
  3. **Short endings:** with 2 kings vs 1 king, 2 kings + 1 man vs 1 king, or 1 king + 2 men vs 1 king (either color on the stronger side), the game is drawn if it is not won within **5 moves of each player** (10 plies) from the moment that material arises → `ENDGAME_FIVE_MOVES`.
  4. **Agreement** (both players agree to a draw) is a user action, handled by the game integration (E6), not by the engine.

**Interpretations adopted** (confirmed by the user at Gate G4, 2026-11-19):

- the 20-move and 5-move counts are counted in plies (each player's move counts as one "lance") for rule 2, and per player for rule 3, as written above;
- the special "3 kings vs 1 king on the main diagonal" ending is **not** implemented;
- a position for repetition is the 64 cells plus the player to move.

## Board validation

`validateBoard` rejects, with explicit issues:

- a board without exactly 64 cells, or a cell that is not a `Piece`;
- a piece on a light square;
- more than 12 pieces of one color;
- a man on its own promotion row (a white man on row 0, a black man on row 7): it would have been promoted.

Every engine operation validates its input board and throws `InvalidBoardError` on an invalid one; observations from vision are validated before they reach the engine (E5/E6).

## API

`CheckersEngine` (spec §6), implemented by `BrazilianCheckersEngine`:

| Method                              | Behavior                                                                                           |
| ----------------------------------- | -------------------------------------------------------------------------------------------------- |
| `getLegalMoves(board, player)`      | all legal moves, captures first (majority rule), deterministic order (from, then path)             |
| `applyMove(board, move)`            | validates the move against the legal moves of the moving piece's color, then returns the new board |
| `simulateMove(board, move)`         | the resulting board **without** legality checks (move inference compares hypotheses)               |
| `validateMove(board, player, move)` | true when the move (same from, to and captured set) is legal for `player`                          |
| `getResult(board, playerToMove)`    | `WIN` when `playerToMove` has no pieces or no legal move; otherwise `null`                         |
| `isPlayableSquare(index)`           | dark square                                                                                        |
| `serializeBoard(board)`             | 64 characters, row by row: `.` empty, `w`/`b` men, `W`/`B` kings; `parseBoard` is the inverse      |

`Move.path` lists every square the piece stands on, from `from` to `to` inclusive. `capturedSquares` lists the captured pieces in capture order. `pieceBefore` and `pieceAfter` differ only on promotion. `Move.id` is the move's notation (`c3-d4`, `c3xe5xc7`).
