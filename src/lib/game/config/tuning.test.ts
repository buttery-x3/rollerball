import { describe, expect, it } from 'vitest';
import {
  createTuningRegistry,
  DEFAULT_TUNING_DEFINITIONS,
  ARENA_WIDTH_KEY,
  MOVEMENT_ACCELERATION_KEY,
  MOVEMENT_BRAKING_KEY,
  MOVEMENT_FACING_RESPONSE_KEY,
  MOVEMENT_MAX_SPEED_KEY,
  MOVEMENT_REVERSAL_RESPONSE_KEY,
  MOVEMENT_TURNING_RESPONSE_KEY,
  BALL_GRAVITY_KEY,
  BALL_GROUND_DAMPING_KEY,
  BALL_GROUND_RESTITUTION_KEY,
  BALL_GROUND_SETTLE_SPEED_KEY,
  BALL_PLANAR_DAMPING_KEY,
  BALL_PREDICTION_HORIZON_STEPS_KEY,
  BALL_RADIUS_KEY,
  BALL_WALL_RESTITUTION_KEY,
  BALL_LOW_THROW_MIN_SPEED_KEY,
  BALL_LOW_THROW_MAX_SPEED_KEY,
  BALL_HIGH_THROW_MIN_PLANAR_SPEED_KEY,
  BALL_HIGH_THROW_MAX_PLANAR_SPEED_KEY,
  BALL_HIGH_THROW_MIN_VERTICAL_SPEED_KEY,
  BALL_HIGH_THROW_MAX_VERTICAL_SPEED_KEY,
  BALL_POST_RELEASE_LOCKOUT_TICKS_KEY,
  CONTROLS_THROW_MIN_STRENGTH_KEY,
  CONTROLS_THROW_MAX_STRENGTH_KEY,
  CONTROLS_THROW_CHARGE_TO_MAX_SECONDS_KEY,
  PLAYER_RADIUS_KEY,
  RUNTIME_MAX_CATCH_UP_STEPS_KEY
} from './tuning';

const THROW_TUNING_RELATIONSHIPS = [
  {
    minimumKey: CONTROLS_THROW_MIN_STRENGTH_KEY,
    maximumKey: CONTROLS_THROW_MAX_STRENGTH_KEY,
    invalidOverrideKey: CONTROLS_THROW_MAX_STRENGTH_KEY,
    invalidOverrideValue: 0,
    validOverrideValue: 0.5
  },
  {
    minimumKey: BALL_LOW_THROW_MIN_SPEED_KEY,
    maximumKey: BALL_LOW_THROW_MAX_SPEED_KEY,
    invalidOverrideKey: BALL_LOW_THROW_MAX_SPEED_KEY,
    invalidOverrideValue: 0,
    validOverrideValue: 16
  },
  {
    minimumKey: BALL_HIGH_THROW_MIN_PLANAR_SPEED_KEY,
    maximumKey: BALL_HIGH_THROW_MAX_PLANAR_SPEED_KEY,
    invalidOverrideKey: BALL_HIGH_THROW_MAX_PLANAR_SPEED_KEY,
    invalidOverrideValue: 0,
    validOverrideValue: 10
  },
  {
    minimumKey: BALL_HIGH_THROW_MIN_VERTICAL_SPEED_KEY,
    maximumKey: BALL_HIGH_THROW_MAX_VERTICAL_SPEED_KEY,
    invalidOverrideKey: BALL_HIGH_THROW_MAX_VERTICAL_SPEED_KEY,
    invalidOverrideValue: 0,
    validOverrideValue: 16
  }
] as const;

describe('central tuning registry', () => {
  it('exposes defaults as effective values with workbench metadata', () => {
    const registry = createTuningRegistry();

    expect(registry.get(RUNTIME_MAX_CATCH_UP_STEPS_KEY)).toEqual({
      key: RUNTIME_MAX_CATCH_UP_STEPS_KEY,
      domain: 'runtime',
      label: 'Maximum catch-up steps',
      defaultValue: 5,
      min: 1,
      max: 12,
      step: 1,
      overrideValue: undefined,
      effectiveValue: 5
    });
  });

  it('publishes live overrides and resets them to the committed default', () => {
    const registry = createTuningRegistry();
    let notifications = 0;
    const unsubscribe = registry.subscribe(() => {
      notifications += 1;
    });

    registry.setOverride(RUNTIME_MAX_CATCH_UP_STEPS_KEY, 8);

    expect(registry.getNumber(RUNTIME_MAX_CATCH_UP_STEPS_KEY)).toBe(8);
    expect(registry.get(RUNTIME_MAX_CATCH_UP_STEPS_KEY).overrideValue).toBe(8);

    registry.resetOverride(RUNTIME_MAX_CATCH_UP_STEPS_KEY);
    unsubscribe();

    expect(registry.getNumber(RUNTIME_MAX_CATCH_UP_STEPS_KEY)).toBe(5);
    expect(notifications).toBe(2);
  });

  it('supports future registrations without requiring a framework store', () => {
    const registry = createTuningRegistry();

    registry.register({
      key: 'test.futureValue',
      domain: 'movement',
      label: 'Max speed',
      defaultValue: 8,
      min: 0,
      max: 20,
      step: 0.1
    });

    expect(registry.getNumber(MOVEMENT_MAX_SPEED_KEY)).toBe(11);
    expect(registry.list()).toHaveLength(DEFAULT_TUNING_DEFINITIONS.length + 1);
  });

  it('registers arena dimensions and the shared player radius centrally', () => {
    const registry = createTuningRegistry();

    expect(registry.getNumber(ARENA_WIDTH_KEY)).toBe(18);
    expect(registry.get(PLAYER_RADIUS_KEY)).toMatchObject({
      domain: 'contact',
      label: 'Player radius',
      defaultValue: 0.6,
      min: 0.25,
      max: 2,
      step: 0.05
    });
  });

  it('registers the current canonical field-movement defaults', () => {
    const registry = createTuningRegistry();

    expect({
      radius: registry.getNumber(PLAYER_RADIUS_KEY),
      maxSpeed: registry.getNumber(MOVEMENT_MAX_SPEED_KEY),
      acceleration: registry.getNumber(MOVEMENT_ACCELERATION_KEY),
      turningResponse: registry.getNumber(MOVEMENT_TURNING_RESPONSE_KEY),
      braking: registry.getNumber(MOVEMENT_BRAKING_KEY),
      facingResponse: registry.getNumber(MOVEMENT_FACING_RESPONSE_KEY),
      reversalResponse: registry.getNumber(MOVEMENT_REVERSAL_RESPONSE_KEY)
    }).toEqual({
      radius: 0.6,
      maxSpeed: 11,
      acceleration: 60,
      turningResponse: 8,
      braking: 5,
      facingResponse: 2,
      reversalResponse: 5
    });
  });

  it('registers the independent movement turning response', () => {
    const registry = createTuningRegistry();

    expect(registry.get(MOVEMENT_TURNING_RESPONSE_KEY)).toMatchObject({
      domain: 'movement',
      label: 'Movement turning response',
      defaultValue: 8,
      min: 0,
      max: 60,
      step: 0.5,
      effectiveValue: 8
    });
  });

  it('registers the loose-ball and trajectory tunables centrally', () => {
    const registry = createTuningRegistry();

    expect({
      radius: registry.getNumber(BALL_RADIUS_KEY),
      planarDamping: registry.getNumber(BALL_PLANAR_DAMPING_KEY),
      gravity: registry.getNumber(BALL_GRAVITY_KEY),
      wallRestitution: registry.getNumber(BALL_WALL_RESTITUTION_KEY),
      groundRestitution: registry.getNumber(BALL_GROUND_RESTITUTION_KEY),
      groundDamping: registry.getNumber(BALL_GROUND_DAMPING_KEY),
      groundSettleSpeed: registry.getNumber(BALL_GROUND_SETTLE_SPEED_KEY),
      predictionHorizon: registry.getNumber(BALL_PREDICTION_HORIZON_STEPS_KEY)
    }).toEqual({
      radius: 0.35,
      planarDamping: 0.25,
      gravity: 28,
      wallRestitution: 0.85,
      groundRestitution: 0.45,
      groundDamping: 0.25,
      groundSettleSpeed: 0.5,
      predictionHorizon: 150
    });
  });

  it('registers throw charging, launch families, and lockout centrally', () => {
    const registry = createTuningRegistry();

    expect({
      minStrength: registry.getNumber(CONTROLS_THROW_MIN_STRENGTH_KEY),
      maxStrength: registry.getNumber(CONTROLS_THROW_MAX_STRENGTH_KEY),
      chargeToMaxSeconds: registry.getNumber(CONTROLS_THROW_CHARGE_TO_MAX_SECONDS_KEY),
      lowMinSpeed: registry.getNumber(BALL_LOW_THROW_MIN_SPEED_KEY),
      lowMaxSpeed: registry.getNumber(BALL_LOW_THROW_MAX_SPEED_KEY),
      highMinPlanarSpeed: registry.getNumber(BALL_HIGH_THROW_MIN_PLANAR_SPEED_KEY),
      highMaxPlanarSpeed: registry.getNumber(BALL_HIGH_THROW_MAX_PLANAR_SPEED_KEY),
      highMinVerticalSpeed: registry.getNumber(BALL_HIGH_THROW_MIN_VERTICAL_SPEED_KEY),
      highMaxVerticalSpeed: registry.getNumber(BALL_HIGH_THROW_MAX_VERTICAL_SPEED_KEY),
      lockoutTicks: registry.getNumber(BALL_POST_RELEASE_LOCKOUT_TICKS_KEY)
    }).toEqual({
      minStrength: 0.2,
      maxStrength: 1,
      chargeToMaxSeconds: 0.5,
      lowMinSpeed: 8,
      lowMaxSpeed: 30,
      highMinPlanarSpeed: 5,
      highMaxPlanarSpeed: 18,
      highMinVerticalSpeed: 12,
      highMaxVerticalSpeed: 22,
      lockoutTicks: 6
    });
  });

  it('rejects invalid throw tuning relationships atomically', () => {
    for (const relationship of THROW_TUNING_RELATIONSHIPS) {
      const registry = createTuningRegistry();
      const before = {
        minimum: registry.getNumber(relationship.minimumKey),
        maximum: registry.getNumber(relationship.maximumKey)
      };
      let notifications = 0;
      const unsubscribe = registry.subscribe(() => {
        notifications += 1;
      });

      expect(() =>
        registry.setOverride(
          relationship.invalidOverrideKey,
          relationship.invalidOverrideValue
        )
      ).toThrow(
        `Tuning relationship invalid: '${relationship.minimumKey}' must be less than or equal to '${relationship.maximumKey}'.`
      );

      expect(registry.getNumber(relationship.minimumKey)).toBe(before.minimum);
      expect(registry.getNumber(relationship.maximumKey)).toBe(before.maximum);
      expect(registry.get(relationship.invalidOverrideKey).overrideValue).toBeUndefined();
      expect(notifications).toBe(0);

      registry.setOverride(
        relationship.invalidOverrideKey,
        relationship.validOverrideValue
      );
      unsubscribe();

      expect(registry.getNumber(relationship.invalidOverrideKey)).toBe(
        relationship.validOverrideValue
      );
      expect(notifications).toBe(1);
    }
  });

  it('rejects invalid values and duplicate keys', () => {
    const registry = createTuningRegistry();

    expect(() => registry.setOverride(RUNTIME_MAX_CATCH_UP_STEPS_KEY, 13)).toThrow(
      "Tuning value for 'runtime.maxCatchUpSteps' must be between 1 and 12."
    );
    expect(() => registry.setOverride(RUNTIME_MAX_CATCH_UP_STEPS_KEY, 2.5)).toThrow(
      "Tuning value for 'runtime.maxCatchUpSteps' must use step 1."
    );
    expect(() =>
      registry.register({
        key: RUNTIME_MAX_CATCH_UP_STEPS_KEY,
        domain: 'runtime',
        label: 'Duplicate',
        defaultValue: 5,
        min: 1,
        max: 12,
        step: 1
      })
    ).toThrow("Tuning key 'runtime.maxCatchUpSteps' is already registered.");
  });
});
