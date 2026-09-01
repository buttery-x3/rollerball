export interface NumericTuningDefinition {
  readonly key: string;
  readonly domain: string;
  readonly label: string;
  readonly defaultValue: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
}

export interface NumericTuningEntry extends NumericTuningDefinition {
  readonly overrideValue: number | undefined;
  readonly effectiveValue: number;
}

export interface TuningReader {
  getNumber(key: string): number;
}

export interface TuningRegistry extends TuningReader {
  register(definition: NumericTuningDefinition): void;
  get(key: string): NumericTuningEntry;
  list(): readonly NumericTuningEntry[];
  setOverride(key: string, value: number): void;
  resetOverride(key: string): void;
  resetAllOverrides(): void;
  subscribe(listener: () => void): () => void;
}

export const RUNTIME_MAX_CATCH_UP_STEPS_KEY = 'runtime.maxCatchUpSteps';
export const DEFAULT_RUNTIME_MAX_CATCH_UP_STEPS = 5;

export const CONTROLS_LEFT_STICK_DEADZONE_KEY = 'controls.leftStickDeadzone';
export const CONTROLS_RIGHT_STICK_DEADZONE_KEY = 'controls.rightStickDeadzone';
export const CONTROLS_RIGHT_STICK_CAPTURE_WINDOW_TICKS_KEY =
  'controls.rightStickCaptureWindowTicks';
export const CONTROLS_RIGHT_STICK_NEUTRAL_THRESHOLD_KEY =
  'controls.rightStickNeutralThreshold';
export const CONTROLS_THROW_MIN_STRENGTH_KEY = 'controls.throwMinStrength';
export const CONTROLS_THROW_MAX_STRENGTH_KEY = 'controls.throwMaxStrength';
export const CONTROLS_THROW_CHARGE_TO_MAX_SECONDS_KEY =
  'controls.throwChargeToMaxSeconds';

export const DEFAULT_CONTROLS_LEFT_STICK_DEADZONE = 0.15;
export const DEFAULT_CONTROLS_RIGHT_STICK_DEADZONE = 0.2;
export const DEFAULT_CONTROLS_RIGHT_STICK_CAPTURE_WINDOW_TICKS = 3;
export const DEFAULT_CONTROLS_RIGHT_STICK_NEUTRAL_THRESHOLD = 0.1;
export const DEFAULT_CONTROLS_THROW_MIN_STRENGTH = 0.2;
export const DEFAULT_CONTROLS_THROW_MAX_STRENGTH = 1;
export const DEFAULT_CONTROLS_THROW_CHARGE_TO_MAX_SECONDS = 0.5;

export const ARENA_WIDTH_KEY = 'arena.width';
export const ARENA_LENGTH_KEY = 'arena.length';
export const ARENA_GOAL_WIDTH_KEY = 'arena.goalWidth';
export const ARENA_CROSSBAR_HEIGHT_KEY = 'arena.crossbarHeight';
export const ARENA_CREASE_WIDTH_KEY = 'arena.creaseWidth';
export const ARENA_CREASE_DEPTH_KEY = 'arena.creaseDepth';
export const PLAYER_RADIUS_KEY = 'player.radius';

export const MOVEMENT_MAX_SPEED_KEY = 'movement.maxSpeed';
export const MOVEMENT_ACCELERATION_KEY = 'movement.acceleration';
export const MOVEMENT_TURNING_RESPONSE_KEY = 'movement.turningResponse';
export const MOVEMENT_BRAKING_KEY = 'movement.braking';
export const MOVEMENT_FACING_RESPONSE_KEY = 'movement.facingResponse';
export const MOVEMENT_REVERSAL_RESPONSE_KEY = 'movement.reversalResponse';

export const BALL_RADIUS_KEY = 'ball.radius';
export const BALL_PLANAR_DAMPING_KEY = 'ball.planarDamping';
export const BALL_GRAVITY_KEY = 'ball.gravity';
export const BALL_WALL_RESTITUTION_KEY = 'ball.wallRestitution';
export const BALL_GROUND_RESTITUTION_KEY = 'ball.groundRestitution';
export const BALL_GROUND_DAMPING_KEY = 'ball.groundDamping';
export const BALL_GROUND_SETTLE_SPEED_KEY = 'ball.groundSettleSpeed';
export const BALL_PREDICTION_HORIZON_STEPS_KEY = 'ball.predictionHorizonSteps';
export const BALL_LOW_THROW_MIN_SPEED_KEY = 'ball.lowThrowMinSpeed';
export const BALL_LOW_THROW_MAX_SPEED_KEY = 'ball.lowThrowMaxSpeed';
export const BALL_HIGH_THROW_MIN_PLANAR_SPEED_KEY = 'ball.highThrowMinPlanarSpeed';
export const BALL_HIGH_THROW_MAX_PLANAR_SPEED_KEY = 'ball.highThrowMaxPlanarSpeed';
export const BALL_HIGH_THROW_MIN_VERTICAL_SPEED_KEY = 'ball.highThrowMinVerticalSpeed';
export const BALL_HIGH_THROW_MAX_VERTICAL_SPEED_KEY = 'ball.highThrowMaxVerticalSpeed';
export const BALL_POST_RELEASE_LOCKOUT_TICKS_KEY =
  'ball.postReleaseReacquisitionLockoutTicks';

export const DEFAULT_ARENA_WIDTH = 18;
export const DEFAULT_ARENA_LENGTH = 30;
export const DEFAULT_ARENA_GOAL_WIDTH = 8;
export const DEFAULT_ARENA_CROSSBAR_HEIGHT = 3;
export const DEFAULT_ARENA_CREASE_WIDTH = 10;
export const DEFAULT_ARENA_CREASE_DEPTH = 4;
export const DEFAULT_PLAYER_RADIUS = 0.6;

export const DEFAULT_MOVEMENT_MAX_SPEED = 11;
export const DEFAULT_MOVEMENT_ACCELERATION = 60;
export const DEFAULT_MOVEMENT_TURNING_RESPONSE = 8;
export const DEFAULT_MOVEMENT_BRAKING = 5;
export const DEFAULT_MOVEMENT_FACING_RESPONSE = 2;
export const DEFAULT_MOVEMENT_REVERSAL_RESPONSE = 5;

export const DEFAULT_BALL_RADIUS = 0.35;
export const DEFAULT_BALL_PLANAR_DAMPING = 0.25;
export const DEFAULT_BALL_GRAVITY = 28;
export const DEFAULT_BALL_WALL_RESTITUTION = 0.85;
export const DEFAULT_BALL_GROUND_RESTITUTION = 0.45;
export const DEFAULT_BALL_GROUND_DAMPING = 0.25;
export const DEFAULT_BALL_GROUND_SETTLE_SPEED = 0.5;
export const DEFAULT_BALL_PREDICTION_HORIZON_STEPS = 150;
export const DEFAULT_BALL_LOW_THROW_MIN_SPEED = 8;
export const DEFAULT_BALL_LOW_THROW_MAX_SPEED = 30;
export const DEFAULT_BALL_HIGH_THROW_MIN_PLANAR_SPEED = 5;
export const DEFAULT_BALL_HIGH_THROW_MAX_PLANAR_SPEED = 18;
export const DEFAULT_BALL_HIGH_THROW_MIN_VERTICAL_SPEED = 12;
export const DEFAULT_BALL_HIGH_THROW_MAX_VERTICAL_SPEED = 22;
export const DEFAULT_BALL_POST_RELEASE_LOCKOUT_TICKS = 6;

export const DEFAULT_TUNING_DEFINITIONS: readonly NumericTuningDefinition[] = [
  {
    key: RUNTIME_MAX_CATCH_UP_STEPS_KEY,
    domain: 'runtime',
    label: 'Maximum catch-up steps',
    defaultValue: DEFAULT_RUNTIME_MAX_CATCH_UP_STEPS,
    min: 1,
    max: 12,
    step: 1
  },
  {
    key: CONTROLS_LEFT_STICK_DEADZONE_KEY,
    domain: 'controls',
    label: 'Left-stick deadzone',
    defaultValue: DEFAULT_CONTROLS_LEFT_STICK_DEADZONE,
    min: 0,
    max: 0.5,
    step: 0.01
  },
  {
    key: CONTROLS_RIGHT_STICK_DEADZONE_KEY,
    domain: 'controls',
    label: 'Right-stick deadzone',
    defaultValue: DEFAULT_CONTROLS_RIGHT_STICK_DEADZONE,
    min: 0,
    max: 0.5,
    step: 0.01
  },
  {
    key: CONTROLS_RIGHT_STICK_CAPTURE_WINDOW_TICKS_KEY,
    domain: 'controls',
    label: 'Right-stick capture window',
    defaultValue: DEFAULT_CONTROLS_RIGHT_STICK_CAPTURE_WINDOW_TICKS,
    min: 1,
    max: 8,
    step: 1
  },
  {
    key: CONTROLS_RIGHT_STICK_NEUTRAL_THRESHOLD_KEY,
    domain: 'controls',
    label: 'Right-stick neutral threshold',
    defaultValue: DEFAULT_CONTROLS_RIGHT_STICK_NEUTRAL_THRESHOLD,
    min: 0,
    max: 0.5,
    step: 0.01
  },
  {
    key: CONTROLS_THROW_MIN_STRENGTH_KEY,
    domain: 'controls',
    label: 'Throw minimum strength',
    defaultValue: DEFAULT_CONTROLS_THROW_MIN_STRENGTH,
    min: 0,
    max: 1,
    step: 0.05
  },
  {
    key: CONTROLS_THROW_MAX_STRENGTH_KEY,
    domain: 'controls',
    label: 'Throw maximum strength',
    defaultValue: DEFAULT_CONTROLS_THROW_MAX_STRENGTH,
    min: 0,
    max: 1,
    step: 0.05
  },
  {
    key: CONTROLS_THROW_CHARGE_TO_MAX_SECONDS_KEY,
    domain: 'controls',
    label: 'Throw charge to maximum',
    defaultValue: DEFAULT_CONTROLS_THROW_CHARGE_TO_MAX_SECONDS,
    min: 0.05,
    max: 3,
    step: 0.05
  },
  {
    key: ARENA_WIDTH_KEY,
    domain: 'arena',
    label: 'Arena width',
    defaultValue: DEFAULT_ARENA_WIDTH,
    min: 12,
    max: 40,
    step: 0.5
  },
  {
    key: ARENA_LENGTH_KEY,
    domain: 'arena',
    label: 'Arena length',
    defaultValue: DEFAULT_ARENA_LENGTH,
    min: 16,
    max: 60,
    step: 0.5
  },
  {
    key: ARENA_GOAL_WIDTH_KEY,
    domain: 'arena',
    label: 'Goal width',
    defaultValue: DEFAULT_ARENA_GOAL_WIDTH,
    min: 2,
    max: 12,
    step: 0.5
  },
  {
    key: ARENA_CROSSBAR_HEIGHT_KEY,
    domain: 'arena',
    label: 'Crossbar height',
    defaultValue: DEFAULT_ARENA_CROSSBAR_HEIGHT,
    min: 1,
    max: 8,
    step: 0.25
  },
  {
    key: ARENA_CREASE_WIDTH_KEY,
    domain: 'arena',
    label: 'Keeper crease width',
    defaultValue: DEFAULT_ARENA_CREASE_WIDTH,
    min: 2,
    max: 12,
    step: 0.5
  },
  {
    key: ARENA_CREASE_DEPTH_KEY,
    domain: 'arena',
    label: 'Keeper crease depth',
    defaultValue: DEFAULT_ARENA_CREASE_DEPTH,
    min: 1,
    max: 12,
    step: 0.5
  },
  {
    key: PLAYER_RADIUS_KEY,
    domain: 'contact',
    label: 'Player radius',
    defaultValue: DEFAULT_PLAYER_RADIUS,
    min: 0.25,
    max: 2,
    step: 0.05
  },
  {
    key: MOVEMENT_MAX_SPEED_KEY,
    domain: 'movement',
    label: 'Maximum movement speed',
    defaultValue: DEFAULT_MOVEMENT_MAX_SPEED,
    min: 0,
    max: 20,
    step: 0.1
  },
  {
    key: MOVEMENT_ACCELERATION_KEY,
    domain: 'movement',
    label: 'Movement acceleration',
    defaultValue: DEFAULT_MOVEMENT_ACCELERATION,
    min: 0,
    max: 60,
    step: 0.5
  },
  {
    key: MOVEMENT_TURNING_RESPONSE_KEY,
    domain: 'movement',
    label: 'Movement turning response',
    defaultValue: DEFAULT_MOVEMENT_TURNING_RESPONSE,
    min: 0,
    max: 60,
    step: 0.5
  },
  {
    key: MOVEMENT_BRAKING_KEY,
    domain: 'movement',
    label: 'Movement braking',
    defaultValue: DEFAULT_MOVEMENT_BRAKING,
    min: 0,
    max: 60,
    step: 0.5
  },
  {
    key: MOVEMENT_FACING_RESPONSE_KEY,
    domain: 'movement',
    label: 'Facing turn response',
    defaultValue: DEFAULT_MOVEMENT_FACING_RESPONSE,
    min: 0,
    max: 60,
    step: 0.5
  },
  {
    key: MOVEMENT_REVERSAL_RESPONSE_KEY,
    domain: 'movement',
    label: 'Hard reversal response',
    defaultValue: DEFAULT_MOVEMENT_REVERSAL_RESPONSE,
    min: 0,
    max: 60,
    step: 0.5
  },
  {
    key: BALL_RADIUS_KEY,
    domain: 'ball',
    label: 'Ball radius',
    defaultValue: DEFAULT_BALL_RADIUS,
    min: 0.05,
    max: 1,
    step: 0.05
  },
  {
    key: BALL_PLANAR_DAMPING_KEY,
    domain: 'ball',
    label: 'Ball planar damping',
    defaultValue: DEFAULT_BALL_PLANAR_DAMPING,
    min: 0,
    max: 10,
    step: 0.05
  },
  {
    key: BALL_GRAVITY_KEY,
    domain: 'ball',
    label: 'Ball gravity',
    defaultValue: DEFAULT_BALL_GRAVITY,
    min: 0,
    max: 60,
    step: 0.5
  },
  {
    key: BALL_WALL_RESTITUTION_KEY,
    domain: 'ball',
    label: 'Ball wall restitution',
    defaultValue: DEFAULT_BALL_WALL_RESTITUTION,
    min: 0,
    max: 1,
    step: 0.05
  },
  {
    key: BALL_GROUND_RESTITUTION_KEY,
    domain: 'ball',
    label: 'Ball ground restitution',
    defaultValue: DEFAULT_BALL_GROUND_RESTITUTION,
    min: 0,
    max: 1,
    step: 0.05
  },
  {
    key: BALL_GROUND_DAMPING_KEY,
    domain: 'ball',
    label: 'Ball ground damping',
    defaultValue: DEFAULT_BALL_GROUND_DAMPING,
    min: 0,
    max: 1,
    step: 0.05
  },
  {
    key: BALL_GROUND_SETTLE_SPEED_KEY,
    domain: 'ball',
    label: 'Ball ground settle speed',
    defaultValue: DEFAULT_BALL_GROUND_SETTLE_SPEED,
    min: 0,
    max: 5,
    step: 0.05
  },
  {
    key: BALL_PREDICTION_HORIZON_STEPS_KEY,
    domain: 'trajectory',
    label: 'Ball prediction horizon',
    defaultValue: DEFAULT_BALL_PREDICTION_HORIZON_STEPS,
    min: 30,
    max: 300,
    step: 1
  },
  {
    key: BALL_LOW_THROW_MIN_SPEED_KEY,
    domain: 'trajectory',
    label: 'Low throw minimum speed',
    defaultValue: DEFAULT_BALL_LOW_THROW_MIN_SPEED,
    min: 0,
    max: 60,
    step: 0.5
  },
  {
    key: BALL_LOW_THROW_MAX_SPEED_KEY,
    domain: 'trajectory',
    label: 'Low throw maximum speed',
    defaultValue: DEFAULT_BALL_LOW_THROW_MAX_SPEED,
    min: 0,
    max: 60,
    step: 0.5
  },
  {
    key: BALL_HIGH_THROW_MIN_PLANAR_SPEED_KEY,
    domain: 'trajectory',
    label: 'High throw minimum planar speed',
    defaultValue: DEFAULT_BALL_HIGH_THROW_MIN_PLANAR_SPEED,
    min: 0,
    max: 60,
    step: 0.5
  },
  {
    key: BALL_HIGH_THROW_MAX_PLANAR_SPEED_KEY,
    domain: 'trajectory',
    label: 'High throw maximum planar speed',
    defaultValue: DEFAULT_BALL_HIGH_THROW_MAX_PLANAR_SPEED,
    min: 0,
    max: 60,
    step: 0.5
  },
  {
    key: BALL_HIGH_THROW_MIN_VERTICAL_SPEED_KEY,
    domain: 'trajectory',
    label: 'High throw minimum vertical speed',
    defaultValue: DEFAULT_BALL_HIGH_THROW_MIN_VERTICAL_SPEED,
    min: 0,
    max: 60,
    step: 0.5
  },
  {
    key: BALL_HIGH_THROW_MAX_VERTICAL_SPEED_KEY,
    domain: 'trajectory',
    label: 'High throw maximum vertical speed',
    defaultValue: DEFAULT_BALL_HIGH_THROW_MAX_VERTICAL_SPEED,
    min: 0,
    max: 60,
    step: 0.5
  },
  {
    key: BALL_POST_RELEASE_LOCKOUT_TICKS_KEY,
    domain: 'ball',
    label: 'Post-release reacquisition lockout',
    defaultValue: DEFAULT_BALL_POST_RELEASE_LOCKOUT_TICKS,
    min: 0,
    max: 30,
    step: 1
  }
];

function assertValidDefinition(definition: NumericTuningDefinition): void {
  if (!definition.key.trim()) {
    throw new RangeError('A tuning definition must have a non-empty key.');
  }

  if (!definition.domain.trim()) {
    throw new RangeError('A tuning definition must have a non-empty domain.');
  }

  if (!definition.label.trim()) {
    throw new RangeError('A tuning definition must have a non-empty label.');
  }

  if (
    !Number.isFinite(definition.defaultValue) ||
    !Number.isFinite(definition.min) ||
    !Number.isFinite(definition.max) ||
    !Number.isFinite(definition.step) ||
    definition.step <= 0 ||
    definition.min > definition.max ||
    definition.defaultValue < definition.min ||
    definition.defaultValue > definition.max
  ) {
    throw new RangeError(`Invalid tuning metadata for '${definition.key}'.`);
  }

  assertValidValue(definition, definition.defaultValue);
}

function assertValidValue(definition: NumericTuningDefinition, value: number): void {
  if (!Number.isFinite(value) || value < definition.min || value > definition.max) {
    throw new RangeError(
      `Tuning value for '${definition.key}' must be between ${definition.min} and ${definition.max}.`
    );
  }

  const stepIndex = (value - definition.min) / definition.step;
  const nearestStepIndex = Math.round(stepIndex);
  if (Math.abs(stepIndex - nearestStepIndex) > 1e-9) {
    throw new RangeError(`Tuning value for '${definition.key}' must use step ${definition.step}.`);
  }
}

export function createTuningRegistry(
  definitions: readonly NumericTuningDefinition[] = DEFAULT_TUNING_DEFINITIONS
): TuningRegistry {
  const registered = new Map<string, NumericTuningDefinition>();
  const overrides = new Map<string, number>();
  const listeners = new Set<() => void>();

  const notify = (): void => {
    for (const listener of listeners) {
      listener();
    }
  };

  const getDefinition = (key: string): NumericTuningDefinition => {
    const definition = registered.get(key);
    if (!definition) {
      throw new Error(`Unknown tuning key '${key}'.`);
    }

    return definition;
  };

  const getEntry = (key: string): NumericTuningEntry => {
    const definition = getDefinition(key);
    const overrideValue = overrides.get(key);

    return {
      ...definition,
      overrideValue,
      effectiveValue: overrideValue ?? definition.defaultValue
    };
  };

  for (const definition of definitions) {
    assertValidDefinition(definition);
    if (registered.has(definition.key)) {
      throw new Error(`Tuning key '${definition.key}' is already registered.`);
    }

    registered.set(definition.key, { ...definition });
  }

  return {
    register(definition: NumericTuningDefinition): void {
      assertValidDefinition(definition);
      if (registered.has(definition.key)) {
        throw new Error(`Tuning key '${definition.key}' is already registered.`);
      }

      registered.set(definition.key, { ...definition });
      notify();
    },

    get(key: string): NumericTuningEntry {
      return getEntry(key);
    },

    getNumber(key: string): number {
      return getEntry(key).effectiveValue;
    },

    list(): readonly NumericTuningEntry[] {
      return Array.from(registered.keys(), getEntry);
    },

    setOverride(key: string, value: number): void {
      const definition = getDefinition(key);
      assertValidValue(definition, value);
      if (overrides.get(key) === value) {
        return;
      }

      overrides.set(key, value);
      notify();
    },

    resetOverride(key: string): void {
      getDefinition(key);
      if (!overrides.delete(key)) {
        return;
      }

      notify();
    },

    resetAllOverrides(): void {
      if (overrides.size === 0) {
        return;
      }

      overrides.clear();
      notify();
    },

    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };
}
