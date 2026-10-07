import {
  CONTACT_RESTITUTION_KEY,
  PLAYER_RADIUS_KEY,
  type TuningReader
} from '../config/tuning';
import type { ArenaDefinition } from '../physics/arena';
import type { Vec2 } from '../physics/geometry';
import {
  resolvePlayerCircleContacts,
  type PlayerContact
} from '../physics/playerContact';
import type { PlayerState } from './gameState';
import { getPlayerMovementBounds } from './goalkeeping';

export function resolvePlayerContacts(
  players: readonly PlayerState[],
  previousPositions: ReadonlyMap<string, Vec2>,
  tuning: TuningReader,
  arena: ArenaDefinition
): readonly PlayerContact[] {
  const result = resolvePlayerCircleContacts(
    players.map((player) => ({
      id: player.definition.id,
      previousPosition: previousPositions.get(player.definition.id) ?? player.position,
      position: player.position,
      velocity: player.velocity,
      radius: tuning.getNumber(PLAYER_RADIUS_KEY),
      bounds: getPlayerMovementBounds(player, arena)
    })),
    tuning.getNumber(CONTACT_RESTITUTION_KEY)
  );
  const playersById = new Map(players.map((player) => [player.definition.id, player]));
  for (const body of result.bodies) {
    const player = playersById.get(body.id)!;
    player.position = body.position;
    player.velocity = body.velocity;
  }
  return result.contacts;
}
