import { createTuningRegistry, PLAYER_RADIUS_KEY, type TuningReader } from '../config/tuning';
import { createArenaDefinition, type ArenaEnd } from '../physics/arena';
import { createFieldPlayerState, createGoalkeeperState, createLooseBallState, type GameState } from './gameState';
import { createMatchState } from './match';

export interface TeamDefinition {
  readonly id: string;
  readonly attackEnd: ArenaEnd;
  readonly playerIds: readonly string[];
}

/** Stable restart layout only; field responsibilities are assigned dynamically. */
const FIELD_SPAWNS = [
  { x: 0, y: .06 }, { x: -.28, y: .22 },
  { x: .28, y: .22 }, { x: 0, y: .34 }
] as const;

export function createTeamGameState(tuning: TuningReader = createTuningRegistry()): GameState {
  const arena = createArenaDefinition(tuning);
  const players = ['human', 'opponent'].flatMap((teamId) => {
    const sign = teamId === 'human' ? -1 : 1;
    const facing = { x: 0, y: -sign };
    const field = FIELD_SPAWNS.map((spawn, index) => createFieldPlayerState({
      id: `${teamId === 'human' ? 'player' : 'opponent'}-${index + 1}`, teamId, facing,
      position: { x: spawn.x * arena.width, y: sign * spawn.y * arena.length }
    }));
    return [...field, createGoalkeeperState({
      id: `${teamId}-keeper`, teamId, facing,
      defendingEnd: sign === -1 ? 'negativeY' : 'positiveY',
      position: { x: 0, y: sign * (arena.length / 2 - tuning.getNumber(PLAYER_RADIUS_KEY) - tuning.getNumber('keeper.setDepth')) }
    })];
  });
  const teams: readonly TeamDefinition[] = ['human', 'opponent'].map(id => Object.freeze({
    id, attackEnd: id === 'human' ? 'positiveY' as const : 'negativeY' as const,
    playerIds: Object.freeze(players.filter(player => player.definition.teamId === id).map(player => player.definition.id))
  }));
  return { tick: 0, players, teams: Object.freeze(teams), ball: createLooseBallState(), match: createMatchState(players) };
}
