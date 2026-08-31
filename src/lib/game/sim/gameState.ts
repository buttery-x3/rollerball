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

export interface GameState {
  tick: number;
  players: PlayerState[];
}

export interface CreateFieldPlayerOptions {
  readonly id?: string;
  readonly teamId?: string;
  readonly position?: Vec2;
  readonly velocity?: Vec2;
  readonly facing?: Vec2;
}

const DEFAULT_PLAYER_ID = 'player-1';
const DEFAULT_TEAM_ID = 'human';
const DEFAULT_POSITION: Vec2 = { x: 0, y: 0 };
const DEFAULT_VELOCITY: Vec2 = { x: 0, y: 0 };
const DEFAULT_FACING: Vec2 = { x: 0, y: 1 };

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

export function createGameState(): GameState {
  return { tick: 0, players: [] };
}

export function createPlayableGameState(
  playerOptions: CreateFieldPlayerOptions = {}
): GameState {
  return {
    tick: 0,
    players: [createFieldPlayerState(playerOptions)]
  };
}
