import type { Vec2 } from '../physics/geometry';

export type PlayerRole = 'field' | 'goalkeeper';

export interface PlayerDefinition {
  readonly id: string;
  readonly teamId: string;
  readonly role: PlayerRole;
}

export type ThrowChargeFamily = 'low' | 'high';

export interface ThrowChargeState {
  family: ThrowChargeFamily | undefined;
  elapsedSeconds: number;
  strength: number;
  progress: number;
}

export interface PlayerState {
  readonly definition: PlayerDefinition;
  position: Vec2;
  velocity: Vec2;
  facing: Vec2;
  throwCharge: ThrowChargeState;
}

export interface BallReleaseMetadata {
  readonly releasedById: string;
  reacquisitionLockoutTicksRemaining: number;
}

/**
 * Height is the clearance from the arena floor to the bottom of the ball.
 * The ball centre is therefore height + radius and a grounded ball has height 0.
 */
export interface LooseBallState {
  readonly mode: 'loose';
  position: Vec2;
  velocity: Vec2;
  height: number;
  verticalVelocity: number;
  release: BallReleaseMetadata | undefined;
}

export interface PossessedBallState {
  readonly mode: 'possessed';
  readonly holderId: string;
}

export type BallState = LooseBallState | PossessedBallState;

export interface GameState {
  tick: number;
  players: PlayerState[];
  ball: BallState;
}

export interface CreateFieldPlayerOptions {
  readonly id?: string;
  readonly teamId?: string;
  readonly position?: Vec2;
  readonly velocity?: Vec2;
  readonly facing?: Vec2;
  readonly throwCharge?: Partial<ThrowChargeState>;
}

export interface CreateLooseBallOptions {
  readonly position?: Vec2;
  readonly velocity?: Vec2;
  readonly height?: number;
  readonly verticalVelocity?: number;
  readonly release?: BallReleaseMetadata;
}

const DEFAULT_PLAYER_ID = 'player-1';
const DEFAULT_TEAM_ID = 'human';
const DEFAULT_POSITION: Vec2 = { x: 0, y: 0 };
const DEFAULT_VELOCITY: Vec2 = { x: 0, y: 0 };
const DEFAULT_FACING: Vec2 = { x: 0, y: 1 };
const DEFAULT_BALL_POSITION: Vec2 = { x: 0, y: 0 };
const DEFAULT_BALL_VELOCITY: Vec2 = { x: 0, y: 0 };

function cloneVector(vector: Vec2): Vec2 {
  return { x: vector.x, y: vector.y };
}

export function createEmptyThrowChargeState(): ThrowChargeState {
  return {
    family: undefined,
    elapsedSeconds: 0,
    strength: 0,
    progress: 0
  };
}

export function cloneThrowChargeState(state: ThrowChargeState): ThrowChargeState {
  return {
    family: state.family,
    elapsedSeconds: state.elapsedSeconds,
    strength: state.strength,
    progress: state.progress
  };
}

export function createFieldPlayerState(
  options: CreateFieldPlayerOptions = {}
): PlayerState {
  return {
    definition: {
      id: options.id ?? DEFAULT_PLAYER_ID,
      teamId: options.teamId ?? DEFAULT_TEAM_ID,
      role: 'field'
    },
    position: cloneVector(options.position ?? DEFAULT_POSITION),
    velocity: cloneVector(options.velocity ?? DEFAULT_VELOCITY),
    facing: cloneVector(options.facing ?? DEFAULT_FACING),
    throwCharge: {
      ...createEmptyThrowChargeState(),
      ...options.throwCharge
    }
  };
}

export function createLooseBallState(
  options: CreateLooseBallOptions = {}
): LooseBallState {
  return {
    mode: 'loose',
    position: cloneVector(options.position ?? DEFAULT_BALL_POSITION),
    velocity: cloneVector(options.velocity ?? DEFAULT_BALL_VELOCITY),
    height: options.height ?? 0,
    verticalVelocity: options.verticalVelocity ?? 0,
    release: options.release
  };
}

export function createPossessedBallState(holderId: string): PossessedBallState {
  if (!holderId.trim()) {
    throw new RangeError('A possessed ball holder ID must have a non-empty value.');
  }

  return { mode: 'possessed', holderId };
}

export function createGameState(): GameState {
  return { tick: 0, players: [], ball: createLooseBallState() };
}

export function createPlayableGameState(
  playerOptions: CreateFieldPlayerOptions = {}
): GameState {
  const player = createFieldPlayerState(playerOptions);

  return {
    tick: 0,
    players: [player],
    ball: createLooseBallState()
  };
}

export function createPlayablePossessedGameState(
  playerOptions: CreateFieldPlayerOptions = {}
): GameState {
  const player = createFieldPlayerState(playerOptions);

  return {
    tick: 0,
    players: [player],
    ball: createPossessedBallState(player.definition.id)
  };
}
