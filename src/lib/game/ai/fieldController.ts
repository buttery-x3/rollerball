import { createPlayerTuning } from '../config/playerAttributes';
import { MOVEMENT_MAX_SPEED_KEY, MOVEMENT_BRAKING_KEY, PLAYER_RADIUS_KEY, type TuningReader } from '../config/tuning';
import { createNeutralPlayerIntent } from '../control/intent';
import type { RoutedPlayerIntent } from '../control/types';
import type { ArenaDefinition } from '../physics/arena';
import { constrainCircleToBounds } from '../physics/geometry';
import type { DiagnosticSink } from '../sim/diagnostics';
import type { TacticalAssignment } from '../sim/tactics';
import { createWorldQueries, type ReadonlyGameState } from './worldQueries';

/** Steering produces the same analog movement/facing contract as human input. */
export function fieldPlayerIntent(state: ReadonlyGameState, assignment: TacticalAssignment,
  tuning: TuningReader, arena: ArenaDefinition, diagnostics?: DiagnosticSink): RoutedPlayerIntent {
  const world = createWorldQueries(state, arena, tuning);
  const player = world.player(assignment.playerId);
  if (!player || player.definition.role !== 'field') throw new Error(`Missing field player '${assignment.playerId}'.`);
  const target = constrainCircleToBounds(assignment.target, tuning.getNumber(PLAYER_RADIUS_KEY),
    world.movementBounds(assignment.playerId)).position;
  const delta = { x: target.x - player.position.x, y: target.y - player.position.y };
  const distance = Math.hypot(delta.x, delta.y);
  const movementTuning = createPlayerTuning(player.definition.attributes, tuning);
  const maxSpeed = movementTuning.getNumber(MOVEMENT_MAX_SPEED_KEY);
  const braking = movementTuning.getNumber(MOVEMENT_BRAKING_KEY);
  const arrival = tuning.getNumber('ai.arrivalRadius');
  const remaining = Math.max(0, distance - arrival);
  const speed = Math.min(maxSpeed, remaining / tuning.getNumber('ai.steeringTime'), Math.sqrt(2 * braking * remaining));
  // Aim from the momentum-projected position so a lateral or overshooting skater
  // starts correcting before reaching the target. Simulation still owns braking.
  const lookahead = tuning.getNumber('ai.inertiaLookahead');
  const steering = { x: delta.x - player.velocity.x * lookahead, y: delta.y - player.velocity.y * lookahead };
  const steeringDistance = Math.hypot(steering.x, steering.y);
  const movement = steeringDistance > 1e-9 && maxSpeed > 0
    ? { x: steering.x / steeringDistance * speed / maxSpeed, y: steering.y / steeringDistance * speed / maxSpeed }
    : { x: 0, y: 0 };
  const ball = world.ballPosition();
  const isCarrier = state.ball.mode === 'possessed' && state.ball.holderId === assignment.playerId;
  const facingTarget = isCarrier ? { x: 0, y: world.goal(assignment.teamId).planeY } : ball;
  const context = state.tactics?.teams.find((team) => team.teamId === assignment.teamId)?.context;
  const intent = createNeutralPlayerIntent({ movement,
    desiredFacing: { x: facingTarget.x - player.position.x, y: facingTarget.y - player.position.y },
    actionContext: isCarrier ? 'possessed' : context === 'opponent-possession' ? 'defending' : 'neutral' });
  if (diagnostics?.isLayerEnabled('ai')) diagnostics.publish({ layer: 'ai', source: 'fieldController',
    entityId: `${assignment.playerId}-field-intent`,
    primitive: { type: 'label', position: player.position, text: `${assignment.role} · ${assignment.reason}` },
    data: { tick: state.tick, context, ...assignment, target, intent, currentVelocity: player.velocity } });
  return { playerId: assignment.playerId, intent };
}
