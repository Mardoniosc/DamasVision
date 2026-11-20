import { computed, inject, Injectable, InjectionToken, signal } from '@angular/core';
import { BoardObservation } from '../../domain/board/observation';
import { BoardState, PlayerColor } from '../../domain/board/piece';
import { BrazilianCheckersEngine, CheckersEngine } from '../../domain/engine/checkers-engine';
import { GameResult } from '../../domain/game/game-result';
import {
  CommitError,
  commitMove,
  correctPosition,
  createGameSession,
  endGame,
  GameSession,
  setStatus,
  undoLastMove,
  validateInitialPosition,
} from '../../domain/game/game-session';
import {
  canTransition,
  GameEvent,
  GamePhase,
  transition,
} from '../../domain/game/game-state-machine';
import { compareObservedBoard } from '../../domain/move/board-diff';
import { reconcileObservation, Reconciliation } from '../../domain/move/capture-reconciliation';
import { InferenceConfig, PIPELINE_INFERENCE_CONFIG } from '../../domain/move/inference.config';
import { Move } from '../../domain/move/move';
import { MoveInferenceResult } from '../../domain/move/move-inference';
import { MoveTracker } from '../../domain/move/move-tracker';
import { GAME_REPOSITORY, toGameSession, toPersistedGame } from '../persistence/game.repository';
import { PersistenceError, toPersistenceError } from '../persistence/persistence.models';

export const CHECKERS_ENGINE = new InjectionToken<CheckersEngine>('CHECKERS_ENGINE', {
  providedIn: 'root',
  factory: () => new BrazilianCheckersEngine(),
});

/** Stabilization/inference values for G3-stabilized observations (ADR-038). */
export const INFERENCE_CONFIG = new InjectionToken<InferenceConfig>('INFERENCE_CONFIG', {
  providedIn: 'root',
  factory: () => PIPELINE_INFERENCE_CONFIG,
});

export interface StartGameRequest {
  readonly cells: BoardObservation['cells'];
  readonly whitePlayerLabel: string;
  readonly blackPlayerLabel: string;
  readonly playerToMove?: PlayerColor;
  readonly calibrationId?: string;
}

/** A vision result the user has to decide on (spec §8: ambiguity, no match, partial). */
export interface PendingDecision {
  readonly inference: MoveInferenceResult;
  /** Moves in the session when the inference was made (stale decisions are ignored). */
  readonly expectedPly: number;
}

/** Phases in which observations are tracked. */
const OBSERVING: readonly GamePhase[] = [
  'MONITORING',
  'MOVE_CANDIDATE',
  'STABILIZING',
  'RECONCILIATION',
];

/**
 * Owns the authoritative game session (spec §10 "State ownership", E6-T01/T03). Vision
 * results come in through `observe`; only this controller changes the session, always
 * through the engine-validated domain functions, and persists every change before showing
 * it. The phase follows the spec §12 state machine (`game-state-machine.ts`).
 */
@Injectable({ providedIn: 'root' })
export class GameSessionController {
  private readonly engine = inject(CHECKERS_ENGINE);
  private readonly repository = inject(GAME_REPOSITORY);
  private readonly config = inject(INFERENCE_CONFIG);
  private readonly tracker = new MoveTracker(this.engine, this.config);

  private readonly sessionState = signal<GameSession | null>(null);
  private readonly phaseState = signal<GamePhase>('IDLE');
  private readonly inferenceState = signal<MoveInferenceResult | null>(null);
  private readonly pendingState = signal<PendingDecision | null>(null);
  private readonly reconciliationState = signal<Reconciliation | null>(null);
  private readonly errorState = signal<string | null>(null);
  private readonly busyState = signal(false);

  readonly session = this.sessionState.asReadonly();
  readonly phase = this.phaseState.asReadonly();
  /** The latest inference (shown as status). */
  readonly inference = this.inferenceState.asReadonly();
  /** A decision the user must take, if any. */
  readonly pending = this.pendingState.asReadonly();
  /** Physical board vs. authoritative after the last commit. */
  readonly reconciliation = this.reconciliationState.asReadonly();
  readonly error = this.errorState.asReadonly();
  readonly busy = this.busyState.asReadonly();
  readonly legalMoves = computed<readonly Move[]>(() => {
    const session = this.sessionState();
    return session && session.status !== 'FINISHED'
      ? this.engine.getLegalMoves(session.board, session.currentPlayer)
      : [];
  });
  readonly lastMove = computed(() => this.sessionState()?.moves.at(-1) ?? null);

  /** E6-T02: validates the confirmed position, creates and saves the game. */
  async startGame(request: StartGameRequest): Promise<GameSession> {
    const validation = validateInitialPosition({ cells: request.cells });
    if (!validation.valid || !validation.board) {
      throw new Error('A posição confirmada não é válida para iniciar uma partida.');
    }
    const session = createGameSession({
      id: crypto.randomUUID(),
      board: validation.board,
      whitePlayerLabel: request.whitePlayerLabel,
      blackPlayerLabel: request.blackPlayerLabel,
      timestamp: now(),
      ...(request.playerToMove ? { playerToMove: request.playerToMove } : {}),
      ...(request.calibrationId ? { calibrationId: request.calibrationId } : {}),
    });
    await this.repository.create(toPersistedGame(session));
    this.adopt(session);
    return session;
  }

  /** Opens a saved game (the current one, or one from the repository). */
  async load(id: string): Promise<GameSession | null> {
    if (this.sessionState()?.id === id) return this.sessionState();
    try {
      const game = await this.repository.getById(id);
      if (!game) return null;
      this.adopt(toGameSession(game));
      return this.sessionState();
    } catch (error) {
      this.errorState.set(toPersistenceError(error).message);
      return null;
    }
  }

  /** Feeds one (G3-stabilized) observation; may commit a move. */
  async observe(observation: BoardObservation): Promise<void> {
    const session = this.sessionState();
    if (!session || this.busyState() || !OBSERVING.includes(this.phaseState())) return;
    try {
      await this.track(session, observation);
    } finally {
      this.leaveInference();
    }
  }

  private async track(session: GameSession, observation: BoardObservation): Promise<void> {
    const comparison = compareObservedBoard(session.board, observation);
    const changed = !comparison.consistent;
    const update = this.tracker.observe(session.board, session.currentPlayer, observation);
    if (!update.inference) {
      if (changed && update.stability !== 'STABLE') {
        this.go('BOARD_CHANGED');
        this.go('SETTLING');
      }
      return;
    }
    const inference = update.inference;
    this.inferenceState.set(inference);
    this.go('STABLE');
    const expectedPly = session.moves.length;

    switch (inference.status) {
      case 'MATCHED':
        if (inference.selected) {
          await this.commit(
            inference.selected.move,
            'VISION',
            expectedPly,
            observation,
            inference.selected.changedConfidence,
          );
        }
        return;
      case 'WAITING_FOR_STABILITY':
        this.go('SETTLING');
        return;
      case 'NO_MATCH':
        if (inference.warnings.includes('BOARD_UNCHANGED')) {
          // Only a fully visible board equal to the official one resolves a pending
          // decision; UNKNOWN squares (a hand, a camera restart) are no evidence.
          if (!comparison.exact) {
            this.go('NO_MATCH');
            return;
          }
          this.pendingState.set(null);
          this.go(this.phaseState() === 'RECONCILIATION' ? 'RESOLVED' : 'NO_MATCH');
        } else {
          // Spec §12: back to monitoring; spec §8: offer reconciliation (ADR-039).
          this.pendingState.set({ inference, expectedPly });
          this.go('NO_MATCH');
        }
        return;
      case 'AMBIGUOUS':
      case 'REQUIRES_MANUAL_CORRECTION':
        this.pendingState.set({ inference, expectedPly });
        this.go('AMBIGUOUS');
        await this.save(setStatus(session, 'RECONCILIATION_REQUIRED', now()));
        return;
    }
  }

  /** The user confirms a move (a candidate, or one picked from the legal moves). */
  async confirmMove(move: Move): Promise<boolean> {
    const session = this.sessionState();
    if (!session) return false;
    if (this.phaseState() !== 'RECONCILIATION') this.go('STABLE');
    try {
      return await this.commit(move, 'MANUAL', session.moves.length, null);
    } finally {
      this.leaveInference();
    }
  }

  /** No path may stay in MOVE_INFERENCE (it does not watch the board). */
  private leaveInference(): void {
    if (this.phaseState() === 'MOVE_INFERENCE') this.go('NO_MATCH');
  }

  /** Dismisses a pending decision and watches the board again (retry recognition). */
  async retry(): Promise<void> {
    this.pendingState.set(null);
    this.tracker.reset();
    const session = this.sessionState();
    if (session?.status === 'RECONCILIATION_REQUIRED')
      await this.save(setStatus(session, 'ACTIVE', now()));
    this.go('RESOLVED');
    this.go('NO_MATCH');
  }

  async pause(): Promise<void> {
    const session = this.sessionState();
    if (!session || !canTransition(this.phaseState(), 'PAUSE')) return;
    if (await this.save(setStatus(session, 'PAUSED', now()))) this.go('PAUSE');
  }

  async resume(): Promise<void> {
    const session = this.sessionState();
    if (!session || this.phaseState() !== 'PAUSED') return;
    if (await this.save(setStatus(session, 'ACTIVE', now()))) {
      this.tracker.reset();
      this.go('RESUME');
    }
  }

  /** E6-T06: undoes the last move (exact previous position), recorded in the session. */
  async undo(): Promise<boolean> {
    const session = this.sessionState();
    if (!session) return false;
    try {
      const undone = undoLastMove(session, now());
      return this.replace(undone);
    } catch (error) {
      if (error instanceof CommitError) {
        this.errorState.set('Não há lance para desfazer desde a última correção de posição.');
        return false;
      }
      throw error;
    }
  }

  /** Recovery: sets the authoritative position explicitly (confirmed by the user). */
  async correctPosition(
    board: BoardState,
    playerToMove: PlayerColor,
    reason: string,
  ): Promise<boolean> {
    const session = this.sessionState();
    if (!session) return false;
    try {
      return this.replace(
        correctPosition(session, board, playerToMove, now(), reason, this.engine),
      );
    } catch (error) {
      if (error instanceof CommitError) {
        this.errorState.set('A posição informada não é válida.');
        return false;
      }
      throw error;
    }
  }

  /** Ends the game by agreement or resignation. */
  async end(result: GameResult): Promise<void> {
    const session = this.sessionState();
    if (!session || session.status === 'FINISHED') return;
    if (await this.save(endGame(session, result, now()))) {
      this.pendingState.set(null);
      this.forcePhase('GAME_FINISHED');
    }
  }

  clearError(): void {
    this.errorState.set(null);
  }

  /** Forgets the current game (leaving the live page does not; a new game does). */
  close(): void {
    this.sessionState.set(null);
    this.pendingState.set(null);
    this.inferenceState.set(null);
    this.reconciliationState.set(null);
    this.tracker.reset();
    this.phaseState.set('IDLE');
  }

  /**
   * Commit protocol (spec §8): validate against the current session, apply, persist —
   * and only then show it. A persistence failure keeps the previous session.
   */
  private async commit(
    move: Move,
    source: 'VISION' | 'MANUAL',
    expectedPly: number,
    observation: BoardObservation | null,
    confidence?: number,
  ): Promise<boolean> {
    const session = this.sessionState();
    // One commit at a time: a second request while the first is being saved is a
    // duplicate (double click, repeated frame) and is refused.
    if (!session || this.busyState()) return false;
    let next: GameSession;
    try {
      next = commitMove(
        session,
        {
          move,
          source,
          expectedPly,
          timestamp: now(),
          ...(confidence !== undefined ? { confidence } : {}),
        },
        this.engine,
      );
    } catch (error) {
      if (error instanceof CommitError && error.reason === 'STALE') return false; // duplicate
      this.errorState.set(
        error instanceof CommitError && error.reason === 'NOT_ACTIVE'
          ? 'A partida não está em andamento.'
          : 'O lance não é legal na posição atual.',
      );
      return false;
    }
    this.go('ACCEPTED');
    if (!(await this.save(next))) {
      this.go('CONTINUE');
      return false;
    }
    this.pendingState.set(null);
    this.reconciliationState.set(
      observation ? reconcileObservation(next.board, observation, move, session.board) : null,
    );
    this.go(next.status === 'FINISHED' ? 'RESULT' : 'CONTINUE');
    return true;
  }

  /** Persists an adjusted session (undo, correction) and restarts tracking. */
  private async replace(next: GameSession): Promise<boolean> {
    if (!(await this.save(next))) return false;
    this.pendingState.set(null);
    this.reconciliationState.set(null);
    this.tracker.reset();
    this.forcePhase(next.status === 'FINISHED' ? 'GAME_FINISHED' : 'MONITORING');
    return true;
  }

  private async save(next: GameSession): Promise<boolean> {
    this.busyState.set(true);
    try {
      await this.repository.update(toPersistedGame(next));
      this.sessionState.set(next);
      this.errorState.set(null);
      return true;
    } catch (error) {
      const failure = error instanceof PersistenceError ? error : toPersistenceError(error);
      this.errorState.set(`Não foi possível salvar a partida: ${failure.message}`);
      return false;
    } finally {
      this.busyState.set(false);
    }
  }

  private adopt(session: GameSession): void {
    this.sessionState.set(session);
    this.pendingState.set(null);
    this.inferenceState.set(null);
    this.reconciliationState.set(null);
    this.errorState.set(null);
    this.tracker.reset();
    this.forcePhase(
      session.status === 'FINISHED'
        ? 'GAME_FINISHED'
        : session.status === 'PAUSED'
          ? 'PAUSED'
          : session.status === 'RECONCILIATION_REQUIRED'
            ? 'RECONCILIATION'
            : 'MONITORING',
    );
  }

  /** Applies a spec §12 transition when it exists from the current phase. */
  private go(event: GameEvent): void {
    if (canTransition(this.phaseState(), event)) {
      this.phaseState.set(transition(this.phaseState(), event));
    }
  }

  /** Entering a game (start, load) or an explicit adjustment sets the phase directly. */
  private forcePhase(phase: GamePhase): void {
    this.phaseState.set(phase);
  }
}

function now(): string {
  return new Date().toISOString();
}
