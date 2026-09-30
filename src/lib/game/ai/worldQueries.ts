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
import { estimateReachSeconds, predictBall, receiveOpportunities, type ReceiveOpportunity } from '../sim/ballQueries';
import type { GameState, PlayerState } from '../sim/gameState';
import { getGoalkeeperSaveEnvelope, getPlayerMovementBounds } from '../sim/goalkeeping';
import { evaluateReceiveDifficulty } from '../sim/receiveDifficulty';
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

export interface WorldQueries {
  player(playerId: string): ReadonlyPlayerState | undefined;
  teamPlayers(teamId: string): readonly ReadonlyPlayerState[];
  ballPosition(): Vec2;
  goal(teamId: string, defending?: boolean): ArenaGoalAperture;
  movementBounds(playerId: string): AxisAlignedBounds;
  trajectory(): LooseBallTrajectoryPrediction | undefined;
  reachSeconds(playerId: string, target: Vec2, reachRadius?: number): number;
  receivers(): readonly ReceiveOpportunity[];
  density(position: Vec2, teamId?: string, excludeId?: string): DensityQuery;
  goalSide(position: Vec2, teamId: string): boolean;
  lane(from: Vec2, to: Vec2, teamId: string, options?: LaneOptions): LaneQuery;
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

  return {
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
      const source = options.sourcePlayerId ? player(options.sourcePlayerId) : undefined;
      const launch = createBallThrowLaunch(family, { x: dx, y: dy }, options.strength ?? 1,
        source ? createPlayerTuning(source.definition.attributes, tuning) : tuning);
      const path = predictLooseBallTrajectory({ position: from, velocity: launch.velocity, height: 0,
        verticalVelocity: launch.verticalVelocity }, tuning, arena, { maxSteps: tuning.getNumber('ai.predictionSteps') });
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
}
