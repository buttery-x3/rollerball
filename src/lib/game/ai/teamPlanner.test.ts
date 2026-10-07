import { describe, expect, it } from 'vitest';
import { createTuningRegistry } from '../config/tuning';
import { createNeutralPlayerIntent } from '../control/intent';
import type { RoutedPlayerIntent } from '../control/types';
import { createArenaDefinition } from '../physics/arena';
import { stepControlledGame } from '../runtime/stepControlledGame';
import { DEFAULT_SCENARIOS } from '../scenarios/defaultScenarios';
import { createReplayRecorder, replayScenario, type ReplayRecorder } from '../scenarios/replay';
import { createScenarioRun, runScenario, type ScenarioDefinition, type ScenarioStep } from '../scenarios/scenario';
import {
  TEAM_TACTICS_SCENARIOS, teamDefensiveTransitionScenario, teamGoalSideCoverageScenario,
  teamPressureAssignmentScenario, teamRoleStabilityScenario, teamSupportSpacingScenario
} from '../scenarios/teamTacticsScenario';
import type { GameState } from '../sim/gameState';
import { createTacticalState, type TacticalState, type TeamTacticalPlan } from '../sim/tactics';
import { fieldPlayerIntent } from './fieldController';
import { planTeams } from './teamPlanner';
import { createWorldQueries } from './worldQueries';

type TacticalScenario = ScenarioDefinition<GameState, RoutedPlayerIntent>;

function teamPlan(state: GameState, teamId = 'human'): TeamTacticalPlan {
  const plan = state.tactics?.teams.find((team) => team.teamId === teamId);
  if (!plan) throw new Error(`Missing tactical plan for ${teamId}.`);
  return plan;
}

function run(definition: TacticalScenario, ticks: number, diagnosticsEnabled = true) {
  return runScenario({ definition, step: stepControlledGame, getArena: createArenaDefinition, ticks, diagnosticsEnabled });
}

const neutralControllers: ScenarioStep<GameState, RoutedPlayerIntent> = (state, seconds, context) => {
  stepControlledGame(state, seconds, context, state.players.map((player) => ({
    playerId: player.definition.id, intent: createNeutralPlayerIntent()
  })));
};

function freezeDeep<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freezeDeep);
    Object.freeze(value);
  }
  return value;
}

describe('team tactical assignments and ordinary field execution', () => {
  it('creates distinct support, width and depth around the carrier and moves into useful space', () => {
    const initial = teamSupportSpacingScenario.createInitialState();
    const result = run(teamSupportSpacingScenario, 24);
    const plan = teamPlan(result.state);
    expect(plan.context).toBe('own-possession');
    expect(plan.assignments.map((assignment) => assignment.role).sort()).toEqual(['carrier', 'depth', 'support', 'width']);
    const support = plan.assignments.filter((assignment) => assignment.role !== 'carrier');
    const targets = support.map((assignment) => assignment.target);
    expect(Math.max(...targets.map((target) => target.x)) - Math.min(...targets.map((target) => target.x))).toBeGreaterThan(4);
    expect(Math.max(...targets.map((target) => target.y)) - Math.min(...targets.map((target) => target.y))).toBeGreaterThan(3);
    for (const assignment of support) {
      const before = initial.players.find((player) => player.definition.id === assignment.playerId)!;
      const after = result.state.players.find((player) => player.definition.id === assignment.playerId)!;
      expect(after.position).not.toEqual(before.position);
      expect(after.definition).toEqual(before.definition);
      expect(Math.hypot(after.position.x - assignment.target.x, after.position.y - assignment.target.y))
        .toBeLessThan(Math.hypot(before.position.x - assignment.target.x, before.position.y - assignment.target.y));
    }
  });

  it('selects one suitable pressure defender and reserves other responsibilities for coverage', () => {
    const result = run(teamPressureAssignmentScenario, 1);
    const plan = teamPlan(result.state);
    expect(plan.context).toBe('opponent-possession');
    expect(plan.assignments.filter((assignment) => assignment.role === 'pressure').map((assignment) => assignment.playerId)).toEqual(['player-1']);
    expect(plan.assignments.filter((assignment) => assignment.role === 'goal-side')).toHaveLength(1);
    expect(plan.assignments.filter((assignment) => assignment.role === 'lane-cover')).toHaveLength(2);
    expect(plan.assignments.every((assignment) => assignment.playerId !== 'human-keeper')).toBe(true);
  });

  it('keeps goal-side and passing-lane targets away from the carrier rather than collapsing every defender', () => {
    const result = run(teamGoalSideCoverageScenario, 18);
    const queries = createWorldQueries(result.state, createArenaDefinition(result.tuning), result.tuning);
    const ball = queries.ballPosition();
    const coverage = teamPlan(result.state).assignments.filter((assignment) => assignment.role !== 'pressure');
    expect(coverage).toHaveLength(3);
    expect(coverage.every((assignment) => queries.goalSide(assignment.target, 'human'))).toBe(true);
    expect(coverage.every((assignment) => Math.hypot(assignment.target.x - ball.x, assignment.target.y - ball.y) > 2)).toBe(true);
    const lanes = coverage.filter((assignment) => assignment.role === 'lane-cover');
    expect(lanes[0].target.x * lanes[1].target.x).toBeLessThan(0);
  });

  it('reconsiders immediately when an actual throw is intercepted and possession changes sides', () => {
    const frames: { tick: number; ball: GameState['ball']; plans: TacticalState }[] = [];
    const result = runScenario({ definition: teamDefensiveTransitionScenario, step: stepControlledGame,
      getArena: createArenaDefinition, ticks: 60,
      onStep: (state) => frames.push({ tick: state.tick, ball: structuredClone(state.ball), plans: structuredClone(state.tactics!) }) });
    expect(frames[0].plans.teams.find((plan) => plan.teamId === 'human')?.context).toBe('own-possession');
    expect(frames.some((frame) => frame.ball.mode === 'loose')).toBe(true);
    const interception = frames.findIndex((frame) => frame.ball.mode === 'possessed' && frame.ball.holderId === 'opponent-1');
    expect(interception).toBeGreaterThan(1);
    const after = frames[interception + 1];
    const defending = after.plans.teams.find((plan) => plan.teamId === 'human')!;
    expect(defending.context).toBe('opponent-possession');
    expect(defending.plannedTick).toBe(frames[interception].tick);
    expect(defending.assignments.filter((assignment) => assignment.role === 'pressure')).toHaveLength(1);
    expect(result.state.players).toHaveLength(10);
  });

  it('retains a pressure role against a slightly better challenger at the next think tick', () => {
    const held = runScenario({ definition: teamRoleStabilityScenario, getArena: createArenaDefinition,
      step: neutralControllers, ticks: 6 });
    const initial = teamPlan(held.state).assignments.find((assignment) => assignment.role === 'pressure')!;
    expect(initial.playerId).toBe('player-1');
    held.state.players.find((player) => player.definition.id === 'player-2')!.position = { x: 1.99, y: 0 };
    const arena = createArenaDefinition(held.tuning);
    const retained = planTeams(held.state, held.tuning, arena)!;
    const fresh = planTeams({ ...held.state, tactics: createTacticalState() }, held.tuning, arena)!;
    const pressure = (plan: TacticalState) => plan.teams.find((team) => team.teamId === 'human')!
      .assignments.find((assignment) => assignment.role === 'pressure')!;
    expect(pressure(fresh).playerId).toBe('player-2');
    expect(pressure(retained).playerId).toBe(initial.playerId);
    expect(pressure(retained).assignedTick).toBe(initial.assignedTick);
  });

  it('plans at the configured six-tick cadence rather than every physics tick', () => {
    const plannedTicks: number[] = [];
    const result = runScenario({ definition: teamSupportSpacingScenario, getArena: createArenaDefinition,
      step: neutralControllers, ticks: 18,
      onStep: (state) => plannedTicks.push(teamPlan(state).plannedTick) });
    expect(result.tuning.getNumber('ai.teamThinkTicks')).toBe(6);
    expect([...new Set(plannedTicks)]).toEqual([0, 6, 12]);
    expect(plannedTicks.slice(0, 6)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(teamPlan(result.state).nextThinkTick).toBe(18);
  });

  it('supports a distinct individual target cadence without changing roles every target update', () => {
    const definition: TacticalScenario = { ...teamSupportSpacingScenario,
      tuningOverrides: [{ key: 'ai.teamThinkTicks', value: 12 }, { key: 'ai.playerThinkTicks', value: 3 }] };
    const updates: { roleTick: number; targetTick: number; role: string }[] = [];
    runScenario({ definition, getArena: createArenaDefinition, step: neutralControllers, ticks: 10,
      onStep: (state) => {
        const plan = teamPlan(state);
        const assignment = plan.assignments.find((item) => item.role === 'support')!;
        updates.push({ roleTick: plan.plannedTick, targetTick: assignment.targetPlannedTick, role: assignment.playerId });
      } });
    expect(new Set(updates.map((update) => update.roleTick))).toEqual(new Set([0]));
    expect([...new Set(updates.map((update) => update.targetTick))]).toEqual([0, 3, 6, 9]);
    expect(new Set(updates.map((update) => update.role)).size).toBe(1);
  });

  it('produces read-only plans and intents and gives identical physics when a human submits the same intent', () => {
    const initial = teamSupportSpacingScenario.createInitialState();
    const tuning = createTuningRegistry();
    const arena = createArenaDefinition(tuning);
    const frozen = freezeDeep(structuredClone(initial));
    const plan = planTeams(frozen, tuning, arena)!;
    expect(frozen).toEqual(initial);
    const assignment = plan.teams.find((team) => team.teamId === 'human')!.assignments.find((item) => item.role === 'width')!;
    const intent = fieldPlayerIntent(frozen, assignment, tuning, arena);
    expect(frozen).toEqual(initial);
    expect(intent.intent.lowThrow.pressed).toBe(false);
    expect(intent.intent.check.pressed).toBe(false);
    const autonomous = structuredClone(initial);
    const externallyControlled = structuredClone(initial);
    stepControlledGame(autonomous, 1 / 60, { arena, tuning });
    stepControlledGame(externallyControlled, 1 / 60, { arena, tuning }, intent);
    expect(externallyControlled).toEqual(autonomous);
    const before = initial.players.find((player) => player.definition.id === assignment.playerId)!;
    const after = autonomous.players.find((player) => player.definition.id === assignment.playerId)!;
    const distance = Math.hypot(after.position.x - before.position.x, after.position.y - before.position.y);
    expect(distance).toBeGreaterThan(0);
    expect(distance).toBeLessThan(0.05);
    expect(after.position).not.toEqual(assignment.target);
    expect(Math.hypot(after.velocity.x, after.velocity.y)).toBeLessThanOrEqual(tuning.getNumber('movement.acceleration') / 60 + 1e-8);
  });

  it('keeps a selected spatial target stable over stationary near-equal reconsiderations', () => {
    const result = runScenario({ definition: teamSupportSpacingScenario, step: neutralControllers,
      getArena: createArenaDefinition, ticks: 1 });
    const original = teamPlan(result.state).assignments.find((assignment) => assignment.role === 'support')!;
    for (let tick = 0; tick < 18; tick++) result.runtime.stepOnce();
    const latest = teamPlan(result.state).assignments.find((assignment) => assignment.playerId === original.playerId)!;
    expect(latest.role).toBe(original.role);
    expect(latest.target).toEqual(original.target);
    expect(latest.assignedTick).toBe(original.assignedTick);
    expect(latest.targetPlannedTick).toBeGreaterThan(original.targetPlannedTick);
  });

  it('runs the same registered fixtures with inspectable role/target records and diagnostic parity', () => {
    for (const definition of TEAM_TACTICS_SCENARIOS) {
      expect(DEFAULT_SCENARIOS).toContain(definition);
      const enabled = run(definition, 8);
      const disabled = run(definition, 8, false);
      expect(enabled.state).toEqual(disabled.state);
      const records = enabled.diagnostics!.getFrame().records.filter((record) => record.layer === 'ai');
      expect(records.some((record) => record.entityId === 'ai-team-plan')).toBe(true);
      expect(JSON.stringify(records)).toContain('target');
      expect(JSON.stringify(records)).toContain('role');
      expect(JSON.stringify(records)).toContain('intent');
    }
  });

  it('preserves actual tactical movement, transition decisions and gameplay across render rates and replay', () => {
    const definition = teamDefensiveTransitionScenario;
    const atRate = (fps: number) => {
      const run = createScenarioRun({ definition, step: stepControlledGame, getArena: createArenaDefinition });
      for (let frame = 0; frame < fps / 2; frame++) run.runtime.advance(1 / fps);
      return run.state;
    };
    const slow = atRate(30);
    expect(slow).toEqual(atRate(120));
    expect(slow.tactics!.teams).toHaveLength(2);
    expect(slow.players[2].position).not.toEqual(definition.createInitialState().players[2].position);
    let recorder: ReplayRecorder<GameState, RoutedPlayerIntent>;
    const run = createScenarioRun({ definition, step: stepControlledGame, getArena: createArenaDefinition,
      onStep: (state, tick, input) => recorder.recordStep(tick, input, state) });
    recorder = createReplayRecorder({ scenarioId: definition.id, initialState: run.state,
      tuning: run.tuning, checkpointIntervalTicks: 5 });
    run.runtime.pause();
    for (let tick = 0; tick < 30; tick++) run.runtime.stepOnce();
    const replayed = replayScenario({ scenario: definition, replay: recorder.finish(run.state),
      step: stepControlledGame, getArena: createArenaDefinition });
    expect(replayed.run.state).toEqual(run.state);
    expect(replayed.run.state).toEqual(slow);
  });
});
