import { describe, expect, it } from 'vitest';
import { createTuningRegistry } from '../config/tuning';
import { createNeutralPlayerIntent } from '../control/intent';
import type { MatchInput, SimulationInput } from '../control/types';
import { createArenaDefinition } from '../physics/arena';
import { stepControlledGame } from '../runtime/stepControlledGame';
import { DEFAULT_SCENARIOS } from '../scenarios/defaultScenarios';
import {
  MATCH_FLOW_SCENARIOS, fullMatchScenario, matchExactFullTimeScenario,
  matchFinalTickGoalScenario, matchNearFullTimeGoalScenario,
  matchRematchResetScenario, matchRepeatedRestartsScenario
} from '../scenarios/matchFlowScenario';
import { createReplayRecorder, replayScenario, type ReplayRecorder } from '../scenarios/replay';
import { createScenarioRun, type ScenarioDefinition } from '../scenarios/scenario';
import { createAiActionState } from './actionState';
import { createEmptyContactState, createEmptyGoalkeeperState, createEmptyOneTouchState, createEmptyThrowChargeState, type GameState } from './gameState';
import { matchTimeRemaining, type MatchTransition } from './match';
import { createTacticalState } from './tactics';

type MatchScenario = ScenarioDefinition<GameState, SimulationInput>;

function sample(definition: MatchScenario, ticks = definition.automatedRunTicks, diagnosticsEnabled = true) {
  const run = createScenarioRun({ definition, step: stepControlledGame, getArena: createArenaDefinition, diagnosticsEnabled });
  const states: GameState[] = [];
  const transitions: MatchTransition[] = [];
  run.runtime.pause();
  for (let tick = 0; tick < ticks; tick++) {
    run.runtime.stepOnce();
    states.push(structuredClone(run.state));
    for (const record of run.diagnostics?.getFrame().records ?? []) {
      if (record.entityId === 'match-transition' && record.data) transitions.push(record.data as unknown as MatchTransition);
    }
  }
  return { run, states, transitions };
}

function expectClearedActions(state: GameState): void {
  for (const player of state.players) {
    expect(player.velocity).toEqual({ x: 0, y: 0 });
    expect(player.throwCharge).toEqual(createEmptyThrowChargeState());
    expect(player.oneTouch).toEqual(createEmptyOneTouchState());
    expect(player.contact).toEqual(createEmptyContactState());
    if (player.goalkeeper) expect(player.goalkeeper).toEqual(createEmptyGoalkeeperState());
  }
  expect(state.tactics).toEqual(createTacticalState());
  expect(state.aiActions).toEqual(createAiActionState());
}

describe('complete simulation-owned match flow', () => {
  it('opens a five-minute ready match with two stable teams and freezes gameplay until start', () => {
    const before = fullMatchScenario.createInitialState();
    expect(before.match!.phase).toBe('ready');
    expect(matchTimeRemaining(before.match!)).toBe(300);
    expect(before.players).toHaveLength(10);
    expect(before.teams).toHaveLength(2);
    expect(createTuningRegistry().getNumber('match.durationSeconds')).toBe(300);
    const definition: MatchScenario = { ...fullMatchScenario, scriptedInputs: [{ tick: 1, input: {
      playerIntents: [{ playerId: 'player-1', intent: createNeutralPlayerIntent({
        movement: { x: 1, y: 1 }, highThrow: { held: true, pressed: true, released: false }
      }) }]
    } }] };
    const result = sample(definition, 5);
    expect(result.run.state.tick).toBe(5);
    expect(result.run.state.players).toEqual(before.players);
    expect(result.run.state.ball).toEqual(before.ball);
    expect(result.run.state.match!.activeTicks).toBe(0);
    expect(result.run.state.match!.phase).toBe('ready');
  });

  it('consumes the start command as one fixed tick and begins active time on the next tick', () => {
    const definition: MatchScenario = { ...fullMatchScenario, scriptedInputs: [{ tick: 1, input: {
      matchAction: 'start', playerIntents: [{ playerId: 'player-1', intent: createNeutralPlayerIntent({ movement: { x: 1, y: 0 } }) }]
    } }] };
    const result = sample(definition, 2);
    const started = result.states[0];
    expect(started.match!.phase).toBe('playing');
    expect(started.match!.activeTicks).toBe(0);
    expect(started.match!.restartCount).toBe(1);
    expect(started.ball).toMatchObject({ mode: 'loose', position: { x: 0, y: 0 } });
    expectClearedActions(started);
    expect(result.states[1].match!.activeTicks).toBe(1);
    expect(result.transitions.map((transition) => transition.reason)).toEqual(['match-started']);
  });

  it('ends at exactly the configured active duration with a valid draw and no overtime', () => {
    const result = sample(matchExactFullTimeScenario);
    expect(result.states[59].match!.activeTicks).toBe(59);
    expect(result.states[59].match!.phase).toBe('playing');
    expect(result.states[60].match!.activeTicks).toBe(60);
    expect(result.states[60].match!.phase).toBe('full-time');
    expect(result.run.state.match!.score).toEqual({ human: 0, opponent: 0 });
    expect(matchTimeRemaining(result.run.state.match!)).toBe(0);
    expect(result.run.state.match!.activeTicks).toBe(60);
    expect(result.transitions.filter((transition) => transition.reason === 'clock-expired')).toHaveLength(1);
    expectClearedActions(result.run.state);
  });

  it('counts a valid final-tick goal before full time and never awards the crossing twice', () => {
    const result = sample(matchFinalTickGoalScenario);
    const ended = result.states[0];
    expect(ended.match!.phase).toBe('full-time');
    expect(ended.match!.activeTicks).toBe(60);
    expect(ended.match!.score).toEqual({ human: 1, opponent: 0 });
    expect(ended.match!.lastGoal?.crossing.crossed).toBe(true);
    expect(ended.match!.lastGoal?.tick).toBe(1);
    expect(result.transitions.map((transition) => transition.reason)).toEqual(['goal-scored', 'clock-expired']);
    expect(result.transitions.every((transition) => transition.tick === 1)).toBe(true);
    expect(result.run.state.match!.score).toEqual(ended.match!.score);
    expect(result.run.state.match!.restartCount).toBe(0);
  });

  it('pauses active time throughout goal stoppage and resumes for the one remaining active tick', () => {
    const result = sample(matchNearFullTimeGoalScenario);
    expect(result.states[0].match!.phase).toBe('goal-stoppage');
    expect(result.states[0].match!.activeTicks).toBe(59);
    const restartIndex = result.states.findIndex((state) => state.match!.transitionReason === 'goal-restart');
    expect(restartIndex).toBe(6);
    for (const state of result.states.slice(0, restartIndex + 1)) expect(state.match!.activeTicks).toBe(59);
    expect(result.states[restartIndex].match!.phase).toBe('playing');
    expectClearedActions(result.states[restartIndex]);
    expect(result.states[restartIndex + 1].match!.phase).toBe('full-time');
    expect(result.states[restartIndex + 1].match!.activeTicks).toBe(60);
    expect(result.run.state.match!.score.human).toBe(1);
  });

  it('repeats real throws, goals and deterministic clean restarts without accumulating action state', () => {
    const result = sample(matchRepeatedRestartsScenario);
    expect(result.transitions.filter((transition) => transition.reason === 'goal-scored')).toHaveLength(3);
    expect(result.transitions.filter((transition) => transition.reason === 'goal-restart')).toHaveLength(3);
    expect(result.run.state.match!.score).toEqual({ human: 3, opponent: 0 });
    expect(result.states.some((state) => state.players.some((player) => player.oneTouch.charge.family === 'low'))).toBe(true);
    expect(result.states.some((state) => state.players.some((player) => player.goalkeeper && player.goalkeeper.recoveryTicksRemaining > 0))).toBe(true);
    const resets = result.states.filter((state) => state.match!.lastTransition?.tick === state.tick &&
      state.match!.lastTransition.reason === 'goal-restart');
    for (const state of resets) {
      expectClearedActions(state);
      expect(state.ball).toMatchObject({ mode: 'loose', position: { x: 0, y: 0 }, release: undefined });
      for (const spawn of state.match!.restartPlayers) {
        const player = state.players.find((entry) => entry.definition.id === spawn.playerId)!;
        expect(player.position).toEqual(spawn.position);
        expect(player.facing).toEqual(spawn.facing);
      }
    }
    expect(resets.map((state) => state.match!.restartCount)).toEqual([2, 3, 4]);
  });

  it('rematches in the same runtime while clearing all previous-run state and preserving definitions and tuning', () => {
    const run = createScenarioRun({ definition: matchRematchResetScenario, step: stepControlledGame, getArena: createArenaDefinition });
    const stable = run.state.players.map((player) => ({ player, definition: player.definition, attributes: player.definition.attributes }));
    const teams = run.state.teams;
    const config = run.tuning.list();
    const spawns = structuredClone(run.state.match!.restartPlayers);
    run.runtime.pause();
    run.runtime.stepOnce();
    expect(run.state.tick).toBe(43);
    expect(run.state.match!.phase).toBe('ready');
    expect(run.state.match!.score).toEqual({ human: 0, opponent: 0 });
    expect(run.state.match!.activeTicks).toBe(0);
    expect(matchTimeRemaining(run.state.match!)).toBe(2);
    expect(run.state.match!.runRevision).toBe(3);
    expect(run.state.match!.restartCount).toBe(8);
    expect(run.state.match!.lastGoal).toBeUndefined();
    expect(run.state.match!.stoppageTicksRemaining).toBe(0);
    expect(run.state.ball).toMatchObject({ mode: 'loose', position: { x: 0, y: 0 }, velocity: { x: 0, y: 0 }, height: 0, verticalVelocity: 0, release: undefined });
    expectClearedActions(run.state);
    expect(run.state.teams).toBe(teams);
    stable.forEach((entry, index) => {
      expect(run.state.players[index]).toBe(entry.player);
      expect(run.state.players[index].definition).toBe(entry.definition);
      expect(run.state.players[index].definition.attributes).toBe(entry.attributes);
      expect(run.state.players[index].position).toEqual(spawns[index].position);
      expect(run.state.players[index].facing).toEqual(spawns[index].facing);
    });
    expect(run.tuning.list()).toEqual(config);
    expect(run.tuning.getNumber('movement.maxSpeed')).toBe(9);
  });

  it('ignores commands outside their valid phase and never repeats start or rematch resets', () => {
    const definition: MatchScenario = { ...matchExactFullTimeScenario,
      scriptedInputs: matchExactFullTimeScenario.scriptedInputs!.map((frame) => ({ ...frame,
        input: { ...frame.input as MatchInput,
          matchAction: frame.tick <= 5 ? 'start' as const : 'rematch' as const }
      })) };
    const result = sample(definition, 65);
    expect(result.states[4].match!.restartCount).toBe(1);
    expect(result.states[4].match!.activeTicks).toBe(4);
    expect(result.states[60].match!.phase).toBe('full-time');
    expect(result.states[61].match!.phase).toBe('ready');
    expect(result.run.state.match!.restartCount).toBe(2);
    expect(result.run.state.match!.runRevision).toBe(1);
    expect(result.run.state.match!.activeTicks).toBe(0);
  });

  it('publishes typed transition records with simulation time, reason and final score', () => {
    const result = sample(matchFinalTickGoalScenario, 1);
    expect(result.transitions).toHaveLength(2);
    for (const transition of result.transitions) {
      expect(transition.type).toBe('MatchTransition');
      expect(transition.activeTicks).toBe(60);
      expect(transition.durationTicks).toBe(60);
      expect(transition.remainingSeconds).toBe(0);
      expect(transition.score).toEqual({ human: 1, opponent: 0 });
    }
    expect(result.transitions[0]).toMatchObject({ from: 'playing', to: 'goal-stoppage', reason: 'goal-scored' });
    expect(result.transitions[1]).toMatchObject({ from: 'goal-stoppage', to: 'full-time', reason: 'clock-expired' });
  });

  it('uses the registered workbench scenarios and produces identical results with diagnostics disabled', () => {
    for (const definition of MATCH_FLOW_SCENARIOS) {
      expect(DEFAULT_SCENARIOS).toContain(definition);
      const enabled = sample(definition);
      const disabled = sample(definition, definition.automatedRunTicks, false);
      expect(enabled.run.state).toEqual(disabled.run.state);
      expect(enabled.run.diagnostics!.getFrame().records.some((record) => record.entityId === 'match-state')).toBe(true);
    }
  });

  it('replays start and rematch commands across the same fixed ticks and render schedules', () => {
    const setup = fullMatchScenario.createInitialState();
    const definition: MatchScenario = { ...matchExactFullTimeScenario, scriptedInputs: Array.from({ length: 120 }, (_, index) => ({
      tick: index + 1, input: { matchAction: index === 0 || index === 62 ? 'start' as const : index === 61 ? 'rematch' as const : undefined,
        playerIntents: setup.players.map((player) => ({ playerId: player.definition.id, intent: createNeutralPlayerIntent() })) }
    })) };
    const atRate = (fps: number) => {
      const run = createScenarioRun({ definition, step: stepControlledGame, getArena: createArenaDefinition });
      for (let frame = 0; frame < fps * 2; frame++) run.runtime.advance(1 / fps);
      return run.state;
    };
    const slow = atRate(30);
    expect(slow).toEqual(atRate(120));
    expect(slow.tick).toBe(120);
    expect(slow.match!.runRevision).toBe(1);
    expect(slow.match!.activeTicks).toBe(57);
    let recorder: ReplayRecorder<GameState, SimulationInput>;
    const run = createScenarioRun({ definition, step: stepControlledGame, getArena: createArenaDefinition,
      onStep: (state, tick, input) => recorder.recordStep(tick, input, state) });
    recorder = createReplayRecorder({ scenarioId: definition.id, initialState: run.state, tuning: run.tuning, checkpointIntervalTicks: 10 });
    run.runtime.pause();
    for (let tick = 0; tick < 120; tick++) run.runtime.stepOnce();
    const recording = recorder.finish(run.state);
    expect(recording.inputs.some((frame) => frame.input && !Array.isArray(frame.input) && 'matchAction' in frame.input && frame.input.matchAction === 'rematch')).toBe(true);
    const replayed = replayScenario({ scenario: definition, replay: recording, step: stepControlledGame, getArena: createArenaDefinition });
    expect(replayed.run.state).toEqual(run.state);
    expect(replayed.run.state).toEqual(slow);
  });
});
