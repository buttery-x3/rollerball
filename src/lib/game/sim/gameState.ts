import type { Vec2 } from '../physics/geometry';

export type PlayerRole = 'field' | 'goalkeeper';

export interface PlayerDefinition {
  readonly id: string;
  readonly teamId: string;
  readonly role: PlayerRole;
}

export interface PlayerState {
  readonly definition: PlayerDefinition;
  position: Vec2;
  velocity: Vec2;
  facing: Vec2;
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
}

export type BallState = LooseBallState;

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
}

export interface CreateLooseBallOptions {
  readonly position?: Vec2;
  readonly velocity?: Vec2;
  readonly height?: number;
  readonly verticalVelocity?: number;
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
    facing: cloneVector(options.facing ?? DEFAULT_FACING)
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
    verticalVelocity: options.verticalVelocity ?? 0
  };
}

export function createGameState(): GameState {
  return { tick: 0, players: [], ball: createLooseBallState() };
}

export function createPlayableGameState(
  playerOptions: CreateFieldPlayerOptions = {}
): GameState {
  return {
    tick: 0,
    players: [createFieldPlayerState(playerOptions)],
    ball: createLooseBallState()
  };
}
