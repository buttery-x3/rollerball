import type { TuningReader } from '../config/tuning';
import { PLAYER_RADIUS_KEY, MOVEMENT_MAX_SPEED_KEY } from '../config/tuning';
import { createNeutralPlayerIntent } from '../control/intent';
import type { RoutedPlayerIntent } from '../control/types';
import type { ArenaDefinition } from '../physics/arena';
import { constrainCircleToBounds } from '../physics/geometry';
import type { DiagnosticSink } from '../sim/diagnostics';
import type { GameState, PlayerState } from '../sim/gameState';
import { effectiveMovementTuning, keeperThreat, predictBall } from '../sim/ballQueries';
import { getPlayerMovementBounds } from '../sim/goalkeeping';

/** Reads released trajectory/world state only; never sees human input. */
export function goalkeeperIntent(state: GameState, player: PlayerState, tuning: TuningReader, arena: ArenaDefinition, diagnostics?: DiagnosticSink): RoutedPlayerIntent {
  const ballPosition = state.ball.mode === 'loose' ? state.ball.position : state.players.find(p => state.ball.mode === 'possessed' && p.definition.id === state.ball.holderId)!.position;
  const end = player.definition.defendingEnd!;
  const goal = arena.goals.find(g => g.end === end)!;
  const inward = end === 'positiveY' ? -1 : 1;
  const distanceFromGoal = Math.abs(ballPosition.y - goal.planeY);
  const depth = tuning.getNumber('keeper.setDepth') * Math.max(0, 1 - distanceFromGoal / tuning.getNumber('keeper.stepOutDistance'));
  let target = { x: ballPosition.x * tuning.getNumber('keeper.trackingWidth'), y: goal.planeY + inward * (tuning.getNumber(PLAYER_RADIUS_KEY) + depth) };
  const prediction = predictBall(state, tuning, arena);
  const threat = keeperThreat(state, player, tuning, arena, prediction);
  const reachable = threat.ordinary ?? threat.extended;
  if (threat.crossing && reachable) target = { ...reachable.position };
  else if (state.ball.mode === 'loose' && state.ball.height > tuning.getNumber('keeper.ordinaryHeight')) target.y = goal.planeY + inward * tuning.getNumber(PLAYER_RADIUS_KEY);
  target = constrainCircleToBounds(target, tuning.getNumber(PLAYER_RADIUS_KEY), getPlayerMovementBounds(player, arena)).position;
  const delta = { x: target.x - player.position.x, y: target.y - player.position.y };
  const distance = Math.hypot(delta.x, delta.y);
  const maxSpeed = effectiveMovementTuning(player, tuning).getNumber(MOVEMENT_MAX_SPEED_KEY);
  const speedScale = Math.max(1e-9, maxSpeed * tuning.getNumber('keeper.steeringTime'));
  const magnitude = Math.min(1, distance / speedScale);
  const commit = !!threat.crossing && !threat.ordinary && !!threat.extended &&
    threat.extended.timeSeconds <= tuning.getNumber('keeper.commitLeadSeconds') &&
    player.goalkeeper?.commitTicksRemaining === 0 && player.goalkeeper.recoveryTicksRemaining === 0;
  const facing = { x: ballPosition.x - player.position.x, y: ballPosition.y - player.position.y };
  const intent = createNeutralPlayerIntent({
    movement: distance > 1e-9 ? { x: delta.x / distance * magnitude, y: delta.y / distance * magnitude } : { x: 0, y: 0 },
    desiredFacing: facing, save: { held: commit, pressed: commit, released: false }
  });
  if (diagnostics?.isLayerEnabled('keeper')) {
    diagnostics.publish({ layer: 'keeper', source: 'goalkeeperController', entityId: `${player.definition.id}-decision`,
      primitive: { type: 'line', start: player.position, end: target, color: '#f2d35b' },
      data: { tick: state.tick + 1, playerId: player.definition.id, target, threat, commit, intent,
        reason: commit ? 'extended-save-needed' : threat.ordinary ? 'ordinary-intercept' : 'track-world-ball' } });
  }
  return { playerId: player.definition.id, intent };
}
