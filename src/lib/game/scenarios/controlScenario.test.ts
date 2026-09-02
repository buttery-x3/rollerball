import { describe, expect, it } from 'vitest';
import {
  createReplayRecorder,
  replayScenario,
  stableStateHash,
  type ReplayRecorder
} from './replay';
import {
  type ControlInputScenarioState,
  controlInputConsumptionScenario,
  createControlInputScenarioStep
} from './controlScenario';
import type { InputSnapshot } from '../control/types';
import { createScenarioRun, runScenario } from './scenario';

function runControlScenario() {
  return runScenario({
    definition: controlInputConsumptionScenario,
    step: createControlInputScenarioStep(),
    ticks: controlInputConsumptionScenario.automatedRunTicks
  });
}

describe('control input scenario', () => {
  it('covers exactly-once button edges and right-stick rearming headlessly', () => {
    const run = runControlScenario();

    expect(run.state.pressedTicks).toEqual([1]);
    expect(run.state.releasedTicks).toEqual([3]);
    expect(run.state.pulses.map(({ tick }) => tick)).toEqual([3, 8]);
    expect(run.state.assignmentByTick).toHaveLength(8);
    expect(run.state.assignmentByTick.every(({ playerId }) => playerId === 'player-1')).toBe(
      true
    );
  });

  it('produces identical control state on repeated scenario runs', () => {
    const first = runControlScenario();
    const second = runControlScenario();

    expect(second.state).toEqual(first.state);
    expect(stableStateHash(second.state)).toBe(stableStateHash(first.state));
  });

  it('replays mapped control snapshots through the same scenario step', () => {
    let recorder: ReplayRecorder<ControlInputScenarioState, InputSnapshot> | undefined;
    const run = createScenarioRun({
      definition: controlInputConsumptionScenario,
      step: createControlInputScenarioStep(),
      onStep: (state, tick, input) => {
        recorder?.recordStep(tick, input, state);
      }
    });
    recorder = createReplayRecorder({
      scenarioId: controlInputConsumptionScenario.id,
      initialState: run.state,
      tuning: run.tuning,
      checkpointIntervalTicks: 1
    });

    run.runtime.pause();
    for (
      let tick = 0;
      tick < controlInputConsumptionScenario.automatedRunTicks;
      tick += 1
    ) {
      run.runtime.stepOnce();
    }

    const record = recorder.finish(run.state);
    const replay = replayScenario({
      scenario: controlInputConsumptionScenario,
      step: createControlInputScenarioStep(),
      replay: record
    });

    expect(replay.run.state).toEqual(run.state);
    expect(replay.finalStateHash).toBe(record.finalStateHash);
  });
});
