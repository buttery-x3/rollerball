import { describe, expect, it } from 'vitest';
import { RUNTIME_MAX_CATCH_UP_STEPS_KEY } from '../config/tuning';
import { DEFAULT_FIXED_STEP_SECONDS } from '../runtime/fixedStepRuntime';
import { createGameState, type GameState } from '../sim/gameState';
import { stepGame } from '../sim/stepGame';
import {
  DEFAULT_SCENARIOS,
  DETERMINISTIC_TICK_SCENARIO_ID,
  getScenario
} from './defaultScenarios';
import {
  createScenarioRun,
  runScenario,
  type ScenarioDefinition,
  type ScenarioStep
} from './scenario';

describe('deterministic scenarios', () => {
  it('runs the shared trivial scenario through the headless fixed-step runtime', () => {
    const scenario = getScenario(DETERMINISTIC_TICK_SCENARIO_ID);
    const run = runScenario({ definition: scenario, step: stepGame, ticks: 3 });

    expect(run.state.tick).toBe(3);
    expect(run.runtime.isPaused).toBe(true);
    expect(run.diagnostics?.getFrame().tick).toBe(3);
  });

  it('uses a fresh state and runtime when the same scenario is loaded again', () => {
    const scenario = DEFAULT_SCENARIOS[0];
    const firstRun = createScenarioRun({ definition: scenario, step: stepGame });

    firstRun.runtime.advance(DEFAULT_FIXED_STEP_SECONDS);

    const resetRun = createScenarioRun({ definition: scenario, step: stepGame });

    expect(resetRun.definition).toBe(scenario);
    expect(resetRun.state).toEqual({ tick: 0, players: [] });
    expect(resetRun.runtime.isPaused).toBe(false);
    expect(firstRun.state.tick).toBe(1);
  });

  it('can run the normal runtime without allocating diagnostics', () => {
    const scenario = getScenario(DETERMINISTIC_TICK_SCENARIO_ID);
    const run = createScenarioRun({
      definition: scenario,
      step: stepGame,
      diagnosticsEnabled: false
    });

    run.runtime.pause();
    run.runtime.stepOnce();

    expect(run.diagnostics).toBeUndefined();
    expect(run.state.tick).toBe(1);
  });

  it('delivers scripted inputs only on their recorded simulation ticks', () => {
    interface InputState extends GameState {
      readonly receivedInputs: number[];
    }

    const scenario: ScenarioDefinition<InputState, number> = {
      id: 'scripted-inputs',
      name: 'Scripted inputs',
      createInitialState: () => ({ tick: 0, players: [], receivedInputs: [] }),
      scriptedInputs: [
        { tick: 1, input: 10 },
        { tick: 3, input: 30 }
      ]
    };
    const step: ScenarioStep<InputState, number> = (state, _fixedStepSeconds, _context, input) => {
      state.tick += 1;
      if (input !== undefined) {
        state.receivedInputs.push(input);
      }
    };

    const run = runScenario({ definition: scenario, step, ticks: 3 });

    expect(run.state).toEqual({ tick: 3, players: [], receivedInputs: [10, 30] });
  });

  it('does not let an interactive input provider override scripted scenario inputs', () => {
    interface InputState extends GameState {
      readonly receivedInputs: number[];
    }

    const scenario: ScenarioDefinition<InputState, number> = {
      id: 'interactive-scripted-inputs',
      name: 'Interactive scripted inputs',
      createInitialState: () => ({ tick: 0, players: [], receivedInputs: [] }),
      scriptedInputs: [
        { tick: 1, input: 10 },
        { tick: 3, input: 30 }
      ]
    };
    const providerTicks: number[] = [];
    const step: ScenarioStep<InputState, number> = (state, _fixedStepSeconds, _context, input) => {
      state.tick += 1;
      if (input !== undefined) {
        state.receivedInputs.push(input);
      }
    };

    const run = runScenario({
      definition: scenario,
      step,
      inputProvider: (tick) => {
        providerTicks.push(tick);
        return 99;
      },
      ticks: 3
    });

    expect(run.state.receivedInputs).toEqual([10, 30]);
    expect(providerTicks).toEqual([]);
  });

  it('applies scenario tuning overrides through the central registry', () => {
    interface TuningState extends GameState {
      observedCatchUpSteps: number;
    }

    const scenario: ScenarioDefinition<TuningState, never> = {
      id: 'scenario-tuning',
      name: 'Scenario tuning',
      createInitialState: () => ({ tick: 0, players: [], observedCatchUpSteps: 0 }),
      tuningOverrides: [{ key: RUNTIME_MAX_CATCH_UP_STEPS_KEY, value: 8 }]
    };
    const step: ScenarioStep<TuningState, never> = (state, _fixedStepSeconds, context) => {
      state.tick += 1;
      state.observedCatchUpSteps = context.tuning?.getNumber(RUNTIME_MAX_CATCH_UP_STEPS_KEY) ?? 0;
    };

    const run = runScenario({ definition: scenario, step, ticks: 1 });

    expect(run.state.observedCatchUpSteps).toBe(8);
    expect(run.tuning.get(RUNTIME_MAX_CATCH_UP_STEPS_KEY).overrideValue).toBe(8);
  });

  it('includes scenario, tick, and invariant details when an assertion fails', () => {
    const scenario: ScenarioDefinition<GameState, never> = {
      id: 'failing-scenario',
      name: 'Failing scenario',
      createInitialState: createGameState,
      assertions: [
        {
          id: 'expected-state',
          check: () => {
            throw new Error('state did not match the expected setup');
          }
        }
      ]
    };

    expect(() => runScenario({ definition: scenario, step: stepGame, ticks: 1 })).toThrow(
      "Scenario 'failing-scenario' (Failing scenario) failed invariant 'expected-state' at tick 1: state did not match the expected setup"
    );
  });
});
