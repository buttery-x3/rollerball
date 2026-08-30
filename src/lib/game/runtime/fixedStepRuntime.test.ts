import { describe, expect, it } from 'vitest';
import { createGameState } from '../sim/gameState';
import { stepGame } from '../sim/stepGame';
import {
  createFixedStepRuntime,
  DEFAULT_FIXED_STEP_SECONDS
} from './fixedStepRuntime';

function runSchedule(schedule: number[]): number {
  const state = createGameState();
  const runtime = createFixedStepRuntime({
    state,
    step: stepGame,
    fixedStepSeconds: DEFAULT_FIXED_STEP_SECONDS,
    maxCatchUpSteps: 8
  });

  for (const frameDeltaSeconds of schedule) {
    runtime.advance(frameDeltaSeconds);
  }

  return state.tick;
}

describe('fixed-step runtime', () => {
  it('advances the headless simulation exactly once per fixed step', () => {
    const state = createGameState();
    const runtime = createFixedStepRuntime({ state, step: stepGame });

    const frame = runtime.advance(DEFAULT_FIXED_STEP_SECONDS);

    expect(frame.simulationSteps).toBe(1);
    expect(state.tick).toBe(1);
  });

  it('keeps simulation results stable across render schedules', () => {
    const atThirtyHz = Array.from({ length: 30 }, () => 1 / 30);
    const atSixtyHz = Array.from({ length: 60 }, () => 1 / 60);
    const atOneTwentyHz = Array.from({ length: 120 }, () => 1 / 120);

    expect(runSchedule(atThirtyHz)).toBe(60);
    expect(runSchedule(atSixtyHz)).toBe(60);
    expect(runSchedule(atOneTwentyHz)).toBe(60);
  });

  it('bounds catch-up work and discards excess debt after a stalled render frame', () => {
    const state = createGameState();
    const runtime = createFixedStepRuntime({
      state,
      step: stepGame,
      maxCatchUpSteps: 4
    });

    const frame = runtime.advance(60 * 60);
    const normalFrame = runtime.advance(DEFAULT_FIXED_STEP_SECONDS);

    expect(frame.simulationSteps).toBe(4);
    expect(normalFrame.simulationSteps).toBe(1);
    expect(state.tick).toBe(5);
    expect(frame.alpha).toBeGreaterThanOrEqual(0);
    expect(frame.alpha).toBeLessThanOrEqual(1);
    expect(normalFrame.alpha).toBeGreaterThanOrEqual(0);
    expect(normalFrame.alpha).toBeLessThanOrEqual(1);
  });
});
