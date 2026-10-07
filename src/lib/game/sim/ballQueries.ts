import { createPlayerTuning } from '../config/playerAttributes';
import { BALL_RADIUS_KEY, MOVEMENT_ACCELERATION_KEY, MOVEMENT_MAX_SPEED_KEY, PLAYER_RADIUS_KEY, type TuningReader } from '../config/tuning';
import type { ArenaDefinition } from '../physics/arena';
import { predictLooseBallTrajectory, type LooseBallTrajectoryPrediction } from '../physics/ballTrajectory';
import { constrainCircleToBounds, type Vec2 } from '../physics/geometry';
import type { GameState, PlayerState } from './gameState';
import { createGoalkeeperMovementTuning, getPlayerMovementBounds, getGoalkeeperSaveEnvelope } from './goalkeeping';
import { evaluateReceiveDifficulty, type ReceiveDifficulty } from './receiveDifficulty';

export function effectiveMovementTuning(player: PlayerState, tuning: TuningReader): TuningReader {
  return player.definition.role === 'goalkeeper' ? createGoalkeeperMovementTuning(player, tuning) : createPlayerTuning(player.definition.attributes, tuning);
}

/** Acceleration-limited estimate, accounting for velocity toward/away from target. */
export function estimateReachSeconds(player: PlayerState, target: Vec2, tuning: TuningReader, arena: ArenaDefinition, reachRadius = 0): number {
  const legal = constrainCircleToBounds(target, tuning.getNumber(PLAYER_RADIUS_KEY), getPlayerMovementBounds(player, arena)).position;
  if (Math.hypot(legal.x - target.x, legal.y - target.y) > reachRadius + 1e-9) return Infinity;
  const dx = target.x - player.position.x, dy = target.y - player.position.y;
  const distance = Math.hypot(dx, dy), travel = Math.max(0, distance - reachRadius);
  if (travel === 0) return player.contact.stumbleTicksRemaining / 60;
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
  readonly incomingVelocity: Vec2;
}

/** Shared trajectory samples and capability query, used by keeper planning and routing. */
export function firstReachableBall(player: PlayerState, prediction: LooseBallTrajectoryPrediction, tuning: TuningReader, arena: ArenaDefinition, radius: number, height: number, afterSeconds = 0, accept?: (opportunity: ReachOpportunity) => boolean): ReachOpportunity | undefined {
  const crossing = prediction.goalApertures.find(item => item.crossed);
  for (const sample of prediction.samples) {
    if (sample.timeSeconds < afterSeconds || sample.height > height || (crossing && sample.timeSeconds > crossing.timeSeconds)) continue;
    const arrivalSeconds = estimateReachSeconds(player, sample.position, tuning, arena, radius + tuning.getNumber(BALL_RADIUS_KEY));
    if (arrivalSeconds <= sample.timeSeconds) {
      const opportunity = { position: sample.position, height: sample.height, timeSeconds: sample.timeSeconds, arrivalSeconds, incomingVelocity: sample.velocity };
      if (!accept || accept(opportunity)) return opportunity;
    }
  }
  return undefined;
}

export interface ReceiveOpportunity extends ReachOpportunity {
  readonly playerId: string;
  readonly teamId: string;
  readonly difficulty: ReceiveDifficulty;
  /** Earliest opposing field receive or keeper save opportunity on this path. */
  readonly opponentArrivalSeconds?: number;
}

/** Read-only field receiving opportunities over the actual shared ball forecast. */
export function receiveOpportunities(
  state: GameState,
  tuning: TuningReader,
  arena: ArenaDefinition,
  prediction = state.ball.mode === 'loose'
    ? predictLooseBallTrajectory(state.ball, tuning, arena, { maxSteps: tuning.getNumber('controls.receiverPredictionSteps') })
    : undefined
): readonly ReceiveOpportunity[] {
  if (state.ball.mode !== 'loose' || !prediction) return [];
  const looseBall = state.ball;
  const opportunities: Omit<ReceiveOpportunity, 'opponentArrivalSeconds'>[] = [];
  const keeperOpportunities: { teamId: string; timeSeconds: number }[] = [];
  for (const player of state.players) {
    // An active release lockout excludes this player from current claims. Do
    // not switch control back to a thrower based on a hypothetical sprint to
    // reacquire the same outgoing ball after the lockout expires. A subsequent
    // query can consider a real reachable return once eligibility is restored.
    if (looseBall.release?.releasedById === player.definition.id &&
        looseBall.release.reacquisitionLockoutTicksRemaining > 0) continue;
    const afterSeconds = looseBall.release?.releasedById === player.definition.id
      ? looseBall.release.reacquisitionLockoutTicksRemaining / 60 : 0;
    if (player.definition.role === 'goalkeeper') {
      const envelope = getGoalkeeperSaveEnvelope(player, tuning);
      const opportunity = firstReachableBall(player, prediction, tuning, arena, envelope.radius, envelope.height, afterSeconds);
      if (opportunity) keeperOpportunities.push({ teamId: player.definition.teamId, timeSeconds: opportunity.timeSeconds });
      continue;
    }
    let difficulty: ReceiveDifficulty | undefined;
    const opportunity = firstReachableBall(player, prediction, tuning, arena,
      tuning.getNumber(PLAYER_RADIUS_KEY), tuning.getNumber('receive.catchHeight'), afterSeconds,
      (candidate) => {
        // Evaluate catch capability at the reachable location, preserving the
        // current visible facing/velocity and the same Control difficulty rule.
        const projected = { ...player, position: constrainCircleToBounds(candidate.position,
          tuning.getNumber(PLAYER_RADIUS_KEY), arena.bounds).position };
        difficulty = evaluateReceiveDifficulty(projected, state.players, candidate.incomingVelocity, candidate.height, tuning);
        return difficulty.succeeds;
      });
    if (opportunity && difficulty) opportunities.push({ ...opportunity,
      playerId: player.definition.id, teamId: player.definition.teamId, difficulty });
  }
  return opportunities.map((opportunity) => {
    const opposing = [...opportunities, ...keeperOpportunities]
      .filter((candidate) => candidate.teamId !== opportunity.teamId)
      .map((candidate) => candidate.timeSeconds);
    return { ...opportunity,
      opponentArrivalSeconds: opposing.length > 0 ? Math.min(...opposing) : undefined };
  }).sort((first, second) => first.timeSeconds - second.timeSeconds ||
    (first.playerId < second.playerId ? -1 : first.playerId > second.playerId ? 1 : 0));
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
