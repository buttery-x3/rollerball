import { createPlayerTuning } from '../config/playerAttributes';
import { BALL_RADIUS_KEY, MOVEMENT_ACCELERATION_KEY, MOVEMENT_MAX_SPEED_KEY, PLAYER_RADIUS_KEY, type TuningReader } from '../config/tuning';
import type { ArenaDefinition } from '../physics/arena';
import { predictLooseBallTrajectory, type LooseBallTrajectoryPrediction } from '../physics/ballTrajectory';
import { constrainCircleToBounds, type Vec2 } from '../physics/geometry';
import type { GameState, PlayerState } from './gameState';
import { createGoalkeeperMovementTuning, getPlayerMovementBounds, getGoalkeeperSaveEnvelope } from './goalkeeping';

export function effectiveMovementTuning(player: PlayerState, tuning: TuningReader): TuningReader {
  return player.definition.role === 'goalkeeper' ? createGoalkeeperMovementTuning(player, tuning) : createPlayerTuning(player.definition.attributes, tuning);
}

/** Acceleration-limited estimate, accounting for velocity toward/away from target. */
export function estimateReachSeconds(player: PlayerState, target: Vec2, tuning: TuningReader, arena: ArenaDefinition, reachRadius = 0): number {
  const legal = constrainCircleToBounds(target, tuning.getNumber(PLAYER_RADIUS_KEY), getPlayerMovementBounds(player, arena)).position;
  if (Math.hypot(legal.x - target.x, legal.y - target.y) > reachRadius + 1e-9) return Infinity;
  const dx = target.x - player.position.x, dy = target.y - player.position.y;
  const distance = Math.hypot(dx, dy), travel = Math.max(0, distance - reachRadius);
  if (travel === 0) return 0;
  const effective = effectiveMovementTuning(player, tuning);
  const maxSpeed = effective.getNumber(MOVEMENT_MAX_SPEED_KEY);
  const acceleration = effective.getNumber(MOVEMENT_ACCELERATION_KEY);
  if (maxSpeed <= 0) return Infinity;
  const toward = Math.max(-maxSpeed, Math.min(maxSpeed, (player.velocity.x * dx + player.velocity.y * dy) / distance));
  if (acceleration <= 0) return toward > 0 ? travel / toward : Infinity;
  const toMax = (maxSpeed - toward) / acceleration;
  const accelerationDistance = toward * toMax + .5 * acceleration * toMax * toMax;
  const movingTime = travel <= accelerationDistance
    ? (-toward + Math.sqrt(toward * toward + 2 * acceleration * travel)) / acceleration
    : toMax + (travel - accelerationDistance) / maxSpeed;
  return movingTime + player.contact.stumbleTicksRemaining / 60;
}

export function predictBall(state: GameState, tuning: TuningReader, arena: ArenaDefinition): LooseBallTrajectoryPrediction | undefined {
  return state.ball.mode === 'loose' ? predictLooseBallTrajectory(state.ball, tuning, arena, { maxSteps: tuning.getNumber('keeper.predictionSteps') }) : undefined;
}

export interface ReachOpportunity {
  readonly position: Vec2;
  readonly height: number;
  readonly timeSeconds: number;
  readonly arrivalSeconds: number;
}

/** Shared trajectory samples and capability query, used by keeper planning and routing. */
export function firstReachableBall(player: PlayerState, prediction: LooseBallTrajectoryPrediction, tuning: TuningReader, arena: ArenaDefinition, radius: number, height: number, afterSeconds = 0): ReachOpportunity | undefined {
  const crossing = prediction.goalApertures.find(item => item.crossed);
  for (const sample of prediction.samples) {
    if (sample.timeSeconds < afterSeconds || sample.height > height || (crossing && sample.timeSeconds > crossing.timeSeconds)) continue;
    const arrivalSeconds = estimateReachSeconds(player, sample.position, tuning, arena, radius + tuning.getNumber(BALL_RADIUS_KEY));
    if (arrivalSeconds <= sample.timeSeconds) return { position: sample.position, height: sample.height, timeSeconds: sample.timeSeconds, arrivalSeconds };
  }
  return undefined;
}

export function keeperThreat(state: GameState, player: PlayerState, tuning: TuningReader, arena: ArenaDefinition, prediction = predictBall(state, tuning, arena)) {
  const crossing = prediction?.goalApertures.find(item => item.crossed && item.end === player.definition.defendingEnd);
  const envelope = getGoalkeeperSaveEnvelope(player, tuning);
  if (!prediction) return { crossing, ordinary: undefined, extended: undefined };
  const ordinary = firstReachableBall(player, prediction, tuning, arena, envelope.radius, envelope.height);
  // A commitment immediately reduces locomotion. Forecast that same capability
  // rather than promising a save that would require uncommitted running speed.
  const committedPlayer = { ...player, goalkeeper: { ...player.goalkeeper!, commitTicksRemaining: 1 } };
  const extended = firstReachableBall(committedPlayer, prediction, tuning, arena, tuning.getNumber('keeper.committedReach'), tuning.getNumber('keeper.committedHeight'));
  return { crossing, ordinary, extended };
}
