import { describe, expect, it } from 'vitest';
import { createTuningRegistry } from '../config/tuning';
import { createArenaDefinition } from '../physics/arena';
import { DEFAULT_SCENARIOS } from '../scenarios/defaultScenarios';
import { inputSnapshot } from '../scenarios/controlScenario';
import {
  TEAM_CONTROL_SCENARIOS,
  createTeamControlScenarioStep,
  createTeamControlState,
  teamAmbiguousScenario,
  teamDefensiveScenario,
  teamFreePlayScenario,
  teamKeeperPossessionScenario,
  teamManualSwitchScenario,
  teamPassScenario,
  teamPossessionScenario,
  teamReceiverScenario
} from '../scenarios/teamControlScenario';
import { createReplayRecorder, replayScenario, type ReplayRecorder } from '../scenarios/replay';
import { createScenarioRun, runScenario, type ScenarioDefinition, type ScenarioInputFrame } from '../scenarios/scenario';
import { createTeamGameState } from '../sim/teams';
import type { GameState } from '../sim/gameState';
import { createControlRouter } from './controlRouter';
import type { ControlStepResult, InputSnapshot, RoutedPlayerIntent } from './types';

type TeamScenario = ScenarioDefinition<GameState, RoutedPlayerIntent>;
type SnapshotScenario = ScenarioDefinition<GameState, InputSnapshot>;

function snapshots(definition: TeamScenario, frames: readonly ScenarioInputFrame<InputSnapshot>[] = []): SnapshotScenario {
  return { ...definition, scriptedInputs: frames };
}

function sample(definition: TeamScenario, frames: readonly ScenarioInputFrame<InputSnapshot>[] = [], ticks = 60, diagnosticsEnabled = true) {
  const controls: ControlStepResult[] = [];
  const ballModes: GameState['ball']['mode'][] = [];
  const balls: GameState['ball'][] = [];
  const run = runScenario({
    definition: snapshots(definition, frames), getArena: createArenaDefinition,
    step: createTeamControlScenarioStep((result, state) => {
      controls.push(structuredClone(result)); ballModes.push(state.ball.mode); balls.push(structuredClone(state.ball));
    }),
    ticks, diagnosticsEnabled
  });
  return { run, controls, ballModes, balls };
}

function worldRouter(state: GameState, initialPlayerId = 'player-1') {
  const tuning = createTuningRegistry();
  const router = createControlRouter({ tuning, initialPlayerId, humanTeamId: 'human' });
  const world = { state, arena: createArenaDefinition(tuning) };
  return { router, tuning, world, consume: (snapshot = inputSnapshot()) => router.consumeTick(snapshot, undefined, world) };
}

describe('5v5 team control routing', () => {
  it('creates two stable five-player rosters with one keeper and four unspecialised field players', () => {
    const state = createTeamGameState();
    expect(state.players).toHaveLength(10);
    expect(new Set(state.players.map((player) => player.definition.id)).size).toBe(10);
    expect(state.teams).toHaveLength(2);
    for (const team of state.teams!) {
      const players = state.players.filter((player) => player.definition.teamId === team.id);
      expect(players.map((player) => player.definition.id)).toEqual(team.playerIds);
      expect(players.filter((player) => player.definition.role === 'field')).toHaveLength(4);
      expect(players.filter((player) => player.definition.role === 'goalkeeper')).toHaveLength(1);
    }
    expect(state.ball.mode).toBe('loose');
  });

  it('follows established possession without replacing identities, definitions, attributes or runtime state', () => {
    const state = teamPossessionScenario.createInitialState();
    const references = state.players.map((player) => ({ player, definition: player.definition, attributes: player.definition.attributes }));
    const before = structuredClone(state);
    const routing = worldRouter(state);
    const result = routing.consume(inputSnapshot({ low: true }));
    expect(result.assignment).toEqual({ playerId: 'player-2', reason: 'possession' });
    expect(result.routedIntent?.intent.actionContext).toBe('possessed');
    expect(result.routedIntent?.intent.lowThrow.pressed).toBe(true);
    expect(state).toEqual(before);
    references.forEach((original, index) => {
      expect(state.players[index]).toBe(original.player);
      expect(state.players[index].definition).toBe(original.definition);
      expect(state.players[index].definition.attributes).toBe(original.attributes);
    });
  });

  it('switches to a clear actual-trajectory receiver before contact and arms one-touch input', () => {
    const result = sample(teamReceiverScenario, [{ tick: 1, input: inputSnapshot({ low: true }) }], 1);
    expect(result.ballModes[0]).toBe('loose');
    expect(result.controls[0].assignment).toEqual({ playerId: 'player-2', reason: 'receiver' });
    expect(result.controls[0].routedIntent?.intent.actionContext).toBe('receiving');
    expect(result.run.state.players.find((player) => player.definition.id === 'player-2')!.oneTouch.charge.family).toBe('low');
    expect(result.controls[0].routing?.receiverClaim?.playerId).toBe('player-2');
    expect(result.controls[0].routing?.receiverCandidates.length).toBeGreaterThan(0);
  });

  it('executes a real throw, early receiver claim and ordinary teammate possession transfer', () => {
    const result = sample(teamPassScenario, [
      { tick: 1, input: inputSnapshot({ low: true }) },
      { tick: 2, input: inputSnapshot() }
    ]);
    expect(result.controls[0].assignment?.playerId).toBe('player-1');
    const early = result.controls.findIndex((control, index) =>
      control.assignment?.playerId === 'player-2' && result.ballModes[index] === 'loose');
    expect(early).toBeGreaterThan(1);
    expect(result.run.state.ball, JSON.stringify(result.balls.slice(0, 15))).toEqual({ mode: 'possessed', holderId: 'player-2' });
    expect(result.controls.at(-1)?.assignment?.reason).toBe('possession');
  });

  it('retains the current field player for an equal ambiguous loose ball', () => {
    const state = teamAmbiguousScenario.createInitialState();
    const routing = worldRouter(state, 'player-4');
    for (let tick = 0; tick < 20; tick++) {
      expect(routing.consume().assignment?.playerId).toBe('player-4');
      expect(routing.router.receiverClaim).toBeUndefined();
    }
  });

  it('retains a valid receiver claim when near-equal candidates change order slightly', () => {
    const state = createTeamControlState('receiver');
    const player2 = state.players.find((player) => player.definition.id === 'player-2')!;
    const player3 = state.players.find((player) => player.definition.id === 'player-3')!;
    const routing = worldRouter(state);
    expect(routing.consume().assignment?.playerId).toBe('player-2');
    player2.position = { x: 0.7, y: 2 };
    player3.position = { x: -0.7, y: 2 };
    for (let index = 0; index < 12; index++) {
      player3.position = { x: index % 2 ? -0.69 : -0.71, y: 2 };
      expect(routing.consume().assignment?.playerId).toBe('player-2');
    }
  });

  it('prefers useful goal-side defence over the geometrically nearest field player', () => {
    const result = sample(teamDefensiveScenario, [{ tick: 1, input: inputSnapshot({ low: true }) }], 1);
    const control = result.controls[0];
    expect(control.assignment).toEqual({ playerId: 'player-2', reason: 'defensive' });
    expect(control.routedIntent?.intent.actionContext).toBe('defending');
    expect(control.routedIntent?.intent.check.pressed).toBe(true);
    const candidates = control.routing!.defensiveCandidates;
    expect(candidates).toHaveLength(4);
    expect(candidates.every((candidate) => candidate.playerId.startsWith('player-'))).toBe(true);
    expect(candidates.every((candidate) => Number.isFinite(candidate.score) && Number.isFinite(candidate.pressureScore) && Number.isFinite(candidate.goalSideScore))).toBe(true);
  });

  it('manual defensive switching excludes keepers and holds the choice until context changes', () => {
    const routing = worldRouter(teamManualSwitchScenario.createInitialState());
    const automatic = routing.consume().assignment!.playerId;
    const manual = routing.consume(inputSnapshot({ switch: true }));
    expect(manual.assignment!.playerId).not.toBe(automatic);
    expect(manual.assignment!.reason).toBe('manual');
    expect(manual.assignment!.playerId).toMatch(/^player-[1-4]$/);
    for (let tick = 0; tick < 5; tick++) {
      expect(routing.consume(inputSnapshot({ switch: true })).assignment).toEqual(manual.assignment);
    }
    for (let tick = 0; tick < 8; tick++) {
      routing.consume();
      expect(routing.consume(inputSnapshot({ switch: true })).assignment!.playerId).toMatch(/^player-[1-4]$/);
    }
  });

  it('follows keeper possession and returns control to a predicted field receiver after distribution', () => {
    const result = sample(teamKeeperPossessionScenario, [
      { tick: 1, input: inputSnapshot({ low: true }) },
      { tick: 2, input: inputSnapshot() }
    ]);
    expect(result.controls[0].assignment).toEqual({ playerId: 'human-keeper', reason: 'possession' });
    const receiver = result.controls.findIndex((control, index) =>
      control.assignment?.playerId === 'player-2' && result.ballModes[index] === 'loose');
    expect(receiver).toBeGreaterThan(0);
    expect(result.run.state.ball).toEqual({ mode: 'possessed', holderId: 'player-2' });
    expect(result.controls.at(-1)?.assignment?.playerId).toBe('player-2');
  });

  it('keeps uncontrolled field players neutral in isolated scenes without tactical AI', () => {
    const neutralScene = { ...teamFreePlayScenario, createInitialState: createTeamGameState };
    const initial = neutralScene.createInitialState();
    const result = sample(neutralScene, [], 120);
    for (const original of initial.players.filter((player) => player.definition.role === 'field')) {
      const current = result.run.state.players.find((player) => player.definition.id === original.definition.id)!;
      expect(current.definition).toEqual(original.definition);
      expect(current.position).toEqual(original.position);
      expect(current.velocity).toEqual({ x: 0, y: 0 });
      expect(current.throwCharge.family).toBeUndefined();
      expect(current.contact.checkTicksRemaining).toBe(0);
    }
  });

  it('uses the registered workbench setups and preserves outcomes when diagnostics are disabled', () => {
    for (const definition of TEAM_CONTROL_SCENARIOS) {
      expect(DEFAULT_SCENARIOS).toContain(definition);
      const enabled = sample(definition, [], 5);
      const disabled = sample(definition, [], 5, false);
      expect(enabled.run.state).toEqual(disabled.run.state);
      expect(enabled.controls).toEqual(disabled.controls);
      expect(enabled.run.diagnostics!.getFrame().records.some((record) => record.entityId === 'control-state')).toBe(true);
    }
  });

  it('replays fixed-tick external snapshots and preserves routing across render schedules', () => {
    const definition = snapshots(teamPassScenario, [
      { tick: 1, input: inputSnapshot({ low: true }) },
      { tick: 2, input: inputSnapshot() }
    ]);
    const atRate = (fps: number) => {
      const assignments: unknown[] = [];
      const run = createScenarioRun({ definition, getArena: createArenaDefinition,
        step: createTeamControlScenarioStep((result) => assignments.push(result.assignment)) });
      for (let frame = 0; frame < fps; frame++) run.runtime.advance(1 / fps);
      return { state: run.state, assignments };
    };
    expect(atRate(30)).toEqual(atRate(120));
    let recorder: ReplayRecorder<GameState, InputSnapshot>;
    const run = createScenarioRun({
      definition, getArena: createArenaDefinition, step: createTeamControlScenarioStep(),
      onStep: (state, tick, input) => recorder.recordStep(tick, input, state)
    });
    recorder = createReplayRecorder({ scenarioId: definition.id, initialState: run.state,
      tuning: run.tuning, checkpointIntervalTicks: 10 });
    run.runtime.pause();
    for (let tick = 0; tick < 60; tick++) run.runtime.stepOnce();
    expect(replayScenario({ scenario: definition, replay: recorder.finish(run.state),
      step: createTeamControlScenarioStep(), getArena: createArenaDefinition }).run.state).toEqual(run.state);
  });
});
