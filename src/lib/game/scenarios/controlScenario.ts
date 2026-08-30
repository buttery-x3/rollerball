import { createNeutralInputSnapshot } from '../control/browserInput';
import { createControlRouter } from '../control/controlRouter';
import type { InputSnapshot, RightStickThrowPulse } from '../control/types';
import type { GameState } from '../sim/gameState';
import type { ScenarioDefinition, ScenarioStep } from './scenario';

export interface ControlInputScenarioState extends GameState {
  readonly pressedTicks: number[];
  readonly releasedTicks: number[];
  readonly pulses: Array<{ readonly tick: number; readonly pulse: RightStickThrowPulse }>;
  readonly assignmentByTick: Array<{ readonly tick: number; readonly playerId: string }>;
}

export const CONTROL_INPUT_SCENARIO_ID = 'control-input-consumption';

export const controlInputConsumptionScenario: ScenarioDefinition<
  ControlInputScenarioState,
  InputSnapshot
> = {
  id: CONTROL_INPUT_SCENARIO_ID,
  name: 'Control input consumption',
  createInitialState: () => ({
    tick: 0,
    pressedTicks: [],
    releasedTicks: [],
    pulses: [],
    assignmentByTick: []
  }),
  scriptedInputs: [
    { tick: 1, input: inputSnapshot({ low: true, rightStick: { x: 0.4, y: 0 } }) },
    { tick: 2, input: inputSnapshot({ low: true, rightStick: { x: 0.8, y: 0 } }) },
    { tick: 3, input: inputSnapshot({ rightStick: { x: 0.8, y: 0.2 } }) },
    { tick: 4, input: inputSnapshot({ rightStick: { x: 0.8, y: 0.2 } }) },
    { tick: 5, input: inputSnapshot() },
    { tick: 6, input: inputSnapshot({ rightStick: { x: 0.5, y: 0 } }) },
    { tick: 7, input: inputSnapshot({ rightStick: { x: 0.5, y: 0 } }) },
    { tick: 8, input: inputSnapshot({ rightStick: { x: 0.5, y: 0 } }) }
  ],
  assertions: [
    {
      id: 'low-button-edge-is-single-use',
      check: (state) => {
        if (state.pressedTicks.length > 1 || state.releasedTicks.length > 1) {
          throw new Error('Low-button edges were consumed more than once.');
        }
      }
    },
    {
      id: 'right-stick-pulses-are-single-use',
      check: (state) => {
        if (state.pulses.length > 2) {
          throw new Error('Right-stick pulses were emitted more than once per capture.');
        }
      }
    }
  ]
};

export function inputSnapshot(
  overrides: Partial<{
    movement: { x: number; y: number };
    rightStick: { x: number; y: number };
    low: boolean;
    high: boolean;
    switch: boolean;
  }> = {}
): InputSnapshot {
  return {
    movement: overrides.movement ?? { x: 0, y: 0 },
    rightStick: overrides.rightStick ?? { x: 0, y: 0 },
    buttons: {
      low: overrides.low ?? false,
      high: overrides.high ?? false,
      switch: overrides.switch ?? false
    }
  };
}

export function createControlInputScenarioStep(): ScenarioStep<
  ControlInputScenarioState,
  InputSnapshot
> {
  let router: ReturnType<typeof createControlRouter> | undefined;

  return (state, _fixedStepSeconds, context, input) => {
    if (!context.tuning) {
      throw new Error('The control input scenario requires a tuning registry.');
    }

    router ??= createControlRouter({ tuning: context.tuning, initialPlayerId: 'player-1' });
    const result = router.consumeTick(input ?? createNeutralInputSnapshot(), 'possessed');
    state.tick += 1;

    if (result.input.buttons.low.pressed) {
      state.pressedTicks.push(state.tick);
    }
    if (result.input.buttons.low.released) {
      state.releasedTicks.push(state.tick);
    }
    if (result.routedIntent?.intent.rightStickThrow) {
      state.pulses.push({
        tick: state.tick,
        pulse: result.routedIntent.intent.rightStickThrow
      });
    }
    if (result.assignment) {
      state.assignmentByTick.push({
        tick: state.tick,
        playerId: result.assignment.playerId
      });
    }
  };
}
