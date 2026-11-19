# DAMAS VISION

## Execution Specification --- Technical Implementation Blueprint

**Version:** 1.0 \| **Status:** Baseline specification \| **Execution
agent:** Claude Code

# 1. Purpose and mandate

Damas Vision is a local-first web application that observes a physical
Brazilian 64-square checkers board through a camera, reconstructs its
position, infers moves from stable observations, validates them using an
independent TypeScript checkers engine, and synchronizes the physical
game with a digital representation.

Claude Code must implement incrementally, preserve the architecture and
contracts in this document, and validate each phase before proceeding.
Do not attempt the entire application in one pass.

## MVP scope

-   Camera capture, device selection and preview.
-   Manual four-corner calibration and perspective normalization.
-   8x8 grid and playable-square mapping.
-   Initial piece recognition using configurable classical CV
    heuristics.
-   Confidence and `UNKNOWN` recognition state.
-   Stable observations over multiple frames.
-   Move inference by comparing observations against legal engine
    outcomes.
-   Brazilian 64-square rules, isolated from UI and vision.
-   Human-vs-human physical-board game tracking.
-   Manual correction and recovery.
-   IndexedDB persistence, PWA foundations and offline caching.

## Out of scope

Online multiplayer, accounts, backend, cloud sync, tournament services,
AI opponent, automated calibration for arbitrary boards, generic trained
detector, automatic video recording, cloud image upload.

## Guiding principles

1.  Vision observes; engine decides.
2.  The engine is the authoritative logical state.
3.  Recognition never directly mutates game state.
4.  Uncertainty is explicit; prefer `UNKNOWN` to false certainty.
5.  Every confirmed move is legal and reconciled with a stable
    observation.
6.  Vision, engine, persistence and UI remain separate.
7.  No backend or external inference API for MVP.
8.  Prefer freshest frame; drop stale frames.
9.  Manual correction is a first-class recovery mechanism.
10. Build and test in small increments with gates.

# 2. Technology baseline

  Area                   Choice
  ---------------------- -----------------------------------------------
  Frontend               Angular, standalone components
  Language               TypeScript strict
  Styling                Tailwind CSS 4
  Vision                 OpenCV.js, controlled loader/build
  Camera                 Web APIs / `getUserMedia`
  Processing isolation   Web Worker
  Persistence            IndexedDB, Dexie abstraction
  Engine                 Pure TypeScript
  Reactive UI            Angular signals; RxJS where useful
  Unit tests             Angular-compatible runner / Vitest
  E2E                    Playwright
  PWA                    Angular service worker or supported PWA setup
  Hosting                Static HTTPS

Use compatible stable versions and record exact versions. Do not
silently upgrade major dependencies.

## Engineering constraints

-   Angular standalone APIs, strict template checking.
-   No `any` except justified and isolated.
-   No rules in components.
-   No OpenCV processing in UI components.
-   No direct IndexedDB access from components.
-   Recognition must not mutate authoritative game state.
-   No non-trivial image processing on main thread.
-   No runtime cloud dependencies for MVP.
-   Release camera streams, worker resources and OpenCV `Mat` resources
    explicitly.
-   Keep dependencies minimal; avoid premature ML.

# 3. Architecture

``` mermaid
flowchart TD
    UI[Angular Presentation] --> Controller[Game Session Controller]
    UI --> Camera[Camera Service]
    Camera --> Capture[Frame Scheduler]
    Capture --> Worker[Vision Worker]
    Worker --> Pipeline[Vision Pipeline]
    Pipeline --> Calibration[Perspective Calibration]
    Pipeline --> Grid[Grid Mapper]
    Pipeline --> Recognition[Piece Recognition]
    Recognition --> Stabilizer[Temporal Stabilizer]
    Stabilizer --> Inference[Move Inference]
    Inference --> Engine[Checkers Engine]
    Engine --> GameState[Authoritative State]
    GameState --> UI
    GameState --> Repository[Persistence]
    Repository --> DB[(IndexedDB)]
```

### Responsibilities

-   **Presentation:** routes, overlays, status, controls, camera
    preview; render authoritative state and recognition state
    separately.
-   **Camera:** devices, permissions, stream lifecycle, capture,
    scheduling, backpressure.
-   **Vision:** preprocessing, perspective normalization, grid, square
    classification, confidence.
-   **Tracking:** stable observations, difference analysis, move
    inference, reconciliation.
-   **Engine:** Brazilian rules, legal moves, capture, multi-capture,
    king, promotion, result.
-   **Persistence:** games, history, calibrations, settings and optional
    diagnostics.

# 4. Repository structure

``` text
damas-vision/
├── CLAUDE.md
├── README.md
├── docs/
│   ├── execution-specification.md
│   ├── architecture/{architecture.md,decisions.md,diagrams.md}
│   ├── vision/{calibration.md,recognition.md,move-inference.md}
│   ├── engine/brazilian-checkers-rules.md
│   ├── testing/physical-test-matrix.md
│   └── backlog/implementation-backlog.md
├── public/{assets/,models/}
├── src/
│   ├── app/
│   │   ├── app.component.ts
│   │   ├── app.config.ts
│   │   ├── app.routes.ts
│   │   ├── core/
│   │   │   ├── camera/
│   │   │   ├── frame-capture/
│   │   │   ├── workers/
│   │   │   ├── persistence/
│   │   │   └── app-state/
│   │   ├── domain/{board/,game/,move/,rules/,engine/}
│   │   ├── features/{home/,camera/,calibration/,recognition/,live-game/,game-history/,settings/}
│   │   └── shared/{components/,directives/,pipes/,utilities/}
│   ├── assets/
│   ├── styles/
│   └── main.ts
├── tests/{fixtures/,unit/,integration/,e2e/}
├── package.json
├── angular.json
└── tsconfig.json
```

Ownership rules: - `domain/**`: pure TypeScript; no Angular, browser
APIs, OpenCV or IndexedDB. - `core/camera/**`: camera lifecycle. -
`core/frame-capture/**`: frame scheduling. - `core/workers/**`: worker
protocol/client. - `features/**`: UI and orchestration. -
`core/persistence/**`: repositories and DB schema. - `shared/**`:
reusable UI only.

# 5. Domain contracts

## Board conventions

-   8 rows × 8 columns, linear index `row * 8 + column`.
-   `row=0` is top of normalized image; `column=0` is left.
-   Engine coordinates and player movement direction must be documented.
-   Only 32 playable squares contain pieces.
-   Calibration maps camera image coordinates to canonical coordinates;
    it does not change engine conventions.
-   Board arrays must contain exactly 64 cells.

``` typescript
export type SquareIndex = number; // 0..63
export type Piece = 'EMPTY' | 'WHITE' | 'BLACK' | 'WHITE_KING' | 'BLACK_KING';
export type ObservedPiece = Piece | 'UNKNOWN';
export type PlayerColor = 'WHITE' | 'BLACK';

export interface BoardState {
  readonly cells: readonly Piece[];
}

export interface BoardObservation {
  readonly cells: readonly ObservedPiece[];
  readonly confidenceBySquare: readonly number[];
  readonly timestamp: number;
  readonly sourceFrameId?: string;
}
```

## Geometry and calibration

``` typescript
export interface Point2D { readonly x: number; readonly y: number; }

export interface CalibrationCorners {
  readonly topLeft: Point2D;
  readonly topRight: Point2D;
  readonly bottomRight: Point2D;
  readonly bottomLeft: Point2D;
}

export interface CalibrationProfile {
  readonly id: string;
  readonly name: string;
  readonly cameraDeviceId?: string;
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly corners: CalibrationCorners;
  readonly normalizedWidth: number;
  readonly normalizedHeight: number;
  readonly orientation: 'NORMAL' | 'ROTATED_90' | 'ROTATED_180' | 'ROTATED_270';
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SquareGeometry {
  readonly index: SquareIndex;
  readonly row: number;
  readonly column: number;
  readonly bounds: { readonly x: number; readonly y: number; readonly width: number; readonly height: number; };
  readonly center: Point2D;
  readonly isPlayable: boolean;
}
```

## Recognition

``` typescript
export type RecognitionStatus = 'SUCCESS' | 'UNCERTAIN' | 'ERROR';

export interface SquareRecognition {
  readonly squareIndex: SquareIndex;
  readonly piece: ObservedPiece;
  readonly confidence: number; // 0..1, heuristic unless calibrated statistically
}

export interface RecognitionWarning {
  readonly code: string;
  readonly message: string;
  readonly affectedSquares?: readonly SquareIndex[];
}

export interface BoardRecognitionResult {
  readonly board: BoardObservation;
  readonly squares: readonly SquareRecognition[];
  readonly status: RecognitionStatus;
  readonly overallConfidence: number;
  readonly warnings: readonly RecognitionWarning[];
  readonly timestamp: number;
}
```

## Move and inference

``` typescript
export interface Move {
  readonly id: string;
  readonly from: SquareIndex;
  readonly to: SquareIndex;
  readonly path: readonly SquareIndex[];
  readonly capturedSquares: readonly SquareIndex[];
  readonly promotion: boolean;
  readonly pieceBefore: Piece;
  readonly pieceAfter: Piece;
}

export interface MoveCandidate {
  readonly move: Move;
  readonly matchScore: number;
  readonly mismatchedSquares: readonly SquareIndex[];
  readonly expectedBoard: BoardState;
}

export type MoveInferenceStatus =
  | 'MATCHED' | 'AMBIGUOUS' | 'NO_MATCH'
  | 'WAITING_FOR_STABILITY' | 'REQUIRES_MANUAL_CORRECTION';

export interface MoveInferenceResult {
  readonly status: MoveInferenceStatus;
  readonly candidates: readonly MoveCandidate[];
  readonly selected?: MoveCandidate;
  readonly observedBoard: BoardObservation;
  readonly warnings: readonly string[];
}
```

## Game

``` typescript
export type GameStatus = 'ACTIVE' | 'PAUSED' | 'FINISHED' | 'RECONCILIATION_REQUIRED';

export interface GameResult {
  readonly status: 'WIN' | 'DRAW';
  readonly winner?: PlayerColor;
  readonly reason: string;
}

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
}
```

# 6. Checkers engine

The engine must be pure TypeScript. It must not import Angular, OpenCV,
camera APIs or IndexedDB.

``` typescript
export interface CheckersEngine {
  getLegalMoves(board: BoardState, player: PlayerColor): readonly Move[];
  applyMove(board: BoardState, move: Move): BoardState;
  simulateMove(board: BoardState, move: Move): BoardState;
  validateMove(board: BoardState, player: PlayerColor, move: Move): boolean;
  getResult(board: BoardState, playerToMove: PlayerColor): GameResult | null;
  isPlayableSquare(index: SquareIndex): boolean;
  serializeBoard(board: BoardState): string;
}
```

Implement and document Brazilian 64-square rule interpretations: -
Mandatory capture. - Multi-capture. - Regular-piece captures. - Flying
king movement and captures. - Promotion. - Capture-sequence continuation
and priority rules adopted. - Endgame and draw rules, if in scope.

Do not assume generic checkers rules are equivalent. Create
deterministic test fixtures for opening position, simple moves, illegal
moves, compulsory captures, multi-captures, king movement, flying king
capture, promotion, promotion during capture sequence according to
adopted rules, game termination and draw cases if implemented.

# 7. Vision pipeline

``` mermaid
flowchart TD
    Frame[Camera Frame] --> Quality[Quality Checks]
    Quality --> Rectify[Perspective Rectification]
    Rectify --> Grid[Canonical 8x8 Grid]
    Grid --> Regions[Playable Square Regions]
    Regions --> Features[Feature Extraction]
    Features --> Classify[Piece Classification]
    Classify --> Observation[Board Observation]
    Observation --> Stability[Temporal Stabilizer]
    Stability --> Stable[Stable Observation]
```

## Frame quality

Advisory checks for dimensions, availability, blur/sharpness, exposure,
calibration and board visibility. Avoid hard rejection based on
unvalidated thresholds.

## Perspective correction

1.  Validate ordered corners, bounds, distinctness, convexity and area.
2.  Define destination corners for normalized board image.
3.  Calculate perspective transform.
4.  Warp image.
5.  Retain transform metadata for overlay/debug.
6.  Release OpenCV resources in `finally`/equivalent.

Use OpenCV.js perspective-transform and warp APIs, verifying
compatibility with the selected build.

## Grid mapping

-   Normalized image 8×8.
-   Map square bounds and playable-square mask.
-   Configurable central ROI inside playable squares to reduce
    neighboring square and line interference.
-   Geometry is separate from recognition output.

## MVP recognition

Classify each playable square using configurable multiple features: -
HSV statistics and luminance. - Foreground/background contrast. -
Contours and circularity where useful. - Area ratio. - Texture/marking
features for kings. - Temporal consistency.

Classes: `EMPTY`, `WHITE`, `BLACK`, `WHITE_KING`, `BLACK_KING`,
`UNKNOWN`.

Algorithm per square: 1. Crop square. 2. Apply central ROI/mask. 3.
Compute color/shape features. 4. Estimate foreground presence. 5.
Estimate color. 6. Estimate king signal based on standardized physical
pieces. 7. Produce classification and confidence. 8. Use `UNKNOWN` when
features conflict or confidence is low.

The MVP assumes standardized pieces whose kings have a distinct visual
signal (stacked, raised, marked or consistently shaped). Provide manual
correction. Do not promise arbitrary king recognition.

Confidence bands are initial tuning values, not proven probabilities: -
High \>=0.95. - Acceptable \>=0.80. - Uncertain \>=0.60. - Unknown below
0.60. Keep thresholds centralized and configurable.

## Temporal stabilization

-   Bounded observation window.
-   Per-square aggregation.
-   Consistent observations required.
-   Handle `UNKNOWN`/occlusion.
-   Unstable observations never mutate game state.
-   Drop stale frames.

Experimental initial values: 3--5 observations; interval 150--250ms;
target stabilization 500--1000ms. Tune using real data.

# 8. Move inference and reconciliation

The MVP does not track piece trajectory. It infers the move from
previous authoritative state and a stable observed board.

1.  Get authoritative board and side to move.
2.  Generate legal moves.
3.  Simulate each move.
4.  Compare simulation with stable observation.
5.  Score candidate matches using board difference and observation
    confidence.
6.  If one acceptable candidate exists, propose it.
7.  If ambiguous, ask for correction.
8.  If no legal outcome matches, enter reconciliation.
9.  Commit through game-session controller only.

Board comparison: - Count mismatches. - Optionally weight by observation
confidence. - `UNKNOWN` is uncertainty, not automatically mismatch. -
Return score and mismatched locations. - Support exact and partial
matching.

``` typescript
function inferMove(
  authoritativeBoard: BoardState,
  player: PlayerColor,
  observation: BoardObservation,
  engine: CheckersEngine
): MoveInferenceResult {
  const legalMoves = engine.getLegalMoves(authoritativeBoard, player);
  const candidates: MoveCandidate[] = [];

  for (const move of legalMoves) {
    const expectedBoard = engine.simulateMove(authoritativeBoard, move);
    const comparison = compareObservedBoard(expectedBoard, observation);
    if (comparison.acceptable) {
      candidates.push({
        move,
        expectedBoard,
        matchScore: comparison.score,
        mismatchedSquares: comparison.mismatchedSquares
      });
    }
  }
  return resolveCandidates(candidates, observation);
}
```

## Commit protocol

-   Create candidate.
-   Apply confidence policy.
-   Validate against current authoritative state.
-   Apply move.
-   Persist game and move record.
-   Reconcile physical observation to expected resulting board.
-   If reconciliation fails, enter `RECONCILIATION_REQUIRED`.
-   Prevent duplicate commits from repeated frames.

## Recovery

Retry recognition, recalibrate, edit observed board, confirm correction,
pause, and undo only where history semantics are robust. Editing an
observation is distinct from altering game history; authoritative
position changes must be explicit and recorded.

# 9. Camera and worker contracts

``` typescript
export interface CameraDevice {
  readonly deviceId: string;
  readonly label: string;
}

export interface CameraStatus {
  readonly state: 'IDLE' | 'REQUESTING_PERMISSION' | 'READY' | 'STREAMING' | 'ERROR';
  readonly error?: CameraError;
}

export type CameraErrorCode =
  | 'PERMISSION_DENIED' | 'NO_DEVICE' | 'DEVICE_BUSY' | 'UNSUPPORTED' | 'UNKNOWN';

export interface CameraError {
  readonly code: CameraErrorCode;
  readonly message: string;
}

export interface CameraServiceContract {
  listDevices(): Promise<readonly CameraDevice[]>;
  start(deviceId?: string): Promise<void>;
  stop(): void;
  getStatus(): CameraStatus;
}
```

Use `getUserMedia`; handle permissions, device failures, stream cleanup,
device switching and unsupported browser.

Frame scheduler: one in-flight frame by default, drop stale frames,
configurable interval, pause/resume, stop on route/game lifecycle
cleanup.

## Worker protocol

``` typescript
export type VisionWorkerRequest =
  | { type: 'INIT'; config: VisionConfig }
  | { type: 'CALIBRATE'; corners: CalibrationCorners; width: number; height: number }
  | { type: 'PROCESS_FRAME'; frame: ImageBitmap; frameId: string }
  | { type: 'RESET' }
  | { type: 'DISPOSE' };

export type VisionWorkerResponse =
  | { type: 'READY' }
  | { type: 'CALIBRATION_RESULT'; result: CalibrationResult }
  | { type: 'RECOGNITION_RESULT'; result: BoardRecognitionResult; frameId: string }
  | { type: 'ERROR'; code: string; message: string; frameId?: string };
```

Validate payloads; handle worker initialization, timeout and
termination; dispose transferred resources; surface errors; never
silently swallow failures.

# 10. Angular feature requirements

## Routes

-   `/` --- Home.
-   `/game/new` --- Setup/camera.
-   `/calibration` --- Calibration.
-   `/game/:id` --- Live game.
-   `/games` --- History.
-   `/settings` --- Settings.
-   Saved-game details/replay may be P1.

## Setup

Camera selection → preview → calibration → initial recognition →
confidence/unknown display → correction → player labels → start.

## Live game

Authoritative digital board, camera preview, optional recognition
overlay, side-to-move, last move, history, recognition/calibration
status, pause/resume, undo, correction and end game.

## Manual correction

Edit square, select piece/empty, validate, show changed squares, submit
corrected observation. Explicit confirmation required for altering
authoritative position.

State ownership: - Camera service owns camera state. - Recognition
orchestration owns observation state. - Game controller owns
authoritative session. - Repository owns persistence. - Components do
not mutate these states directly.

# 11. Persistence

Stores: `games`, `calibrations`, `settings`, optional bounded
`recognitionLogs`.

``` typescript
export interface PersistedGame {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: GameStatus;
  mode: 'PHYSICAL_HUMAN_VS_HUMAN';
  whitePlayerLabel: string;
  blackPlayerLabel: string;
  currentPlayer: PlayerColor;
  initialBoard: BoardState;
  currentBoard: BoardState;
  moves: readonly GameMoveRecord[];
  result?: GameResult;
  calibrationId?: string;
}

export interface PersistedCalibration extends CalibrationProfile {
  isActive: boolean;
}

export interface AppSetting<T = unknown> {
  key: string;
  value: T;
  updatedAt: string;
}
```

Repositories:

``` typescript
export interface GameRepository {
  create(game: PersistedGame): Promise<void>;
  update(game: PersistedGame): Promise<void>;
  getById(id: string): Promise<PersistedGame | undefined>;
  list(): Promise<readonly PersistedGame[]>;
  delete(id: string): Promise<void>;
}

export interface CalibrationRepository {
  create(profile: PersistedCalibration): Promise<void>;
  update(profile: PersistedCalibration): Promise<void>;
  getById(id: string): Promise<PersistedCalibration | undefined>;
  list(): Promise<readonly PersistedCalibration[]>;
  setActive(id: string): Promise<void>;
}

export interface SettingsRepository {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
}
```

Version schema and migrations. Persist game state and moves together.
Never store video by default. Handle storage/quota failures.
Export/import can be later phase.

# 12. State machine

``` mermaid
stateDiagram-v2
    [*] --> IDLE
    IDLE --> CAMERA_READY
    CAMERA_READY --> CALIBRATION
    CALIBRATION --> BOARD_RECOGNITION
    BOARD_RECOGNITION --> MANUAL_CORRECTION: uncertain
    MANUAL_CORRECTION --> BOARD_RECOGNITION
    BOARD_RECOGNITION --> READY: valid
    READY --> MONITORING: start
    MONITORING --> MOVE_CANDIDATE: board changed
    MOVE_CANDIDATE --> STABILIZING
    STABILIZING --> MOVE_INFERENCE
    MOVE_INFERENCE --> MONITORING: no match
    MOVE_INFERENCE --> RECONCILIATION: ambiguous
    MOVE_INFERENCE --> MOVE_COMMIT: accepted
    MOVE_COMMIT --> MONITORING: continuing
    MOVE_COMMIT --> GAME_FINISHED: result
    RECONCILIATION --> MONITORING: resolved
    MONITORING --> PAUSED
    PAUSED --> MONITORING
    GAME_FINISHED --> IDLE
```

Implement transitions in a controller/state-machine module, not
scattered handlers.

# 13. Sequence diagrams

## Calibration

``` mermaid
sequenceDiagram
    actor User
    participant UI
    participant Camera
    participant Worker
    participant Vision
    User->>UI: Select camera
    UI->>Camera: start(deviceId)
    Camera-->>UI: stream ready
    UI->>User: Preview and calibration
    User->>UI: Select corners
    UI->>Worker: CALIBRATE
    Worker->>Vision: validate and transform
    Vision-->>Worker: result
    Worker-->>UI: CALIBRATION_RESULT
    UI->>User: Normalized board
```

## Initial recognition

``` mermaid
sequenceDiagram
    actor User
    participant UI
    participant Capture
    participant Worker
    participant Stabilizer
    participant Engine
    User->>UI: Request recognition
    UI->>Capture: Schedule frames
    Capture->>Worker: PROCESS_FRAME
    Worker-->>UI: Recognition result
    UI->>Stabilizer: Add observation
    Stabilizer-->>UI: Stable board
    UI->>Engine: Validate position
    Engine-->>UI: Result
    UI->>User: Board/correction controls
```

## Move tracking

``` mermaid
sequenceDiagram
    actor Player
    participant Camera
    participant Worker
    participant Stabilizer
    participant Inference
    participant Engine
    participant Session
    participant DB
    participant UI
    Player->>Camera: Move piece
    Camera->>Worker: Frames
    Worker-->>Stabilizer: Observations
    Stabilizer-->>Inference: Stable observation
    Inference->>Engine: Legal moves/simulations
    Engine-->>Inference: Candidate outcomes
    Inference-->>Session: Candidate result
    Session->>Engine: Validate
    Engine-->>Session: Valid
    Session->>DB: Persist
    DB-->>Session: Commit
    Session-->>UI: Updated state
    UI-->>Player: Confirm move
```

## Recovery

``` mermaid
sequenceDiagram
    participant Vision
    participant Inference
    participant Session
    participant UI
    actor User
    Vision-->>Inference: Stable observation
    Inference-->>Session: No legal match
    Session-->>UI: Reconciliation required
    UI-->>User: Discrepancy and options
    User->>UI: Correct/retry/recalibrate
    UI->>Session: Submit correction
    Session-->>UI: Resolved or uncertain
```

# 14. Configuration

Centralize parameters; avoid magic numbers.

``` typescript
export interface VisionConfig {
  readonly normalizedBoardWidth: number;
  readonly normalizedBoardHeight: number;
  readonly analysisIntervalMs: number;
  readonly stabilityWindowSize: number;
  readonly stableObservationCount: number;
  readonly confidenceThresholds: {
    readonly high: number;
    readonly acceptable: number;
    readonly uncertain: number;
  };
  readonly roiInsetRatio: number;
  readonly classifier: {
    readonly colorThresholds: Readonly<Record<string, number>>;
    readonly shapeThresholds: Readonly<Record<string, number>>;
  };
}
```

Experimental defaults: 800x800 normalized board; 150--250ms analysis
interval; 3--5 stable observations; 500--1000ms stabilization target;
ROI inset around 15% per edge. Tune against physical tests.

# 15. Errors and UX

Explicit states/messages for permission denied, no camera, busy camera,
unsupported browser, worker failure, invalid calibration, board
movement, uncertainty, unknown piece, illegal candidate, ambiguity,
mismatch, storage failure and recovery.

Do not expose raw stack traces to users; diagnostic details may exist in
a developer panel.

# 16. Testing and acceptance

## Unit

-   Engine: board validation, legal moves, compulsory capture,
    multi-capture, king, flying king, promotion, results, serialization.
-   Vision: corner validation, grid, ROI, comparison, confidence,
    stability and candidate resolution.
-   Controller: transitions, duplicate prevention, reconciliation,
    pause/resume and persistence failure.

## Integration

Calibration→perspective→grid; grid→classification;
classification→observation; observation→stabilizer;
observation→inference; inference→engine; commit→repository. Use
deterministic fixtures.

## E2E

Setup, calibration, initial correction, game start, move confirmation,
ambiguity/recovery, pause/resume, undo if included, finish, save/reload.

## Physical test matrix

Bright/dim light, shadows, angle/distance, board relocation, slow/fast
movement, hand occlusion, off-square piece, capture piece removal delay,
multi-capture, promotion, kings, camera disconnect, reload.

## Initial measured targets (not guarantees)

-   Square mapping after valid calibration: 100%.
-   Controlled piece classification: target ≥95%.
-   Simple move inference: target ≥95%.
-   Capture inference: target ≥90% initially.
-   False move commits: effectively zero; prefer manual confirmation
    over false acceptance.
-   Confirmation latency: target ≤1s after stabilization.
-   Recognition failure must never corrupt authoritative game state.

# 17. Backlog and gates

## E0 --- Foundation

**E0-T01 Scaffold:** Angular standalone, strict TypeScript, Tailwind,
lint/format, tests, PWA baseline, README. Acceptance: build/test/lint
documented and passing.\
**E0-T02 Shell/routes:** folder structure, lazy routes, shell.
Acceptance: routes load; domain logic remains outside UI.\
**E0-T03 Validation scripts/CI baseline:** build, test, lint, E2E
placeholder.\
**Gate G0:** foundation validated.

## E1 --- Camera

**E1-T01 Device discovery:** enumerate devices and handle
permission-label behavior.\
**E1-T02 Lifecycle:** start/stop/select, permission/errors, cleanup.\
**E1-T03 Preview/status UI.**\
**E1-T04 Frame scheduler:** bounded in-flight frames, drop stale frames,
pause/resume.\
**Gate G1:** camera lifecycle stable, no leaked streams.

## E2 --- Calibration

**E2-T01 Corner-selection UI:** drag, edit, reset.\
**E2-T02 Validation:** bounds, distinctness, area, convexity, ordering.\
**E2-T03 OpenCV loader/resource management.**\
**E2-T04 Perspective transform.**\
**E2-T05 Grid mapper and playable-square overlay.**\
**E2-T06 Persist calibration.**\
**Gate G2:** calibration and geometry validated.

## E3 --- Recognition

**E3-T01 Typed configuration.**\
**E3-T02 ROI extraction.**\
**E3-T03 Feature extraction.**\
**E3-T04 Empty classification.**\
**E3-T05 Piece color classification and UNKNOWN.**\
**E3-T06 King baseline with standardized pieces/manual fallback.**\
**E3-T07 Observation assembly/confidence/warnings.**\
**E3-T08 Recognition overlay and correction.**\
**Gate G3:** measurable recognition and correction workflow.

## E4 --- Engine

**E4-T01 Board and coordinates.**\
**E4-T02 Regular-piece movement.**\
**E4-T03 Mandatory captures.**\
**E4-T04 Multi-capture.**\
**E4-T05 King/flying capture.**\
**E4-T06 Promotion.**\
**E4-T07 Results/draw interpretation.**\
**E4-T08 API and serialization.**\
**Gate G4:** rules engine test suite passes independently.

## E5 --- Stabilization/inference

**E5-T01 Bounded observation window.**\
**E5-T02 Stable board detector.**\
**E5-T03 Board difference utility.**\
**E5-T04 Legal candidate simulation.**\
**E5-T05 Candidate scoring and ambiguity.**\
**E5-T06 Capture reconciliation.**\
**E5-T07 Idempotency/duplicate prevention.**\
**Gate G5:** synthetic observation tests infer legal moves.

## E6 --- Game integration

**E6-T01 Game controller/state machine.**\
**E6-T02 Initial position validation.**\
**E6-T03 Commit protocol.**\
**E6-T04 Live UI.**\
**E6-T05 Recovery UI.**\
**E6-T06 Undo only if robust.**\
**Gate G6:** end-to-end workflow with deterministic observations.

## E7 --- Persistence

**E7-T01 IndexedDB schema/migrations.**\
**E7-T02 Game repository.**\
**E7-T03 Calibration repository.**\
**E7-T04 Settings repository.**\
**E7-T05 Persist game session/moves.**\
**E7-T06 History list.**\
**E7-T07 Reload/recovery.**\
**Gate G7:** data persists and failure handling works.

## E8 --- Release quality

**E8-T01 E2E. E8-T02 physical tests. E8-T03 profiling. E8-T04
resource-leak tests. E8-T05 PWA/offline. E8-T06 accessibility/responsive
review. E8-T07 release docs.**\
**Gate G8:** release candidate with measured results.

# 18. Claude Code workflow

Before each task: 1. Read specification and `CLAUDE.md`. 2. Inspect
repository, files, versions and environment. 3. Confirm current gate and
task. 4. List scope and affected files. 5. Implement only that task.

For each task: 1. Implement smallest complete increment. 2. Add/update
tests. 3. Run relevant tests. 4. Run lint/build as appropriate. 5.
Report exact changed files and commands/results. 6. Document deviations
and decisions. 7. At gate, stop and await approval unless autonomous
gate progression was explicitly authorized.

Prohibited: - Invent backend/cloud dependencies. - Bypass engine for
move commits. - Scatter thresholds or magic numbers. - Implement all
epics in one pass. - Ignore failing tests. - Claim commands were run
when they were not. - Silently change rules. - Add unrelated features. -
Use `any` as shortcut. - Leave camera/worker/OpenCV cleanup
incomplete. - Use production mock data outside isolated tests.

# 19. Initial CLAUDE.md

``` markdown
# Damas Vision — Claude Code Instructions

Damas Vision is a local-first Angular application using camera vision to recognize a physical Brazilian 64-square checkers board and track a game. The independent TypeScript engine is the authoritative game state. Vision observes and infers; it must not mutate the game directly.

## Source of truth
- `docs/execution-specification.md`
- Architecture documents in `docs/architecture/`
- Domain contracts and tests

If sources conflict, stop and report the conflict.

## Architecture
- Angular standalone, strict TypeScript, Tailwind.
- OpenCV.js MVP vision.
- Web Worker for non-trivial image processing.
- IndexedDB local persistence.
- No backend/cloud inference in MVP.
- Pure TypeScript domain engine.
- Recognition never directly mutates game state.
- Moves inferred and validated against legal engine moves.
- UNKNOWN and reconciliation are first-class.

## Workflow
- Implement current task/gate only.
- Inspect before changing.
- Add tests.
- Run tests/lint/build and report actual results.
- Do not silently proceed across gates.
- No unrelated features or dependency upgrades.

## Quality
- No unexplained any.
- Cleanup camera streams, workers and OpenCV resources.
- Bounded frame processing; drop stale frames.
- Explicit recovery and errors.
- Thin components, focused modules.
- Document deviations.

## First task
Begin E0 only. Inspect the repository/environment, scaffold the application and report proposed files/commands. Stop at Gate G0.
```

# 20. First Claude Code prompt

``` text
You are the senior engineer implementing Damas Vision.

Read:
- docs/execution-specification.md
- CLAUDE.md

Damas Vision is a local-first Angular app that recognizes a physical Brazilian 64-square checkers board and tracks human-vs-human play. The independent TypeScript engine is authoritative. Vision observes and infers; it cannot directly mutate game state.

Execution rules:
1. Inspect repository and environment.
2. Confirm existing state, versions and constraints.
3. Implement EPIC E0 only.
4. Do not start camera, calibration, recognition or engine epics yet.
5. Use Angular standalone, strict TypeScript and the specified repository structure.
6. Keep dependencies minimal and explain additions.
7. Establish reproducible build/test/lint.
8. Add documentation and application shell.
9. Run relevant validation.
10. Report exact files changed, commands, results, issues and decisions.

Do not claim tests or commands passed unless executed. Stop at Gate G0 and await approval.
```

# 21. Definition of done

-   [ ] Camera can be selected and started.
-   [ ] Four corners can be calibrated.
-   [ ] Perspective correction and grid mapping work.
-   [ ] Initial board recognized or manually corrected.
-   [ ] Engine implements documented Brazilian rules.
-   [ ] Stable observations are produced.
-   [ ] Legal physical moves are inferred.
-   [ ] Moves validated by engine.
-   [ ] Capture and multi-capture reconciled.
-   [ ] Promotion handled.
-   [ ] Recognition failures cannot corrupt authoritative state.
-   [ ] User can correct mismatch.
-   [ ] Games and moves persist.
-   [ ] Reload/recovery tested.
-   [ ] Unit/integration/E2E results documented.
-   [ ] Physical test matrix recorded.
-   [ ] PWA/offline behavior tested on supported devices.
-   [ ] Resource cleanup/performance verified.
-   [ ] README and user instructions complete.

# 22. Release checklist

**Engineering:** build, tests, lint, dependencies reviewed, no critical
issues, resource cleanup, migrations.\
**Functional:** calibration, recognition, correction, engine validation,
captures, promotion, history, recovery.\
**Physical:** lighting, angles, real captures, multi-captures, kings,
occlusion, camera interruption.\
**PWA:** HTTPS, install, offline resources, storage, browser
compatibility.

# 23. Architectural conclusion

Damas Vision is not a monolithic AI: - Geometry locates the board. -
Vision estimates pieces. - Stabilization determines observation
reliability. - Move inference compares observations with legal engine
outcomes. - Engine determines legality. - Session controller commits
changes. - Persistence protects authoritative state. - UI communicates
uncertainty and recovery.

The most important quality criterion is reliable synchronization between
the physical board and authoritative game state, with safe recovery
whenever vision is uncertain.
