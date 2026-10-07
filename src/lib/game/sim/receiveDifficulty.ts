import type { TuningReader } from '../config/tuning';
import { playerControlCapacity } from '../config/playerAttributes';
import type { Vec2 } from '../physics/geometry';
import type { PlayerState } from './gameState';

export interface ReceiveDifficulty {
  readonly easy: boolean;
  readonly speed: number;
  readonly height: number;
  readonly approach: number;
  readonly contention: number;
  readonly redirect: number;
  readonly total: number;
  readonly control: number;
  readonly capacity: number;
  readonly succeeds: boolean;
}

/** Visible-state difficulty; no random failure or team-based catch eligibility. */
export function evaluateReceiveDifficulty(player: PlayerState, players: readonly PlayerState[], incomingVelocity: Vec2,
  height: number, tuning: TuningReader, redirectDirection?: Vec2): ReceiveDifficulty {
  const speed = Math.hypot(incomingVelocity.x - player.velocity.x, incomingVelocity.y - player.velocity.y);
  const incomingSpeed = Math.hypot(incomingVelocity.x, incomingVelocity.y);
  const incoming = incomingSpeed > 1e-9 ? { x: incomingVelocity.x / incomingSpeed, y: incomingVelocity.y / incomingSpeed } : { x: 0, y: 0 };
  const contention = players.filter(other => other.definition.teamId !== player.definition.teamId &&
    Math.hypot(other.position.x - player.position.x, other.position.y - player.position.y) < tuning.getNumber('receive.contentionRadius')).length * tuning.getNumber('receive.contentionWeight');
  const easy = speed <= tuning.getNumber('receive.easySpeed') && height <= tuning.getNumber('receive.easyHeight') && contention === 0;
  const approach = (1 + player.facing.x * incoming.x + player.facing.y * incoming.y) / 2 * tuning.getNumber('receive.approachWeight');
  const speedDifficulty = Math.max(0, speed - tuning.getNumber('receive.easySpeed')) / tuning.getNumber('receive.speedDifficultyScale');
  const heightDifficulty = height / Math.max(0.01, tuning.getNumber('receive.catchHeight')) * tuning.getNumber('receive.heightWeight');
  const redirectLength = redirectDirection ? Math.hypot(redirectDirection.x, redirectDirection.y) : 0;
  const redirect = redirectDirection && redirectLength > 1e-9
    ? (1 - (incoming.x * redirectDirection.x + incoming.y * redirectDirection.y) / redirectLength) / 2 * tuning.getNumber('receive.redirectWeight') : 0;
  const total = (easy ? 0 : speedDifficulty + heightDifficulty + approach + contention) + redirect;
  const capacity = playerControlCapacity(player.definition.attributes, tuning);
  return { easy, speed: speedDifficulty, height: heightDifficulty, approach, contention, redirect, total,
    control: player.definition.attributes.control, capacity, succeeds: total <= capacity };
}
