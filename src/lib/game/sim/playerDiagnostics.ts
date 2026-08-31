import {
  PLAYER_MOVEMENT_DIAGNOSTIC_LAYER,
  type DiagnosticRecord
} from './diagnostics';
import type { PlayerMovementObservation } from './playerMovement';

const COLLISION_COLOR = '#eb6f92';
const VELOCITY_COLOR = '#f6c177';
const DESIRED_MOVEMENT_COLOR = '#9ccfd8';
const FACING_COLOR = '#c4a7e7';

export function createPlayerDiagnosticRecords(
  tick: number,
  observation: PlayerMovementObservation
): readonly DiagnosticRecord[] {
  const data = {
    tick,
    playerId: observation.playerId,
    position: observation.position,
    velocity: observation.velocity,
    desiredMovement: observation.desiredMovement,
    desiredVelocity: observation.desiredVelocity,
    facing: observation.facing,
    radius: observation.radius,
    contacts: observation.contacts
  } satisfies Readonly<Record<string, unknown>>;

  return [
    {
      layer: PLAYER_MOVEMENT_DIAGNOSTIC_LAYER,
      source: 'fieldPlayerMovement',
      entityId: `${observation.playerId}-collision`,
      primitive: {
        type: 'circle',
        center: observation.position,
        radius: observation.radius,
        color: COLLISION_COLOR
      },
      data
    },
    {
      layer: PLAYER_MOVEMENT_DIAGNOSTIC_LAYER,
      source: 'fieldPlayerMovement',
      entityId: `${observation.playerId}-velocity`,
      primitive: {
        type: 'vector',
        origin: observation.position,
        direction: observation.velocity,
        color: VELOCITY_COLOR
      },
      data
    },
    {
      layer: PLAYER_MOVEMENT_DIAGNOSTIC_LAYER,
      source: 'fieldPlayerMovement',
      entityId: `${observation.playerId}-desired-movement`,
      primitive: {
        type: 'vector',
        origin: observation.position,
        direction: observation.desiredMovement,
        color: DESIRED_MOVEMENT_COLOR
      },
      data
    },
    {
      layer: PLAYER_MOVEMENT_DIAGNOSTIC_LAYER,
      source: 'fieldPlayerMovement',
      entityId: `${observation.playerId}-facing`,
      primitive: {
        type: 'vector',
        origin: observation.position,
        direction: observation.facing,
        color: FACING_COLOR
      },
      data
    },
    {
      layer: PLAYER_MOVEMENT_DIAGNOSTIC_LAYER,
      source: 'fieldPlayerMovement',
      entityId: `${observation.playerId}-state`,
      primitive: {
        type: 'label',
        position: {
          x: observation.position.x,
          y: observation.position.y + observation.radius + 0.35
        },
        text: `${observation.playerId} · ${observation.contacts.join(', ') || 'free'}`,
        color: COLLISION_COLOR
      },
      data
    }
  ];
}
