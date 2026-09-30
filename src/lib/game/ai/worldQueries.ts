import { createPlayerTuning } from '../config/playerAttributes';
import { BALL_RADIUS_KEY, PLAYER_RADIUS_KEY, type TuningReader } from '../config/tuning';
import type { ArenaDefinition, ArenaGoalAperture } from '../physics/arena';
import {
  createBallThrowLaunch,
  predictLooseBallTrajectory,
  type BallThrowFamily,
  type LooseBallTrajectoryPrediction
} from '../physics/ballTrajectory';
import type { AxisAlignedBounds, Vec2 } from '../physics/geometry';
import { estimateReachSeconds, keeperThreat, predictBall, receiveOpportunities, type ReachOpportunity, type ReceiveOpportunity } from '../sim/ballQueries';
import type { GameState, PlayerState } from '../sim/gameState';
import { getGoalkeeperSaveEnvelope, getPlayerMovementBounds } from '../sim/goalkeeping';
import { evaluateReceiveDifficulty, type ReceiveDifficulty } from '../sim/receiveDifficulty';
import { findPlayerBallContact } from '../sim/receiving';

export type DeepReadonly<T> = T extends readonly (infer Item)[]
  ? readonly DeepReadonly<Item>[]
  : T extends object ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> } : T;
export type ReadonlyGameState = DeepReadonly<GameState>;
export type ReadonlyPlayerState = DeepReadonly<PlayerState>;

export interface DensityQuery {
  readonly count: number;
  readonly weightedDensity: number;
  readonly nearestDistance: number | undefined;
}

export interface LaneOptions {
  readonly family?: BallThrowFamily;
  readonly strength?: number;
  readonly sourcePlayerId?: string;
  readonly originHeight?: number;
}

export interface LaneContact {
  readonly playerId: string;
  readonly position: Vec2;
  readonly timeSeconds: number;
  readonly height: number;
}

export interface LaneQuery {
  readonly clear: boolean;
  readonly reachesTarget: boolean;
  readonly travelTimeSeconds: number | undefined;
  readonly family: BallThrowFamily;
  readonly contacts: readonly LaneContact[];
}

export interface ThrowOpportunity {
  readonly launchVelocity: Vec2;
  readonly lane: LaneQuery;
  readonly receiver?: ReceiveOpportunity;
  readonly receiverContact?: { readonly timeSeconds: number; readonly difficulty: ReceiveDifficulty };
  readonly opposingReceiver?: ReceiveOpportunity;
  readonly goalCrossing?: LooseBallTrajectoryPrediction['goalApertures'][number];
  readonly keeperThreats: readonly { readonly playerId: string; readonly ordinaryTime?: number;
    readonly extendedTime?: number; readonly recovering: boolean }[];
}

export interface WorldQueries {
  player(playerId: string): ReadonlyPlayerState | undefined;
  teamPlayers(teamId: string): readonly ReadonlyPlayerState[];
  ballPosition(): Vec2;
  goal(teamId: string, defending?: boolean): ArenaGoalAperture;
  movementBounds(playerId: string): AxisAlignedBounds;
  trajectory(): LooseBallTrajectoryPrediction | undefined;
  reachSeconds(playerId: string, target: Vec2, reachRadius?: number): number;
  receivers(): readonly ReceiveOpportunity[];
  incomingContact(playerId: string): ReachOpportunity | undefined;
  density(position: Vec2, teamId?: string, excludeId?: string): DensityQuery;
  goalSide(position: Vec2, teamId: string): boolean;
  lane(from: Vec2, to: Vec2, teamId: string, options?: LaneOptions): LaneQuery;
  throwOpportunity(playerId: string, target: Vec2, family: BallThrowFamily, strength: number,
    receiverId?: string, origin?: Vec2, originHeight?: number): ThrowOpportunity;
  receiveDifficultyAt(playerId: string, opportunity: ReachOpportunity, redirect?: Vec2): ReceiveDifficulty;
}

/** Detached adapter for existing read-only simulation queries with mutable signatures. */
function snapshotPlayer(player: ReadonlyPlayerState): PlayerState {
  return {
    definition: { ...player.definition, attributes: { ...player.definition.attributes } },
    position: { ...player.position }, velocity: { ...player.velocity }, facing: { ...player.facing },
    throwCharge: { ...player.throwCharge },
    oneTouch: {
      charge: { ...player.oneTouch.charge },
      buffer: player.oneTouch.buffer ? { ...player.oneTouch.buffer, direction: { ...player.oneTouch.buffer.direction } } : undefined
    },
    contact: { ...player.contact, hitPlayerIds: [...player.contact.hitPlayerIds] },
    goalkeeper: player.goalkeeper ? { ...player.goalkeeper, saveDirection: { ...player.goalkeeper.saveDirection } } : undefined
  };
}

/**
 * All query results describe one simulation snapshot. No setter or authoritative
 * mutable reference escapes this boundary; shared physics is reused unchanged.
 */
export function createWorldQueries(state: ReadonlyGameState, arena: ArenaDefinition, tuning: TuningReader): WorldQueries {
  const snapshot: GameState = {
    tick: state.tick,
    players: state.players.map(snapshotPlayer),
    ball: state.ball.mode === 'possessed' ? { ...state.ball } : {
      ...state.ball, position: { ...state.ball.position }, velocity: { ...state.ball.velocity },
      release: state.ball.release ? { ...state.ball.release } : undefined
    }
  };
  const player = (id: string) => snapshot.players.find((candidate) => candidate.definition.id === id);
  const ballPosition = (): Vec2 => snapshot.ball.mode === 'loose' ? { ...snapshot.ball.position }
    : { ...player(snapshot.ball.holderId)!.position };
  const goal = (teamId: string, defending = false): ArenaGoalAperture => {
    const team = state.teams?.find((candidate) => candidate.id === teamId);
    const ownKeeper = snapshot.players.find((candidate) => candidate.definition.teamId === teamId && candidate.definition.role === 'goalkeeper');
    let end = team?.attackEnd ??
      (ownKeeper?.definition.defendingEnd === 'positiveY' ? 'negativeY'
        : ownKeeper?.definition.defendingEnd === 'negativeY' ? 'positiveY'
          : state.match?.attackingTeams.negativeY === teamId ? 'negativeY'
            : teamId === 'human' ? 'positiveY' : 'negativeY');
    if (defending) end = end === 'positiveY' ? 'negativeY' : 'positiveY';
    return { ...arena.goals.find((candidate) => candidate.end === end)! };
  };
  let prediction: LooseBallTrajectoryPrediction | undefined;
  let forecastRead = false;
  const trajectory = () => {
    if (!forecastRead) { prediction = predictBall(snapshot, tuning, arena); forecastRead = true; }
    return prediction;
  };

  const throwForecasts = new Map<string, { launch: ReturnType<typeof createBallThrowLaunch>; path: LooseBallTrajectoryPrediction }>();
  const forecastThrow = (from: Vec2, to: Vec2, sourceId: string | undefined,
    family: BallThrowFamily, strength: number, height = 0) => {
    const key = JSON.stringify([from, to, sourceId, family, strength, height]);
    let forecast = throwForecasts.get(key);
    if (!forecast) {
      const source = sourceId ? player(sourceId) : undefined;
      const launch = createBallThrowLaunch(family, { x: to.x - from.x, y: to.y - from.y }, strength,
        source ? createPlayerTuning(source.definition.attributes, tuning) : tuning);
      forecast = { launch, path: predictLooseBallTrajectory({ position: from, velocity: launch.velocity,
        height, verticalVelocity: launch.verticalVelocity }, tuning, arena, { maxSteps: tuning.getNumber('ai.predictionSteps') }) };
      throwForecasts.set(key, forecast);
    }
    return forecast;
  };

  const queries: WorldQueries = {
    player,
    teamPlayers: (teamId) => snapshot.players.filter((candidate) => candidate.definition.teamId === teamId),
    ballPosition,
    goal,
    movementBounds: (id) => {
      const current = player(id);
      if (!current) throw new Error(`Unknown player '${id}'.`);
      return { ...getPlayerMovementBounds(current, arena) };
    },
    trajectory,
    reachSeconds: (id, target, reachRadius = 0) => {
      const current = player(id);
      return current ? estimateReachSeconds(current, target, tuning, arena, reachRadius) : Infinity;
    },
    receivers: () => receiveOpportunities(snapshot, tuning, arena, trajectory()),
    incomingContact(id) {
      const current = player(id);
      const path = trajectory();
      if (!current || !path || snapshot.ball.mode !== 'loose' ||
          (snapshot.ball.release?.releasedById === id && snapshot.ball.release.reacquisitionLockoutTicksRemaining > 0)) return undefined;
      const goalTime = path.goalApertures.find((crossing) => crossing.crossed)?.timeSeconds;
      for (const segment of path.segments) {
        if (goalTime !== undefined && segment.startTimeSeconds > goalTime) break;
        const contact = findPlayerBallContact(segment, current, { ballRadius: tuning.getNumber(BALL_RADIUS_KEY),
          playerRadius: tuning.getNumber(PLAYER_RADIUS_KEY), catchHeight: tuning.getNumber('receive.catchHeight') });
        if (contact && (goalTime === undefined || contact.timeSeconds <= goalTime)) return {
          position: contact.position, height: contact.height, timeSeconds: contact.timeSeconds,
          arrivalSeconds: 0, incomingVelocity: contact.incomingVelocity };
      }
      return undefined;
    },
    receiveDifficultyAt(id, opportunity, redirect) {
      const current = player(id);
      if (!current) throw new Error(`Unknown receiver '${id}'.`);
      return evaluateReceiveDifficulty({ ...current, position: opportunity.position }, snapshot.players,
        opportunity.incomingVelocity, opportunity.height, tuning, redirect);
    },
    throwOpportunity(id, target, family, strength, receiverId, origin, originHeight = 0) {
      const source = player(id);
      if (!source) throw new Error(`Unknown thrower '${id}'.`);
      const from = origin ?? source.position;
      const { launch, path } = forecastThrow(from, target, id, family, strength, originHeight);
      const future: GameState = { tick: snapshot.tick, players: snapshot.players,
        ball: { mode: 'loose', position: from, velocity: launch.velocity, height: originHeight,
          verticalVelocity: launch.verticalVelocity, release: { releasedById: id, reacquisitionLockoutTicksRemaining: 1 } } };
      const receivers = receiveOpportunities(future, tuning, arena, path);
      const intended = receiverId ? player(receiverId) : undefined;
      let receiverContact: ThrowOpportunity['receiverContact'];
      if (intended) for (const segment of path.segments) {
        const contact = findPlayerBallContact(segment, intended, { ballRadius: tuning.getNumber(BALL_RADIUS_KEY),
          playerRadius: tuning.getNumber(PLAYER_RADIUS_KEY), catchHeight: tuning.getNumber('receive.catchHeight') });
        if (contact) {
          receiverContact = { timeSeconds: contact.timeSeconds,
            difficulty: evaluateReceiveDifficulty(intended, snapshot.players, contact.incomingVelocity, contact.height, tuning) };
          break;
        }
      }
      return {
        launchVelocity: { ...launch.velocity },
        lane: queries.lane(from, target, source.definition.teamId, { family, strength, sourcePlayerId: id, originHeight }),
        receiver: receivers.find((candidate) => candidate.playerId === receiverId),
        receiverContact,
        opposingReceiver: receivers.find((candidate) => candidate.teamId !== source.definition.teamId),
        goalCrossing: path.goalApertures.find((crossing) => crossing.crossed && crossing.end === goal(source.definition.teamId).end),
        keeperThreats: snapshot.players.filter((candidate) => candidate.definition.role === 'goalkeeper' &&
          candidate.definition.teamId !== source.definition.teamId).map((keeper) => {
            const threat = keeperThreat(future, keeper, tuning, arena, path);
            return { playerId: keeper.definition.id, ordinaryTime: threat.ordinary?.timeSeconds,
              extendedTime: keeper.goalkeeper!.recoveryTicksRemaining === 0 ? threat.extended?.timeSeconds : undefined,
              recovering: keeper.goalkeeper!.recoveryTicksRemaining > 0 };
          })
      };
    },
    density(position, teamId, excludeId) {
      const radius = tuning.getNumber('ai.densityRadius');
      const distances = snapshot.players.filter((candidate) => candidate.definition.id !== excludeId &&
        (teamId === undefined || candidate.definition.teamId === teamId))
        .map((candidate) => Math.hypot(candidate.position.x - position.x, candidate.position.y - position.y));
      return {
        count: distances.filter((distance) => distance < radius).length,
        weightedDensity: radius > 0 ? distances.reduce((sum, distance) => sum + Math.max(0, 1 - distance / radius), 0) : 0,
        nearestDistance: distances.length > 0 ? Math.min(...distances) : undefined
      };
    },
    goalSide(position, teamId) {
      const ball = ballPosition();
      return (position.y - ball.y) * (goal(teamId, true).planeY - ball.y) >= 0;
    },
    lane(from, to, teamId, options = {}) {
      const family = options.family ?? 'low';
      const dx = to.x - from.x, dy = to.y - from.y, distance = Math.hypot(dx, dy);
      if (distance <= 1e-9) return { clear: true, reachesTarget: true, travelTimeSeconds: 0, family, contacts: [] };
      const { path } = forecastThrow(from, to, options.sourcePlayerId, family, options.strength ?? 1, options.originHeight);
      const direction = { x: dx / distance, y: dy / distance };
      let travelTimeSeconds: number | undefined;
      for (const segment of path.segments) {
        const startProjection = (segment.start.x - from.x) * direction.x + (segment.start.y - from.y) * direction.y;
        const endProjection = (segment.end.x - from.x) * direction.x + (segment.end.y - from.y) * direction.y;
        if (endProjection >= distance - 1e-9 && endProjection > startProjection) {
          const ratio = Math.max(0, (distance - startProjection) / (endProjection - startProjection));
          travelTimeSeconds = segment.startTimeSeconds + (segment.endTimeSeconds - segment.startTimeSeconds) * ratio;
          break;
        }
      }
      // The ball centre reaches an aperture one radius inside the goal plane.
      const goalCrossing = path.goalApertures.find((crossing) => crossing.crossed &&
        Math.hypot(crossing.position.x - to.x, crossing.position.y - to.y) <= tuning.getNumber(BALL_RADIUS_KEY) + 1e-8);
      if (goalCrossing && (travelTimeSeconds === undefined || goalCrossing.timeSeconds < travelTimeSeconds)) {
        travelTimeSeconds = goalCrossing.timeSeconds;
      }
      const contacts: LaneContact[] = [];
      for (const opponent of snapshot.players.filter((candidate) => candidate.definition.teamId !== teamId)) {
        const keeper = opponent.definition.role === 'goalkeeper' ? getGoalkeeperSaveEnvelope(opponent, tuning) : undefined;
        for (const segment of path.segments) {
          if (travelTimeSeconds !== undefined && segment.startTimeSeconds > travelTimeSeconds) break;
          const contact = findPlayerBallContact(segment, opponent, { ballRadius: tuning.getNumber(BALL_RADIUS_KEY),
            playerRadius: keeper?.radius ?? tuning.getNumber(PLAYER_RADIUS_KEY),
            catchHeight: keeper?.height ?? tuning.getNumber('receive.catchHeight') });
          if (!contact || (travelTimeSeconds !== undefined && contact.timeSeconds > travelTimeSeconds)) continue;
          if (!keeper && contact.height > tuning.getNumber('receive.bodyHeight') &&
              !evaluateReceiveDifficulty(opponent, snapshot.players, contact.incomingVelocity, contact.height, tuning).succeeds) continue;
          contacts.push({ playerId: opponent.definition.id, position: contact.position,
            timeSeconds: contact.timeSeconds, height: contact.height });
          break;
        }
      }
      contacts.sort((first, second) => first.timeSeconds - second.timeSeconds ||
        (first.playerId < second.playerId ? -1 : first.playerId > second.playerId ? 1 : 0));
      return { clear: travelTimeSeconds !== undefined && contacts.length === 0,
        reachesTarget: travelTimeSeconds !== undefined, travelTimeSeconds, family, contacts };
    }
  };
  return queries;
}
