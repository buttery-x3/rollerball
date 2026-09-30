import {
  BALL_POST_RELEASE_LOCKOUT_TICKS_KEY,
  BALL_RADIUS_KEY,
  MOVEMENT_ACCELERATION_KEY,
  MOVEMENT_BRAKING_KEY,
  MOVEMENT_FACING_RESPONSE_KEY,
  MOVEMENT_MAX_SPEED_KEY,
  MOVEMENT_REVERSAL_RESPONSE_KEY,
  MOVEMENT_TURNING_RESPONSE_KEY,
  type TuningReader
} from '../config/tuning';
import { createPlayerTuning } from '../config/playerAttributes';
import { routedInputs, type SimulationInput } from '../control/types';
import type { ArenaDefinition } from '../physics/arena';
import { reflectVelocity } from '../physics/ballTrajectory';
import type { AxisAlignedBounds, Vec2 } from '../physics/geometry';
import type { DiagnosticSink } from './diagnostics';
import {
  createEmptyOneTouchState,
  createEmptyThrowChargeState,
  createLooseBallState,
  createPossessedBallState,
  type GameState,
  type PlayerState
} from './gameState';

const EPSILON = 1e-9;

export interface GoalkeeperSaveEnvelope {
  /** Player reach; the shared ball sweep additionally includes ball radius. */
  readonly radius: number;
  readonly height: number;
  readonly committed: boolean;
  readonly recovering: boolean;
}

export interface GoalkeeperSaveContact {
  readonly timeSeconds: number;
  readonly position: Vec2;
  readonly height: number;
  readonly incomingVelocity: Vec2;
}

export interface GoalkeeperSaveFactors {
  readonly relativeSpeed: number;
  readonly alignment: number;
  readonly stretch: number;
  readonly heightRatio: number;
  readonly committed: boolean;
  readonly recovering: boolean;
  readonly control: number;
  readonly difficulty: number;
  readonly capacity: number;
  readonly reason: 'controlled-catch' | 'difficulty-exceeds-control';
}

export interface GoalkeeperSaveObservation {
  readonly outcome: 'keeper-catch' | 'keeper-parry';
  readonly playerId: string;
  readonly teamId: string;
  readonly contactTimeSeconds: number;
  readonly contactPosition: Vec2;
  readonly contactHeight: number;
  readonly save: GoalkeeperSaveFactors;
  readonly outgoingVelocity?: Vec2;
}

/** One legal-space query is shared by movement, separation, resets and AI. */
export function getPlayerMovementBounds(player: PlayerState, arena: ArenaDefinition): AxisAlignedBounds {
  if (player.definition.role === 'field') return arena.bounds;
  const crease = arena.keeperCreases.find((candidate) => candidate.end === player.definition.defendingEnd);
  if (!crease) throw new Error(`Goalkeeper '${player.definition.id}' requires a valid defended end.`);
  return crease.bounds;
}

const KEEPER_MOVEMENT_KEYS: Readonly<Record<string, string>> = {
  [MOVEMENT_MAX_SPEED_KEY]: 'keeper.maxSpeed',
  [MOVEMENT_ACCELERATION_KEY]: 'keeper.acceleration',
  [MOVEMENT_BRAKING_KEY]: 'keeper.braking',
  [MOVEMENT_FACING_RESPONSE_KEY]: 'keeper.facingResponse',
  [MOVEMENT_REVERSAL_RESPONSE_KEY]: 'keeper.reversalResponse',
  [MOVEMENT_TURNING_RESPONSE_KEY]: 'keeper.turningResponse'
};

/** Applies the same attribute mappings to the keeper's high-grip base profile. */
export function createGoalkeeperBaseTuning(player: PlayerState, tuning: TuningReader): TuningReader {
  return {
    getNumber(key) {
      let value = tuning.getNumber(KEEPER_MOVEMENT_KEYS[key] ?? key);
      if (key === MOVEMENT_MAX_SPEED_KEY && player.goalkeeper &&
          (player.goalkeeper.commitTicksRemaining > 0 || player.goalkeeper.recoveryTicksRemaining > 0)) {
        value *= tuning.getNumber('keeper.recoveryMovementScale');
      }
      return value;
    }
  };
}

export function createGoalkeeperMovementTuning(player: PlayerState, tuning: TuningReader): TuningReader {
  return createPlayerTuning(player.definition.attributes, createGoalkeeperBaseTuning(player, tuning));
}

export function getGoalkeeperSaveEnvelope(player: PlayerState, tuning: TuningReader): GoalkeeperSaveEnvelope {
  if (player.definition.role !== 'goalkeeper' || !player.goalkeeper) {
    throw new Error(`Player '${player.definition.id}' has no goalkeeper state.`);
  }
  const committed = player.goalkeeper.commitTicksRemaining > 0;
  const recovering = !committed && player.goalkeeper.recoveryTicksRemaining > 0;
  const reachScale = recovering ? tuning.getNumber('keeper.recoveryReachScale') : 1;
  return {
    radius: tuning.getNumber(committed ? 'keeper.committedReach' : 'keeper.ordinaryReach') * reachScale,
    height: tuning.getNumber(committed ? 'keeper.committedHeight' : 'keeper.ordinaryHeight') * reachScale,
    committed,
    recovering
  };
}

export function advanceGoalkeeperState(state: GameState, tuning: TuningReader, input?: SimulationInput): void {
  const inputs = routedInputs(input);
  for (const player of state.players) {
    const keeper = player.goalkeeper;
    if (player.definition.role !== 'goalkeeper' || !keeper) continue;
    if (keeper.commitTicksRemaining > 0) {
      keeper.commitTicksRemaining -= 1;
      if (keeper.commitTicksRemaining === 0) keeper.recoveryTicksRemaining = tuning.getNumber('keeper.recoveryTicks');
    } else {
      keeper.recoveryTicksRemaining = Math.max(0, keeper.recoveryTicksRemaining - 1);
    }
    const intent = inputs.find((entry) => entry.playerId === player.definition.id)?.intent;
    const possesses = state.ball.mode === 'possessed' && state.ball.holderId === player.definition.id;
    if (possesses || player.contact.stumbleTicksRemaining > 0 ||
        keeper.commitTicksRemaining > 0 || keeper.recoveryTicksRemaining > 0 || !intent?.save?.pressed) continue;
    const direction = intent.desiredFacing ?? player.facing;
    const length = Math.hypot(direction.x, direction.y);
    keeper.saveDirection = length > EPSILON ? { x: direction.x / length, y: direction.y / length } : { ...player.facing };
    keeper.commitTicksRemaining = tuning.getNumber('keeper.commitTicks');
  }
}

export function resolveGoalkeeperSave(
  state: GameState,
  player: PlayerState,
  contact: GoalkeeperSaveContact,
  tuning: TuningReader
): GoalkeeperSaveObservation {
  const envelope = getGoalkeeperSaveEnvelope(player, tuning);
  const relative = {
    x: contact.incomingVelocity.x - player.velocity.x,
    y: contact.incomingVelocity.y - player.velocity.y
  };
  const relativeSpeed = Math.hypot(relative.x, relative.y);
  const incomingSpeed = Math.hypot(contact.incomingVelocity.x, contact.incomingVelocity.y);
  const facing = envelope.committed ? player.goalkeeper!.saveDirection : player.facing;
  const alignment = incomingSpeed > EPSILON
    ? Math.max(0, -(facing.x * contact.incomingVelocity.x + facing.y * contact.incomingVelocity.y) / incomingSpeed)
    : 1;
  const dx = contact.position.x - player.position.x;
  const dy = contact.position.y - player.position.y;
  const distance = Math.hypot(dx, dy);
  const stretch = Math.min(1, distance / (envelope.radius + tuning.getNumber(BALL_RADIUS_KEY)));
  const heightRatio = envelope.height > EPSILON ? contact.height / envelope.height : 0;
  const catchSpeed = tuning.getNumber('keeper.catchSpeed');
  const difficulty = Math.max(0, relativeSpeed - catchSpeed) / catchSpeed +
    heightRatio * tuning.getNumber('keeper.heightDifficulty') +
    stretch * tuning.getNumber('keeper.stretchDifficulty') +
    (1 - alignment) * tuning.getNumber('keeper.alignmentDifficulty') +
    (envelope.committed ? tuning.getNumber('keeper.commitDifficulty') : 0);
  const control = player.definition.attributes.control;
  const capacity = tuning.getNumber('keeper.catchCapacity') *
    (1 + tuning.getNumber('keeper.controlSpread') * (control - 50) / 50);
  const caught = difficulty <= capacity + EPSILON;
  const save: GoalkeeperSaveFactors = {
    relativeSpeed, alignment, stretch, heightRatio,
    committed: envelope.committed, recovering: envelope.recovering,
    control, difficulty, capacity,
    reason: caught ? 'controlled-catch' : 'difficulty-exceeds-control'
  };
  const base = {
    playerId: player.definition.id,
    teamId: player.definition.teamId,
    contactTimeSeconds: contact.timeSeconds,
    contactPosition: { ...contact.position },
    contactHeight: contact.height,
    save
  };
  player.throwCharge = createEmptyThrowChargeState();
  if (caught) {
    state.ball = createPossessedBallState(player.definition.id);
    for (const current of state.players) current.oneTouch = createEmptyOneTouchState();
    return { ...base, outcome: 'keeper-catch' };
  }
  const normal = distance > EPSILON ? { x: dx / distance, y: dy / distance }
    : incomingSpeed > EPSILON
      ? { x: -contact.incomingVelocity.x / incomingSpeed, y: -contact.incomingVelocity.y / incomingSpeed }
      : { x: 0, y: player.definition.defendingEnd === 'negativeY' ? 1 : -1 };
  const outgoingVelocity = reflectVelocity(contact.incomingVelocity, normal, tuning.getNumber('keeper.parryRestitution'));
  state.ball = createLooseBallState({
    position: { ...contact.position }, velocity: outgoingVelocity,
    height: contact.height, verticalVelocity: tuning.getNumber('keeper.parryLift'),
    release: { releasedById: player.definition.id, reacquisitionLockoutTicksRemaining: tuning.getNumber(BALL_POST_RELEASE_LOCKOUT_TICKS_KEY) }
  });
  player.oneTouch = createEmptyOneTouchState();
  return { ...base, outcome: 'keeper-parry', outgoingVelocity };
}

export function publishKeeperDiagnostics(
  state: GameState,
  tuning: TuningReader,
  arena: ArenaDefinition,
  observation: GoalkeeperSaveObservation | undefined,
  sink?: DiagnosticSink
): void {
  if (!sink?.isLayerEnabled('keeper')) return;
  const keepers = state.players.filter((player) => player.definition.role === 'goalkeeper');
  for (const player of keepers) {
    const envelope = getGoalkeeperSaveEnvelope(player, tuning);
    const bounds = getPlayerMovementBounds(player, arena);
    sink.publish({ layer: 'keeper', source: 'goalkeeping', entityId: player.definition.id,
      primitive: { type: 'circle', center: player.position, radius: envelope.radius + tuning.getNumber(BALL_RADIUS_KEY), color: envelope.committed ? '#f6c177' : '#85dacc' },
      data: { ...envelope, ...player.goalkeeper, position: player.position, bounds } });
    sink.publish({ layer: 'keeper', source: 'goalkeeping', entityId: `${player.definition.id}-crease`,
      primitive: { type: 'region', center: { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 },
        width: bounds.maxX - bounds.minX, height: bounds.maxY - bounds.minY, color: '#85dacc' } });
  }
  sink.publish({ layer: 'keeper', source: 'goalkeeping', entityId: 'keeper-state',
    primitive: { type: 'label', position: observation?.contactPosition ?? { x: 0, y: 0 }, text: observation?.outcome ?? '' },
    data: { tick: state.tick, players: keepers.map((player) => ({ playerId: player.definition.id, position: player.position,
      velocity: player.velocity, ...player.goalkeeper, envelope: getGoalkeeperSaveEnvelope(player, tuning),
      effectiveMovement: Object.fromEntries(Object.keys(KEEPER_MOVEMENT_KEYS).map((key) =>
        [key, createGoalkeeperMovementTuning(player, tuning).getNumber(key)]))
    })), save: observation ?? null } });
}
