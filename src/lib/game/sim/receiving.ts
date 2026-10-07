import {
  BALL_POST_RELEASE_LOCKOUT_TICKS_KEY,
  BALL_RADIUS_KEY,
  PLAYER_RADIUS_KEY,
  RECEIVE_CATCH_HEIGHT_KEY,
  RECEIVE_ONE_TOUCH_BUFFER_TICKS_KEY,
  type TuningReader
} from '../config/tuning';
import { routedInputs, type ReceiveIntent, type RoutedPlayerIntent, type SimulationInput } from '../control/types';
import { createPlayerTuning } from '../config/playerAttributes';
import {
  createBallThrowLaunch,
  reflectVelocity,
  type BallThrowFamily,
  type BallTrajectorySegment,
  type LooseBallStepResult
} from '../physics/ballTrajectory';
import {
  sweepCircleAgainstCircle,
  type SweptCircleCircleInterval,
  type Vec2
} from '../physics/geometry';
import {
  createEmptyOneTouchState,
  createEmptyThrowChargeState,
  createLooseBallState,
  createPossessedBallState,
  type GameState,
  type PlayerState,
  type ThrowChargeFamily
} from './gameState';
import {
  advanceThrowCharge,
  readThrowChargeTuning,
  releaseReacquisitionTicks,
  startThrowCharge,
  throwStrengthForRightStick
} from './throwing';
import { evaluateReceiveDifficulty, type ReceiveDifficulty } from './receiveDifficulty';
import { getGoalkeeperSaveEnvelope, resolveGoalkeeperSave, type GoalkeeperSaveObservation } from './goalkeeping';

const EPSILON = 1e-9;

export type OneTouchSource = 'low-button' | 'high-button' | 'right-stick';

interface ReceiveTuning {
  readonly ballRadius: number;
  readonly playerRadius: number;
  readonly catchHeight: number;
  readonly oneTouchBufferTicks: number;
  readonly releaseLockoutTicks: number;
}

export interface ReceiveContactCandidate {
  readonly player: PlayerState;
  readonly timeSeconds: number;
  readonly position: Vec2;
  readonly height: number;
  readonly incomingVelocity: Vec2;
}

interface ReceiveInteractionBase {
  readonly playerId: string;
  readonly teamId: string;
  readonly contactTimeSeconds: number;
  readonly contactPosition: Vec2;
  readonly contactHeight: number;
  readonly difficulty: ReceiveDifficulty;
}

export interface PickupInteractionObservation extends ReceiveInteractionBase {
  readonly outcome: 'possession';
  readonly holderId: string;
}

export interface OneTouchInteractionObservation extends ReceiveInteractionBase {
  readonly outcome: 'one-touch';
  readonly source: OneTouchSource;
  readonly family: BallThrowFamily;
  readonly direction: Vec2;
  readonly strength: number;
  readonly velocity: Vec2;
  readonly verticalVelocity: number;
  readonly reacquisitionLockoutTicks: number;
}

export type ReceiveInteractionObservation =
  | PickupInteractionObservation
  | OneTouchInteractionObservation
  | GoalkeeperSaveObservation
  | (ReceiveInteractionBase & { readonly outcome: 'deflection' | 'miss' });

function cloneVector(vector: Vec2): Vec2 {
  return { x: vector.x, y: vector.y };
}

function readReceiveTuning(tuning: TuningReader): ReceiveTuning {
  const values = {
    ballRadius: tuning.getNumber(BALL_RADIUS_KEY),
    playerRadius: tuning.getNumber(PLAYER_RADIUS_KEY),
    catchHeight: tuning.getNumber(RECEIVE_CATCH_HEIGHT_KEY),
    oneTouchBufferTicks: tuning.getNumber(RECEIVE_ONE_TOUCH_BUFFER_TICKS_KEY),
    releaseLockoutTicks: tuning.getNumber(BALL_POST_RELEASE_LOCKOUT_TICKS_KEY)
  };

  if (!Number.isFinite(values.ballRadius) || values.ballRadius <= 0) {
    throw new RangeError('Ball radius must be finite and positive.');
  }
  if (!Number.isFinite(values.playerRadius) || values.playerRadius <= 0) {
    throw new RangeError('Player radius must be finite and positive.');
  }
  if (!Number.isFinite(values.catchHeight) || values.catchHeight < 0) {
    throw new RangeError('Receive/catch height must be finite and non-negative.');
  }
  if (
    !Number.isInteger(values.oneTouchBufferTicks) ||
    values.oneTouchBufferTicks <= 0
  ) {
    throw new RangeError('One-touch buffer duration must be a positive integer.');
  }
  if (
    !Number.isInteger(values.releaseLockoutTicks) ||
    values.releaseLockoutTicks < 0
  ) {
    throw new RangeError('Post-release reacquisition lockout must be a non-negative integer.');
  }

  return values;
}

function clearOneTouchState(player: PlayerState): void {
  player.oneTouch = createEmptyOneTouchState();
}

function decayOneTouchBuffer(player: PlayerState): void {
  const buffer = player.oneTouch.buffer;
  if (!buffer) {
    return;
  }

  const ticksRemaining = buffer.ticksRemaining - 1;
  player.oneTouch.buffer =
    ticksRemaining > 0
      ? { ...buffer, ticksRemaining }
      : undefined;
}

function receiveIntentFor(
  player: PlayerState,
  input: RoutedPlayerIntent | undefined
): ReceiveIntent | undefined {
  return input?.playerId === player.definition.id &&
    input.intent.actionContext === 'receiving'
    ? input.intent.receive
    : undefined;
}

function advanceButtonOneTouch(
  player: PlayerState,
  receive: ReceiveIntent | undefined,
  fixedStepSeconds: number,
  tuning: TuningReader
): void {
  const chargeTuning = readThrowChargeTuning(tuning);
  const activeCharge = player.oneTouch.charge;

  if (activeCharge.family) {
    const button =
      activeCharge.family === 'low' ? receive?.low : receive?.high;
    if (button?.held) {
      player.oneTouch.charge = advanceThrowCharge(
        activeCharge,
        fixedStepSeconds,
        chargeTuning
      );
    } else {
      player.oneTouch.charge = createEmptyThrowChargeState();
    }
    return;
  }

  if (receive?.low.held) {
    player.oneTouch.charge = startThrowCharge('low', chargeTuning);
  } else if (receive?.high.held) {
    player.oneTouch.charge = startThrowCharge('high', chargeTuning);
  }
}

/** Advances simulation-owned pre-receive charge and buffered input state. */
export function advanceOneTouchState(
  state: GameState,
  fixedStepSeconds: number,
  tuning: TuningReader,
  input: SimulationInput | undefined
): void {
  if (!Number.isFinite(fixedStepSeconds) || fixedStepSeconds <= 0) {
    throw new RangeError('The simulation step must be a finite positive duration.');
  }

  const receiveTuning = readReceiveTuning(tuning);
  if (state.ball.mode !== 'loose') {
    for (const player of state.players) {
      clearOneTouchState(player);
    }
    return;
  }

  const inputs = routedInputs(input);
  for (const player of state.players) {
    if (player.definition.role !== 'field') {
      clearOneTouchState(player);
      continue;
    }

    decayOneTouchBuffer(player);
    const playerInput = inputs.find((entry) => entry.playerId === player.definition.id);
    const receive = receiveIntentFor(player, playerInput);

    if (
      playerInput && playerInput.intent.actionContext !== 'receiving'
    ) {
      player.oneTouch.buffer = undefined;
    }

    advanceButtonOneTouch(player, receive, fixedStepSeconds, tuning);

    if (receive?.rightStickThrow) {
      // Validate and clamp the captured magnitude through the same mapping used
      // by ordinary right-stick throws; launch strength is resolved at contact.
      throwStrengthForRightStick(receive.rightStickThrow, readThrowChargeTuning(tuning));
      player.oneTouch.buffer = {
        direction: cloneVector(receive.rightStickThrow.direction),
        magnitude: Math.min(1, Math.max(0, receive.rightStickThrow.magnitude)),
        ticksRemaining: receiveTuning.oneTouchBufferTicks
      };
    }
  }
}

function heightAtRatio(segment: BallTrajectorySegment, ratio: number): number {
  return (
    segment.startHeight +
    (segment.endHeight - segment.startHeight) * ratio
  );
}

function earliestCatchableRatio(
  segment: BallTrajectorySegment,
  interval: SweptCircleCircleInterval,
  catchHeight: number
): number | undefined {
  const entryHeight = heightAtRatio(segment, interval.enterTime);
  if (entryHeight <= catchHeight + EPSILON) {
    return interval.enterTime;
  }

  const heightDelta = segment.endHeight - segment.startHeight;
  if (heightDelta >= -EPSILON) {
    return undefined;
  }

  const thresholdRatio =
    (catchHeight - segment.startHeight) / heightDelta;
  const candidateRatio = Math.max(interval.enterTime, thresholdRatio);
  return candidateRatio <= interval.exitTime + EPSILON
    ? Math.min(1, Math.max(0, candidateRatio))
    : undefined;
}

export function findPlayerBallContact(
  segment: BallTrajectorySegment,
  player: PlayerState,
  tuning: Pick<ReceiveTuning, 'ballRadius' | 'playerRadius' | 'catchHeight'>
): ReceiveContactCandidate | undefined {
  const displacement = {
    x: segment.end.x - segment.start.x,
    y: segment.end.y - segment.start.y
  };
  const interval = sweepCircleAgainstCircle(
    segment.start,
    displacement,
    tuning.ballRadius,
    player.position,
    tuning.playerRadius
  );
  if (!interval) {
    return undefined;
  }

  const ratio = earliestCatchableRatio(segment, interval, tuning.catchHeight);
  if (ratio === undefined) {
    return undefined;
  }

  const segmentDuration =
    segment.endTimeSeconds - segment.startTimeSeconds;
  return {
    player,
    timeSeconds: segment.startTimeSeconds + segmentDuration * ratio,
    position: {
      x: segment.start.x + displacement.x * ratio,
      y: segment.start.y + displacement.y * ratio
    },
    height: heightAtRatio(segment, ratio),
    incomingVelocity: segmentDuration > EPSILON ? { x: displacement.x / segmentDuration, y: displacement.y / segmentDuration } : { x: 0, y: 0 }
  };
}

function isLockedOut(state: GameState, playerId: string): boolean {
  return (
    state.ball.mode === 'loose' &&
    state.ball.release?.releasedById === playerId &&
    state.ball.release.reacquisitionLockoutTicksRemaining > 0
  );
}

function compareContacts(
  left: ReceiveContactCandidate,
  right: ReceiveContactCandidate
): number {
  const timeDifference = left.timeSeconds - right.timeSeconds;
  if (Math.abs(timeDifference) > EPSILON) {
    return timeDifference;
  }

  const leftId = left.player.definition.id;
  const rightId = right.player.definition.id;
  return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
}

function receiveContacts(
  state: GameState,
  ballStep: LooseBallStepResult,
  tuning: ReceiveTuning,
  reader: TuningReader
): readonly ReceiveContactCandidate[] {
  const contacts: ReceiveContactCandidate[] = [];

  for (const player of state.players) {
    if (player.contact.stumbleTicksRemaining > 0 || isLockedOut(state, player.definition.id)) {
      continue;
    }

    const keeperEnvelope = player.definition.role === 'goalkeeper' ? getGoalkeeperSaveEnvelope(player, reader) : undefined;
    const envelope = keeperEnvelope ? {
      ballRadius: tuning.ballRadius,
      playerRadius: keeperEnvelope.radius,
      catchHeight: keeperEnvelope.height
    } : tuning;
    for (const segment of ballStep.segments) {
      const contact = findPlayerBallContact(segment, player, envelope);
      if (contact && (!ballStep.goalAperture?.crossed || contact.timeSeconds <= ballStep.goalAperture.timeSeconds)) {
        contacts.push(contact);
        break;
      }
    }
  }

  contacts.sort(compareContacts);
  return contacts;
}

function oneTouchAction(
  player: PlayerState,
  tuning: TuningReader
):
  | {
      readonly source: OneTouchSource;
      readonly family: BallThrowFamily;
      readonly direction: Vec2;
      readonly strength: number;
    }
  | undefined {
  const charge = player.oneTouch.charge;
  if (charge.family) {
    const family = charge.family as ThrowChargeFamily;
    return {
      source: family === 'low' ? 'low-button' : 'high-button',
      family,
      direction: cloneVector(player.facing),
      strength: charge.strength
    };
  }

  const buffer = player.oneTouch.buffer;
  if (!buffer) {
    return undefined;
  }

  return {
    source: 'right-stick',
    family: 'low',
    direction: cloneVector(buffer.direction),
    strength: throwStrengthForRightStick(
      buffer,
      readThrowChargeTuning(tuning)
    )
  };
}

/**
 * Resolves at most one deterministic ball/player interaction after loose-ball
 * integration. Team identity is intentionally absent from eligibility.
 */
export function resolveLooseBallPlayerInteraction(
  state: GameState,
  ballStep: LooseBallStepResult | undefined,
  tuning: TuningReader,
  fixedStepSeconds: number
): ReceiveInteractionObservation | undefined {
  if (state.ball.mode !== 'loose' || !ballStep) {
    return undefined;
  }

  const receiveTuning = readReceiveTuning(tuning);
  let missed: ReceiveInteractionObservation | undefined;
  for (const contact of receiveContacts(state, ballStep, receiveTuning, tuning)) {
  const player = contact.player;
  if (player.definition.role === 'goalkeeper') {
    return resolveGoalkeeperSave(state, player, contact, tuning);
  }
  const action = oneTouchAction(player, tuning);
  const difficulty = evaluateReceiveDifficulty(player, state.players, contact.incomingVelocity, contact.height, tuning, action?.direction);
  const base = {
    playerId: player.definition.id,
    teamId: player.definition.teamId,
    contactTimeSeconds: contact.timeSeconds,
    contactPosition: cloneVector(contact.position),
    contactHeight: contact.height,
    difficulty
  };

  if (!difficulty.succeeds) {
    clearOneTouchState(player);
    if (contact.height > tuning.getNumber('receive.bodyHeight')) {
      missed = { ...base, outcome: 'miss' };
      continue;
    }
    const delta = { x: contact.position.x - player.position.x, y: contact.position.y - player.position.y };
    const distance = Math.hypot(delta.x, delta.y);
    const speed = Math.hypot(contact.incomingVelocity.x, contact.incomingVelocity.y);
    const normal = distance > EPSILON ? { x: delta.x / distance, y: delta.y / distance } :
      speed > EPSILON ? { x: -contact.incomingVelocity.x / speed, y: -contact.incomingVelocity.y / speed } : { x: 1, y: 0 };
    state.ball = createLooseBallState({ position: contact.position, height: contact.height,
      velocity: reflectVelocity(contact.incomingVelocity, normal, tuning.getNumber('receive.deflectionRestitution')),
      verticalVelocity: state.ball.mode === 'loose' ? state.ball.verticalVelocity : 0,
      release: { releasedById: player.definition.id, reacquisitionLockoutTicksRemaining: receiveTuning.releaseLockoutTicks } });
    return { ...base, outcome: 'deflection' };
  }

  if (!action) {
    state.ball = createPossessedBallState(player.definition.id);
    for (const currentPlayer of state.players) {
      clearOneTouchState(currentPlayer);
    }
    return {
      ...base,
      outcome: 'possession',
      holderId: player.definition.id
    };
  }

  const launch = createBallThrowLaunch(
    action.family,
    action.direction,
    action.strength,
    createPlayerTuning(player.definition.attributes, tuning)
  );
  const lockoutTicks = releaseReacquisitionTicks(player, contact.position, launch.velocity, tuning, fixedStepSeconds);
  state.ball = createLooseBallState({
    position: contact.position,
    velocity: launch.velocity,
    height: contact.height,
    verticalVelocity: launch.verticalVelocity,
    release: {
      releasedById: player.definition.id,
      reacquisitionLockoutTicksRemaining: lockoutTicks
    }
  });
  clearOneTouchState(player);

  return {
    ...base,
    outcome: 'one-touch',
    source: action.source,
    family: launch.family,
    direction: cloneVector(launch.direction),
    strength: launch.strength,
    velocity: cloneVector(launch.velocity),
    verticalVelocity: launch.verticalVelocity,
    reacquisitionLockoutTicks: lockoutTicks
  };
  }
  return missed;
}
