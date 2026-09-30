import {
  BALL_POST_RELEASE_LOCKOUT_TICKS_KEY,
  CONTROLS_THROW_CHARGE_TO_MAX_SECONDS_KEY,
  CONTROLS_THROW_MAX_STRENGTH_KEY,
  CONTROLS_THROW_MIN_STRENGTH_KEY,
  type TuningReader
} from '../config/tuning';
import {
  createBallThrowLaunch,
  type BallThrowFamily
} from '../physics/ballTrajectory';
import type { Vec2 } from '../physics/geometry';
import type {
  PlayerIntent,
  RightStickThrowPulse,
  RoutedPlayerIntent
} from '../control/types';
import {
  cloneThrowChargeState,
  createEmptyThrowChargeState,
  createLooseBallState,
  type BallState,
  type GameState,
  type PlayerState,
  type ThrowChargeFamily,
  type ThrowChargeState
} from './gameState';

export type ThrowReleaseSource = 'low-button' | 'high-button' | 'right-stick';

export interface ThrowReleaseObservation {
  readonly playerId: string;
  readonly source: ThrowReleaseSource;
  readonly family: BallThrowFamily;
  readonly origin: Vec2;
  readonly direction: Vec2;
  readonly strength: number;
  readonly velocity: Vec2;
  readonly verticalVelocity: number;
  readonly reacquisitionLockoutTicks: number;
}

export interface ThrowStepResult {
  readonly playerId: string | undefined;
  readonly charge: ThrowChargeState | undefined;
  readonly cancelledPlayerIds: readonly string[];
  readonly release: ThrowReleaseObservation | undefined;
}

export interface ThrowChargeTuning {
  readonly minStrength: number;
  readonly maxStrength: number;
  readonly chargeToMaxSeconds: number;
  readonly lockoutTicks: number;
}

function assertFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${name} must be finite.`);
  }
}

function assertFixedStep(fixedStepSeconds: number): void {
  assertFinite(fixedStepSeconds, 'The simulation step');
  if (fixedStepSeconds <= 0) {
    throw new RangeError('The simulation step must be positive.');
  }
}

function cloneVector(vector: Vec2): Vec2 {
  return { x: vector.x, y: vector.y };
}

export function readThrowChargeTuning(tuning: TuningReader): ThrowChargeTuning {
  const values = {
    minStrength: tuning.getNumber(CONTROLS_THROW_MIN_STRENGTH_KEY),
    maxStrength: tuning.getNumber(CONTROLS_THROW_MAX_STRENGTH_KEY),
    chargeToMaxSeconds: tuning.getNumber(CONTROLS_THROW_CHARGE_TO_MAX_SECONDS_KEY),
    lockoutTicks: tuning.getNumber(BALL_POST_RELEASE_LOCKOUT_TICKS_KEY)
  };

  assertFinite(values.minStrength, 'Throw minimum strength');
  assertFinite(values.maxStrength, 'Throw maximum strength');
  assertFinite(values.chargeToMaxSeconds, 'Throw charge-to-maximum duration');
  assertFinite(values.lockoutTicks, 'Post-release reacquisition lockout');

  if (values.minStrength < 0 || values.minStrength > 1) {
    throw new RangeError('Throw minimum strength must be in the range [0, 1].');
  }
  if (values.maxStrength < 0 || values.maxStrength > 1) {
    throw new RangeError('Throw maximum strength must be in the range [0, 1].');
  }
  if (values.maxStrength < values.minStrength) {
    throw new RangeError('Throw maximum strength must be at least the minimum strength.');
  }
  if (values.chargeToMaxSeconds <= 0) {
    throw new RangeError('Throw charge-to-maximum duration must be positive.');
  }
  if (!Number.isInteger(values.lockoutTicks) || values.lockoutTicks < 0) {
    throw new RangeError('Post-release reacquisition lockout must be a non-negative integer.');
  }

  return values;
}

function isActiveCharge(charge: ThrowChargeState): boolean {
  return charge.family !== undefined;
}

function chargeState(
  family: ThrowChargeFamily,
  elapsedSeconds: number,
  progress: number,
  tuning: ThrowChargeTuning
): ThrowChargeState {
  const clampedProgress = Math.min(1, Math.max(0, progress));
  return {
    family,
    elapsedSeconds: Math.max(0, elapsedSeconds),
    strength:
      tuning.minStrength +
      (tuning.maxStrength - tuning.minStrength) * clampedProgress,
    progress: clampedProgress
  };
}

export function startThrowCharge(
  family: ThrowChargeFamily,
  tuning: ThrowChargeTuning
): ThrowChargeState {
  return chargeState(family, 0, 0, tuning);
}

export function advanceThrowCharge(
  current: ThrowChargeState,
  fixedStepSeconds: number,
  tuning: ThrowChargeTuning
): ThrowChargeState {
  const elapsedSeconds = Math.min(
    tuning.chargeToMaxSeconds,
    current.elapsedSeconds + fixedStepSeconds
  );
  return chargeState(
    current.family as ThrowChargeFamily,
    elapsedSeconds,
    elapsedSeconds / tuning.chargeToMaxSeconds,
    tuning
  );
}

function buttonForFamily(
  intent: PlayerIntent,
  family: ThrowChargeFamily
): PlayerIntent['lowThrow'] {
  return family === 'low' ? intent.lowThrow : intent.highThrow;
}

export function throwStrengthForRightStick(
  pulse: RightStickThrowPulse,
  tuning: ThrowChargeTuning
): number {
  assertFinite(pulse.magnitude, 'Right-stick throw magnitude');
  const magnitude = Math.min(1, Math.max(0, pulse.magnitude));
  return (
    tuning.minStrength +
    (tuning.maxStrength - tuning.minStrength) * magnitude
  );
}

function holderForBall(
  state: GameState,
  ball: Extract<BallState, { mode: 'possessed' }>
): PlayerState {
  const holder = state.players.find(
    (player) => player.definition.id === ball.holderId
  );
  if (!holder) {
    throw new Error(`Possessed ball holder '${ball.holderId}' is missing from GameState.`);
  }

  return holder;
}

function clearCharge(
  player: PlayerState,
  cancelledPlayerIds: string[]
): void {
  if (!isActiveCharge(player.throwCharge)) {
    return;
  }

  player.throwCharge = createEmptyThrowChargeState();
  cancelledPlayerIds.push(player.definition.id);
}

function decrementLockout(ball: Extract<BallState, { mode: 'loose' }>): void {
  if (!ball.release || ball.release.reacquisitionLockoutTicksRemaining <= 0) {
    return;
  }

  ball.release = {
    ...ball.release,
    reacquisitionLockoutTicksRemaining:
      ball.release.reacquisitionLockoutTicksRemaining - 1
  };
}

function releaseBall(
  state: GameState,
  holder: PlayerState,
  family: BallThrowFamily,
  source: ThrowReleaseSource,
  direction: Vec2,
  strength: number,
  tuning: ThrowChargeTuning,
  physicsTuning: TuningReader
): ThrowReleaseObservation {
  const launch = createBallThrowLaunch(
    family,
    direction,
    strength,
    physicsTuning
  );
  const origin = cloneVector(holder.position);

  state.ball = createLooseBallState({
    position: origin,
    velocity: launch.velocity,
    height: 0,
    verticalVelocity: launch.verticalVelocity,
    release: {
      releasedById: holder.definition.id,
      reacquisitionLockoutTicksRemaining: tuning.lockoutTicks
    }
  });
  holder.throwCharge = createEmptyThrowChargeState();

  return {
    playerId: holder.definition.id,
    source,
    family,
    origin,
    direction: cloneVector(launch.direction),
    strength: launch.strength,
    velocity: cloneVector(launch.velocity),
    verticalVelocity: launch.verticalVelocity,
    reacquisitionLockoutTicks: tuning.lockoutTicks
  };
}

function resultFor(
  state: GameState,
  playerId: string | undefined,
  cancelledPlayerIds: readonly string[],
  release: ThrowReleaseObservation | undefined
): ThrowStepResult {
  const player = playerId
    ? state.players.find((candidate) => candidate.definition.id === playerId)
    : undefined;

  return {
    playerId,
    charge: player ? cloneThrowChargeState(player.throwCharge) : undefined,
    cancelledPlayerIds: cancelledPlayerIds.slice(),
    release
  };
}

/**
 * Advances simulation-owned throw charge and resolves a single release. This
 * function intentionally does not acquire possession or implement receiving.
 */
export function advanceThrowState(
  state: GameState,
  fixedStepSeconds: number,
  tuning: TuningReader,
  input: RoutedPlayerIntent | undefined
): ThrowStepResult {
  assertFixedStep(fixedStepSeconds);
  const chargeTuning = readThrowChargeTuning(tuning);
  const cancelledPlayerIds: string[] = [];

  if (state.ball.mode === 'loose') {
    decrementLockout(state.ball);
    for (const player of state.players) {
      clearCharge(player, cancelledPlayerIds);
    }
    return resultFor(state, input?.playerId, cancelledPlayerIds, undefined);
  }

  const holder = holderForBall(state, state.ball);
  for (const player of state.players) {
    if (player.definition.id !== holder.definition.id) {
      clearCharge(player, cancelledPlayerIds);
    }
  }

  if (!input || input.playerId !== holder.definition.id) {
    clearCharge(holder, cancelledPlayerIds);
    return resultFor(state, holder.definition.id, cancelledPlayerIds, undefined);
  }

  const intent = input.intent;
  if (intent.actionContext !== 'possessed') {
    clearCharge(holder, cancelledPlayerIds);
    return resultFor(state, holder.definition.id, cancelledPlayerIds, undefined);
  }

  const activeCharge = holder.throwCharge;

  if (isActiveCharge(activeCharge)) {
    const button = buttonForFamily(intent, activeCharge.family as ThrowChargeFamily);
    if (button.held) {
      holder.throwCharge = advanceThrowCharge(activeCharge, fixedStepSeconds, chargeTuning);
      return resultFor(state, holder.definition.id, cancelledPlayerIds, undefined);
    }

    if (button.released) {
      const release = releaseBall(
        state,
        holder,
        activeCharge.family as ThrowChargeFamily,
        activeCharge.family === 'low' ? 'low-button' : 'high-button',
        holder.facing,
        activeCharge.strength,
        chargeTuning,
        tuning
      );
      return resultFor(state, holder.definition.id, cancelledPlayerIds, release);
    }

    // A device reset or action-context change can clear the edge without
    // producing a normal release edge; never leave a charge stuck in that case.
    clearCharge(holder, cancelledPlayerIds);
    return resultFor(state, holder.definition.id, cancelledPlayerIds, undefined);
  }

  if (intent.rightStickThrow) {
    const release = releaseBall(
      state,
      holder,
      'low',
      'right-stick',
      intent.rightStickThrow.direction,
      throwStrengthForRightStick(intent.rightStickThrow, chargeTuning),
      chargeTuning,
      tuning
    );
    return resultFor(state, holder.definition.id, cancelledPlayerIds, release);
  }

  if (intent.lowThrow.held) {
    holder.throwCharge = startThrowCharge('low', chargeTuning);
  } else if (intent.highThrow.held) {
    holder.throwCharge = startThrowCharge('high', chargeTuning);
  }

  return resultFor(state, holder.definition.id, cancelledPlayerIds, undefined);
}
