import { describe, expect, it } from 'vitest';
import { RUNTIME_MAX_CATCH_UP_STEPS_KEY } from '../config/tuning';
import { createNeutralPlayerIntent } from '../control/intent';
import type { SimulationInput } from '../control/types';
import { createArenaDefinition } from '../physics/arena';
import { stepControlledGame } from '../runtime/stepControlledGame';
import { matchExactFullTimeScenario } from './matchFlowScenario';
import {
  createScenarioRun,
  runScenario,
  type ScenarioDefinition,
  type ScenarioStep
} from './scenario';
import {
  createReplayRecorder,
  parseReplay,
  prepareReplayRun,
  replayScenario,
  ReplayConfigurationError,
  ReplayDivergenceError,
  serializeReplay,
  stableStateHash,
  type ReplayRecorder
} from './replay';
import { createGameState, type GameState } from '../sim/gameState';

interface ReplayState extends GameState {
  readonly receivedInputs: number[];
  lastInput: number;
}

const replayScenarioDefinition: ScenarioDefinition<ReplayState, number> = {
  id: 'replay-inputs',
  name: 'Replay inputs',
  automatedRunTicks: 4,
  createInitialState: () => ({
    ...createGameState(),
    receivedInputs: [],
    lastInput: 0
  }),
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
  for (
    let tick = 0;
    tick < replayScenarioDefinition.automatedRunTicks;
    tick += 1
  ) {
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

  it('snapshots reused mutable input objects at each recording tick', () => {
    interface MutableInput {
      direction: { x: number; y: number };
      strength: number;
    }

    interface MutableReplayState extends GameState {
      receivedInputs: Array<{
        direction: { x: number; y: number };
        strength: number;
      }>;
    }

    const sharedInput: MutableInput = {
      direction: { x: 1, y: 0 },
      strength: 0.25
    };
    const scenario: ScenarioDefinition<MutableReplayState, MutableInput> = {
      id: 'mutable-replay-inputs',
      name: 'Mutable replay inputs',
      automatedRunTicks: 2,
      createInitialState: () => ({
        ...createGameState(),
        receivedInputs: []
      }),
      scriptedInputs: [
        { tick: 1, input: sharedInput },
        { tick: 2, input: sharedInput }
      ]
    };
    const step: ScenarioStep<MutableReplayState, MutableInput> = (
      state,
      _fixedStepSeconds,
      _context,
      input
    ) => {
      state.tick += 1;
      if (input !== undefined) {
        state.receivedInputs.push({
          direction: { ...input.direction },
          strength: input.strength
        });
      }
    };

    let recorder: ReplayRecorder<MutableReplayState, MutableInput> | undefined;
    const run = createScenarioRun({
      definition: scenario,
      step,
      onStep: (state, tick, input) => {
        recorder?.recordStep(tick, input, state);
        if (tick === 1) {
          sharedInput.direction = { x: 2, y: 3 };
          sharedInput.strength = 0.5;
        }
      }
    });
    recorder = createReplayRecorder<MutableReplayState, MutableInput>({
      scenarioId: scenario.id,
      initialState: run.state,
      tuning: run.tuning,
      checkpointIntervalTicks: 1
    });

    run.runtime.pause();
    for (let tick = 0; tick < scenario.automatedRunTicks; tick += 1) {
      run.runtime.stepOnce();
    }
    const record = recorder.finish(run.state);
    const replay = replayScenario({ scenario, step, replay: record });

    expect(record.inputs).toEqual([
      { tick: 1, input: { direction: { x: 1, y: 0 }, strength: 0.25 } },
      { tick: 2, input: { direction: { x: 2, y: 3 }, strength: 0.5 } }
    ]);
    expect(record.inputs[0].input).not.toBe(sharedInput);
    expect(replay.run.state).toEqual(run.state);
    expect(replay.finalStateHash).toBe(record.finalStateHash);
  });

  it('captures the initial state and optional per-tick checkpoints', () => {
    const { record } = createRecordedReplay();

    expect(record.initialTick).toBe(0);
    expect(record.initialStateHash).toBe(
      stableStateHash({
        ...createGameState(),
        receivedInputs: [],
        lastInput: 0
      })
    );
    expect(record.checkpoints).toHaveLength(
      replayScenarioDefinition.automatedRunTicks
    );
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
        stableStateHash({
          ...createGameState(),
          tick: 1,
          receivedInputs: [2],
          lastInput: 3
        })
      )
    );
  });

  it('runs the same scenario through the headless runner used by the workbench session', () => {
    const run = runScenario({
      definition: replayScenarioDefinition,
      step: replayStep,
      ticks: replayScenarioDefinition.automatedRunTicks
    });

    expect(run.state).toEqual({
      ...createGameState(),
      tick: 4,
      receivedInputs: [2, 5, 9],
      lastInput: 9
    });
  });
});

function recordLiveMatch() {
  let recorder: ReplayRecorder<GameState, SimulationInput> | undefined;
  const phases: Array<{ tick: number; phase: string }> = [];
  const widths = new Map<number, number>();
  const initial = matchExactFullTimeScenario.createInitialState();
  const inputFrames = Array.from({ length: 80 }, (_, index) => {
    const tick = index + 1;
    const input: SimulationInput = {
      matchAction: tick === 1 || tick === 66 ? 'start' : tick === 64 ? 'rematch' : undefined,
      playerIntents: initial.players.map((player) => ({ playerId: player.definition.id,
        intent: createNeutralPlayerIntent(player.definition.id === 'player-1'
          ? { movement: { x: 1, y: 0 }, desiredFacing: { x: 1, y: 0 } } : {}) }))
    };
    return { tick, input };
  });
  const run = createScenarioRun({
    definition: matchExactFullTimeScenario, inputFrames, getArena: createArenaDefinition,
    step: (state, seconds, context, input) => {
      widths.set(state.tick + 1, context.arena!.width);
      stepControlledGame(state, seconds, context, input);
    },
    onStep: (state, tick, input) => {
      recorder?.recordStep(tick, input, state);
      phases.push({ tick, phase: state.match!.phase });
    }
  });
  const captureTuning = (tick: number) => recorder!.recordTuningChange(tick, run.tuning.list()
    .filter((entry) => entry.overrideValue !== undefined)
    .map((entry) => ({ key: entry.key, value: entry.overrideValue! })));
  run.runtime.pause();
  for (let tick = 1; tick <= 80; tick += 1) {
    if (tick === 11) recorder = createReplayRecorder<GameState, SimulationInput>({
      scenarioId: run.definition.id, initialState: run.state, tuning: run.tuning,
      includeInitialState: true, checkpointIntervalTicks: 5
    });
    if (tick === 12) {
      run.tuning.setOverride('movement.maxSpeed', 7);
      captureTuning(tick);
      run.tuning.setOverride('arena.width', 24);
      captureTuning(tick);
    }
    if (tick === 20) { run.tuning.resetOverride('movement.maxSpeed'); captureTuning(tick); }
    if (tick === 30) { run.tuning.resetOverride('arena.width'); captureTuning(tick); }
    run.runtime.stepOnce();
  }
  // An edit made after the last recorded step did not affect the recording.
  run.tuning.setOverride('movement.maxSpeed', 8);
  captureTuning(81);
  return { record: recorder!.finish(run.state), state: structuredClone(run.state), phases, widths };
}

describe('workbench replay recording and JSON playback', () => {
  it('replays a real match from an arbitrary tick with live tuning edits, reset, and match commands', () => {
    const original = recordLiveMatch();
    const json = serializeReplay(original.record);
    const record = parseReplay<SimulationInput>(json);
    const widths = new Map<number, number>();
    const playedPhases: Array<{ tick: number; phase: string }> = [];
    const playback = prepareReplayRun({
      scenario: matchExactFullTimeScenario, replay: record, getArena: createArenaDefinition,
      step: (state, seconds, context, input) => {
        widths.set(state.tick + 1, context.arena!.width);
        stepControlledGame(state, seconds, context, input);
      },
      onStep: (state, tick) => { playedPhases.push({ tick, phase: state.match!.phase }); }
    });
    expect(playback.run.state.tick).toBe(10);
    expect(playback.run.state.players[0].velocity.x).toBeGreaterThan(0);
    expect(playback.run.runtime.isPaused).toBe(true);
    expect(record.initialState).not.toBe(original.record.initialState);
    expect(record.tuningChanges?.map((frame) => frame.tick)).toEqual([12, 20, 30]);
    expect(() => playback.verifyFinal()).toThrow('requires tick 80');
    playback.run.runtime.resume();
    // Uneven frames intentionally include multiple fixed steps and a partial step.
    let frames = 0;
    while (!playback.complete && frames < 200) {
      playback.run.runtime.advance([1 / 144, 1 / 30, 1 / 60][frames % 3]);
      frames += 1;
    }
    expect(playback.complete).toBe(true);
    expect(playback.run.runtime.isPaused).toBe(true);
    expect(playback.verifyFinal()).toBe(record.finalStateHash);
    expect(playback.run.state).toEqual(original.state);
    expect(playedPhases).toEqual(original.phases.filter((entry) => entry.tick > 10));
    expect(playedPhases).toContainEqual({ tick: 61, phase: 'full-time' });
    expect(playedPhases).toContainEqual({ tick: 64, phase: 'ready' });
    expect(playedPhases).toContainEqual({ tick: 66, phase: 'playing' });
    expect(widths.get(12)).toBe(24);
    expect(widths.get(30)).toBe(original.widths.get(30));
    expect(playback.run.tuning.get('movement.maxSpeed').overrideValue).toBeUndefined();
    expect(playback.run.tuning.get('arena.width').overrideValue).toBeUndefined();
    expect(playback.run.state.match!.runRevision).toBe(1);
    expect(playback.run.state.tick).toBe(80);
    expect(() => playback.run.runtime.stepOnce()).toThrow('playback has already finished');
    expect(playback.run.state.tick).toBe(80);
  });

  it('preserves v1 hashes for undefined, negative zero, and user data resembling JSON tags', () => {
    const run = createScenarioRun({ definition: replayScenarioDefinition, step: replayStep });
    run.state.lastInput = -0;
    const recorder = createReplayRecorder<ReplayState, unknown>({
      scenarioId: run.definition.id, initialState: run.state, tuning: run.tuning, includeInitialState: true
    });
    const input = { optional: undefined, zero: -0, list: [undefined, -0],
      escaped: { $rollerballReplay: 'undefined', value: { $rollerballReplay: 'object', entries: [] } },
      largeInteger: 1234567890123456789n };
    run.state.tick = 1;
    recorder.recordStep(1, input, run.state);
    const original = recorder.finish(run.state);
    const decoded = parseReplay<typeof input>(serializeReplay(original));
    expect(decoded).toEqual(original);
    expect(Object.hasOwn(decoded.inputs[0].input, 'optional')).toBe(true);
    expect(Object.is(decoded.inputs[0].input.zero, -0)).toBe(true);
    expect(decoded.inputs[0].input.escaped.$rollerballReplay).toBe('undefined');
    expect(stableStateHash(decoded.initialState!)).toBe(original.initialStateHash);
    expect(stableStateHash({ ...createGameState(), payload: decoded.inputs })).toBe(
      stableStateHash({ ...createGameState(), payload: original.inputs }));
  });

  it('accepts legacy plain v1 JSON and ends within a multi-step render frame without overshoot', () => {
    const { record } = createRecordedReplay();
    const legacy = parseReplay<number>(JSON.stringify(record));
    const playback = prepareReplayRun({ scenario: replayScenarioDefinition, replay: legacy, step: replayStep });
    expect(legacy.formatVersion).toBe(1);
    playback.run.runtime.resume();
    const frame = playback.run.runtime.advance(1);
    expect(frame.simulationSteps).toBe(4);
    expect(playback.complete).toBe(true);
    expect(playback.run.state.tick).toBe(record.finalTick);
    expect(playback.verifyFinal()).toBe(record.finalStateHash);
    expect(playback.run.runtime.advance(1).simulationSteps).toBe(0);
  });

  it('verifies JSON recordings at different frame rates and with diagnostics disabled', () => {
    const { record } = recordLiveMatch();
    for (const framesPerSecond of [30, 144]) {
      const playback = prepareReplayRun({ scenario: matchExactFullTimeScenario,
        replay: parseReplay<SimulationInput>(serializeReplay(record)), step: stepControlledGame,
        getArena: createArenaDefinition, diagnosticsEnabled: false });
      playback.run.runtime.resume();
      for (let frame = 0; !playback.complete && frame < 300; frame += 1) {
        playback.run.runtime.advance(1 / framesPerSecond);
      }
      expect(playback.complete).toBe(true);
      expect(playback.verifyFinal()).toBe(record.finalStateHash);
    }
  });

  it('pauses and identifies the first divergent checkpoint during incremental playback', () => {
    const { record } = createRecordedReplay();
    const playback = prepareReplayRun({ scenario: replayScenarioDefinition, replay: record,
      step: (state, seconds, context, input) => {
        replayStep(state, seconds, context, input);
        if (state.tick === 2) state.lastInput += 1;
      } });
    playback.run.runtime.resume();
    expect(() => playback.run.runtime.advance(1 / 30)).toThrowError(/diverged at tick 2/);
    expect(playback.run.state.tick).toBe(2);
    expect(playback.run.runtime.isPaused).toBe(true);
    expect(playback.complete).toBe(false);
  });

  it('rejects malformed imports and ordered tuning changes before gameplay', () => {
    const { record } = createRecordedReplay();
    const invalid = [
      { ...record, formatVersion: 2 },
      { ...record, inputs: [{ tick: 5, input: 0 }] },
      { ...record, checkpoints: [{ tick: 0, stateHash: 'bad' }] },
      { ...record, tuningChanges: [{ tick: 2, overrides: [] }, { tick: 1, overrides: [] }] },
      { ...record, tuningChanges: [{ tick: 1, overrides: [{ key: 'arena.width', value: 20 }, { key: 'arena.width', value: 24 }] }] },
      { ...record, initialState: { tick: 0, players: [] } }
    ];
    for (const value of invalid) expect(() => parseReplay(JSON.stringify(value))).toThrow(ReplayConfigurationError);
    expect(() => parseReplay('{broken')).toThrow();
    expect(() => parseReplay(JSON.stringify({ encoding: 'rollerball-replay-lossless-v1',
      replay: { $rollerballReplay: 'unknown-tag' } }))).toThrow('malformed replay JSON value tag');
  });

  it('snapshots initial state and tuning edits, and verifies an empty mid-run recording', () => {
    const run = createScenarioRun({ definition: replayScenarioDefinition, step: replayStep });
    run.runtime.pause();
    run.runtime.stepOnce();
    const recorder = createReplayRecorder<ReplayState, number>({ scenarioId: run.definition.id,
      initialState: run.state, tuning: run.tuning, includeInitialState: true });
    const override = [{ key: RUNTIME_MAX_CATCH_UP_STEPS_KEY, value: 8 }];
    recorder.recordTuningChange(2, override);
    override[0].value = 9;
    const record = recorder.finish(run.state);
    run.state.lastInput = 999;
    const playback = prepareReplayRun({ scenario: replayScenarioDefinition, replay: record, step: replayStep });
    expect(record.tuningChanges).toEqual([]);
    expect(playback.complete).toBe(true);
    expect(playback.run.state.lastInput).toBe(2);
    expect(playback.verifyFinal()).toBe(record.finalStateHash);
    expect(() => recorder.recordTuningChange(2, [])).toThrow('after finish');
  });
});
