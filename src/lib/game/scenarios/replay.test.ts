import { describe, expect, it } from 'vitest';
import { RUNTIME_MAX_CATCH_UP_STEPS_KEY } from '../config/tuning';
import {
  createScenarioRun,
  runScenario,
  type ScenarioDefinition,
  type ScenarioStep
} from './scenario';
import {
  createReplayRecorder,
  replayScenario,
  ReplayDivergenceError,
  stableStateHash,
  type ReplayRecorder
} from './replay';
import type { GameState } from '../sim/gameState';

interface ReplayState extends GameState {
  readonly receivedInputs: number[];
  lastInput: number;
}

const replayScenarioDefinition: ScenarioDefinition<ReplayState, number> = {
  id: 'replay-inputs',
  name: 'Replay inputs',
  createInitialState: () => ({ tick: 0, receivedInputs: [], lastInput: 0 }),
  scriptedInputs: [
    { tick: 1, input: 2 },
    { tick: 2, input: 5 },
    { tick: 4, input: 9 }
  ],
  tuningOverrides: [{ key: RUNTIME_MAX_CATCH_UP_STEPS_KEY, value: 7 }]
};

const replayStep: ScenarioStep<ReplayState, number> = (
  state,
  _fixedStepSeconds,
  _context,
  input
) => {
  state.tick += 1;
  if (input !== undefined) {
    state.receivedInputs.push(input);
    state.lastInput = input;
  }
};

function createRecordedReplay(): {
  record: ReturnType<ReplayRecorder<ReplayState, number>['finish']>;
  finalState: ReplayState;
} {
  let recorder: ReplayRecorder<ReplayState, number> | undefined;
  const run = createScenarioRun({
    definition: replayScenarioDefinition,
    step: replayStep,
    onStep: (state, tick, input) => {
      recorder?.recordStep(tick, input, state);
    }
  });

  recorder = createReplayRecorder<ReplayState, number>({
    scenarioId: replayScenarioDefinition.id,
    initialState: run.state,
    tuning: run.tuning,
    checkpointIntervalTicks: 1
  });

  run.runtime.pause();
  for (let tick = 0; tick < 4; tick += 1) {
    run.runtime.stepOnce();
  }

  return { record: recorder.finish(run.state), finalState: run.state };
}

describe('deterministic replay', () => {
  it('records simulation-facing inputs and reproduces the final state and hash', () => {
    const { record, finalState } = createRecordedReplay();

    const replay = replayScenario({
      scenario: replayScenarioDefinition,
      step: replayStep,
      replay: record
    });

    expect(record.inputs).toEqual([
      { tick: 1, input: 2 },
      { tick: 2, input: 5 },
      { tick: 4, input: 9 }
    ]);
    expect(record.tuningOverrides).toEqual([
      { key: RUNTIME_MAX_CATCH_UP_STEPS_KEY, value: 7 }
    ]);
    expect(replay.run.state).toEqual(finalState);
    expect(replay.finalStateHash).toBe(record.finalStateHash);
    expect(stableStateHash(replay.run.state)).toBe(record.finalStateHash);
  });

  it('captures the initial state and optional per-tick checkpoints', () => {
    const { record } = createRecordedReplay();

    expect(record.initialTick).toBe(0);
    expect(record.initialStateHash).toBe(
      stableStateHash({ tick: 0, receivedInputs: [], lastInput: 0 })
    );
    expect(record.checkpoints).toHaveLength(4);
    expect(record.checkpoints.map((checkpoint) => checkpoint.tick)).toEqual([1, 2, 3, 4]);
  });

  it('reports the scenario and divergence tick when replay state differs', () => {
    const { record } = createRecordedReplay();
    const divergentStep: ScenarioStep<ReplayState, number> = (
      state,
      _fixedStepSeconds,
      _context,
      input
    ) => {
      replayStep(state, _fixedStepSeconds, _context, input);
      state.lastInput += 1;
    };

    expect(() =>
      replayScenario({
        scenario: replayScenarioDefinition,
        step: divergentStep,
        replay: record
      })
    ).toThrowError(
      new ReplayDivergenceError(
        replayScenarioDefinition.id,
        1,
        record.checkpoints[0].stateHash,
        stableStateHash({ tick: 1, receivedInputs: [2], lastInput: 3 })
      )
    );
  });

  it('runs the same scenario through the headless runner used by the workbench session', () => {
    const run = runScenario({
      definition: replayScenarioDefinition,
      step: replayStep,
      ticks: 4
    });

    expect(run.state).toEqual({ tick: 4, receivedInputs: [2, 5, 9], lastInput: 9 });
  });
});
