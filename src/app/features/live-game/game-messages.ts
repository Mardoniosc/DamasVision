import { squareName } from '../../domain/board/board-notation';
import { PlayerColor } from '../../domain/board/piece';
import { GameResult } from '../../domain/game/game-result';
import { InitialPositionProblem } from '../../domain/game/game-session';
import { GamePhase } from '../../domain/game/game-state-machine';
import { Reconciliation } from '../../domain/move/capture-reconciliation';
import { InferenceWarning, MoveInferenceResult } from '../../domain/move/move-inference';

/** pt-BR texts of the live game (spec §15: explicit states and messages). */
export const PLAYER_NAMES: Readonly<Record<PlayerColor, string>> = {
  WHITE: 'Brancas',
  BLACK: 'Pretas',
};

export const PHASE_LABELS: Readonly<Partial<Record<GamePhase, string>>> = {
  MONITORING: 'Acompanhando o tabuleiro',
  MOVE_CANDIDATE: 'Movimento detectado',
  STABILIZING: 'Aguardando o tabuleiro estabilizar',
  MOVE_INFERENCE: 'Identificando o lance',
  MOVE_COMMIT: 'Registrando o lance',
  RECONCILIATION: 'Confirmação necessária',
  PAUSED: 'Partida pausada',
  GAME_FINISHED: 'Partida encerrada',
};

const WARNINGS: Readonly<Record<InferenceWarning, string>> = {
  BOARD_UNCHANGED: 'O tabuleiro está igual à posição atual.',
  PIECES_REMOVED_ONLY: 'Peça levantada: termine o lance.',
  PROMOTION_NOT_MARKED: 'Promoção registrada: coloque a marca de dama na peça.',
  NO_LEGAL_MOVES: 'O jogador da vez não tem lances.',
  CAPTURED_PIECES_NOT_REMOVED: 'Retire do tabuleiro as peças capturadas.',
  DECISIVE_SQUARES_UNKNOWN: 'Algo cobre as casas do lance (mão ou objeto).',
  LOW_CONFIDENCE: 'Leitura pouco confiável: confirme o lance.',
  PARTIAL_MATCH: 'O tabuleiro tem diferenças além do lance: confirme o lance ou corrija a posição.',
  SEVERAL_MOVES_MATCH: 'Mais de um lance combina com o tabuleiro: escolha o lance feito.',
  NO_LEGAL_MOVE_MATCHES:
    'O tabuleiro não corresponde a nenhum lance legal. Desfaça o movimento físico, registre o lance manualmente ou corrija a posição.',
};

export function inferenceMessage(inference: MoveInferenceResult | null): string | null {
  const warning = inference?.warnings[0];
  if (!inference || !warning) return null;
  const pending = inference.selected?.pendingRemoval ?? [];
  const base = WARNINGS[warning];
  return pending.length > 0 ? `${base} (${pending.map(squareName).join(', ')})` : base;
}

export function reconciliationMessage(reconciliation: Reconciliation | null): string | null {
  switch (reconciliation?.status) {
    case 'PENDING_REMOVAL':
      return `Retire as peças capturadas: ${reconciliation.pendingRemoval.map(squareName).join(', ')}.`;
    case 'PENDING_PROMOTION_MARK':
      return reconciliation.pendingPromotion !== null
        ? `Coloque a marca de dama na peça em ${squareName(reconciliation.pendingPromotion)}.`
        : null;
    case 'MISMATCH':
      return `O tabuleiro físico difere da posição registrada em ${reconciliation.mismatchedSquares.map(squareName).join(', ')}.`;
    default:
      return null;
  }
}

const RESULT_REASONS: Readonly<Record<GameResult['reason'], string>> = {
  NO_PIECES: 'sem peças',
  NO_LEGAL_MOVES: 'sem lances possíveis',
  THREEFOLD_REPETITION: 'posição repetida três vezes',
  TWENTY_KING_MOVES: '20 lances só de damas',
  ENDGAME_FIVE_MOVES: 'final de damas sem vitória em 5 lances',
  AGREEMENT: 'acordo entre os jogadores',
  RESIGNATION: 'desistência',
};

export function resultMessage(result: GameResult | undefined): string | null {
  if (!result) return null;
  const reason = RESULT_REASONS[result.reason];
  return result.status === 'DRAW'
    ? `Empate (${reason}).`
    : `Vitória das ${PLAYER_NAMES[result.winner ?? 'WHITE'].toLowerCase()} (${reason}).`;
}

export function initialPositionMessage(problem: InitialPositionProblem): string {
  switch (problem.code) {
    case 'UNKNOWN_SQUARES':
      return `Corrija as casas sem leitura: ${problem.squares.map(squareName).join(', ')}.`;
    case 'MISSING_SIDE':
      return `Não há peças ${PLAYER_NAMES[problem.color].toLowerCase()} no tabuleiro.`;
    case 'INVALID_BOARD': {
      const p = problem.problem;
      switch (p.code) {
        case 'TOO_MANY_PIECES':
          return `Há ${p.count} peças ${PLAYER_NAMES[p.color].toLowerCase()} (máximo 12).`;
        case 'MAN_ON_PROMOTION_ROW':
          return `A peça em ${squareName(p.square)} está na fileira de promoção: deveria ser dama.`;
        default:
          return 'A posição não é válida.';
      }
    }
  }
}
