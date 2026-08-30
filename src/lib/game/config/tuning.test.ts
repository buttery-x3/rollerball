import { describe, expect, it } from 'vitest';
import {
  createTuningRegistry,
  DEFAULT_TUNING_DEFINITIONS,
  ARENA_WIDTH_KEY,
  PLAYER_RADIUS_KEY,
  RUNTIME_MAX_CATCH_UP_STEPS_KEY
} from './tuning';

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
      key: 'movement.maxSpeed',
      domain: 'movement',
      label: 'Max speed',
      defaultValue: 8,
      min: 0,
      max: 20,
      step: 0.1
    });

    expect(registry.getNumber('movement.maxSpeed')).toBe(8);
    expect(registry.list()).toHaveLength(DEFAULT_TUNING_DEFINITIONS.length + 1);
  });

  it('registers arena dimensions and the shared player radius centrally', () => {
    const registry = createTuningRegistry();

    expect(registry.getNumber(ARENA_WIDTH_KEY)).toBe(18);
    expect(registry.get(PLAYER_RADIUS_KEY)).toMatchObject({
      domain: 'contact',
      label: 'Player radius',
      defaultValue: 0.75,
      min: 0.25,
      max: 2,
      step: 0.05
    });
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
