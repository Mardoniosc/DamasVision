/**
 * Application state machine (spec §12), as data: every transition is listed once here and
 * nowhere else (E6-T01). The setup phases (camera, calibration, recognition) are driven by
 * their pages; the game-session controller drives READY onwards.
 */
export type GamePhase =
  | 'IDLE'
  | 'CAMERA_READY'
  | 'CALIBRATION'
  | 'BOARD_RECOGNITION'
  | 'MANUAL_CORRECTION'
  | 'READY'
  | 'MONITORING'
  | 'MOVE_CANDIDATE'
  | 'STABILIZING'
  | 'MOVE_INFERENCE'
  | 'MOVE_COMMIT'
  | 'RECONCILIATION'
  | 'PAUSED'
  | 'GAME_FINISHED';

export type GameEvent =
  | 'CAMERA_ON'
  | 'CALIBRATE'
  | 'RECOGNIZE'
  | 'UNCERTAIN'
  | 'CORRECTED'
  | 'VALID'
  | 'START'
  | 'BOARD_CHANGED'
  | 'SETTLING'
  | 'STABLE'
  | 'NO_MATCH'
  | 'AMBIGUOUS'
  | 'ACCEPTED'
  | 'CONTINUE'
  | 'RESULT'
  | 'RESOLVED'
  | 'PAUSE'
  | 'RESUME'
  | 'RESET';

/** Spec §12, plus the events needed to leave each phase (documented in ADR-039). */
const TRANSITIONS: Readonly<Partial<Record<GamePhase, Partial<Record<GameEvent, GamePhase>>>>> = {
  IDLE: { CAMERA_ON: 'CAMERA_READY', START: 'READY' },
  CAMERA_READY: { CALIBRATE: 'CALIBRATION' },
  CALIBRATION: { RECOGNIZE: 'BOARD_RECOGNITION' },
  BOARD_RECOGNITION: { UNCERTAIN: 'MANUAL_CORRECTION', VALID: 'READY' },
  MANUAL_CORRECTION: { CORRECTED: 'BOARD_RECOGNITION' },
  READY: { START: 'MONITORING' },
  MONITORING: {
    BOARD_CHANGED: 'MOVE_CANDIDATE',
    PAUSE: 'PAUSED',
    STABLE: 'MOVE_INFERENCE',
    RESULT: 'GAME_FINISHED',
  },
  MOVE_CANDIDATE: {
    SETTLING: 'STABILIZING',
    STABLE: 'MOVE_INFERENCE',
    PAUSE: 'PAUSED',
    NO_MATCH: 'MONITORING',
  },
  STABILIZING: {
    STABLE: 'MOVE_INFERENCE',
    SETTLING: 'STABILIZING',
    PAUSE: 'PAUSED',
    NO_MATCH: 'MONITORING',
  },
  MOVE_INFERENCE: {
    NO_MATCH: 'MONITORING',
    AMBIGUOUS: 'RECONCILIATION',
    ACCEPTED: 'MOVE_COMMIT',
    SETTLING: 'STABILIZING',
  },
  MOVE_COMMIT: { CONTINUE: 'MONITORING', RESULT: 'GAME_FINISHED' },
  RECONCILIATION: {
    RESOLVED: 'MONITORING',
    ACCEPTED: 'MOVE_COMMIT',
    PAUSE: 'PAUSED',
    RESULT: 'GAME_FINISHED',
  },
  PAUSED: { RESUME: 'MONITORING', RESULT: 'GAME_FINISHED' },
  GAME_FINISHED: { RESET: 'IDLE', RESUME: 'MONITORING' },
};

export class InvalidTransitionError extends Error {
  constructor(
    readonly phase: GamePhase,
    readonly event: GameEvent,
  ) {
    super(`no transition from ${phase} on ${event}`);
    this.name = 'InvalidTransitionError';
  }
}

export function canTransition(phase: GamePhase, event: GameEvent): boolean {
  return TRANSITIONS[phase]?.[event] !== undefined;
}

export function transition(phase: GamePhase, event: GameEvent): GamePhase {
  const next = TRANSITIONS[phase]?.[event];
  if (!next) throw new InvalidTransitionError(phase, event);
  return next;
}
