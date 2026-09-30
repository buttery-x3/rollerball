import { describe, expect, it } from 'vitest';
import { createTuningRegistry } from '../config/tuning';
import { createNeutralPlayerIntent } from '../control/intent';
import type { RoutedPlayerIntent } from '../control/types';
import { createDiagnosticStore } from '../debug/diagnosticStore';
import { createArenaDefinition } from '../physics/arena';
import { stepControlledGame } from '../runtime/stepControlledGame';
import {
  AI_CANDIDATE_SCENARIOS, aiInvalidOptionsScenario, aiOpenSupportScenario,
  aiStableSupportScenario, getCandidatePreviewRequest
} from '../scenarios/aiCandidateScenario';
import { DEFAULT_SCENARIOS } from '../scenarios/defaultScenarios';
import { createReplayRecorder, replayScenario, type ReplayRecorder } from '../scenarios/replay';
import { createScenarioRun, runScenario, type ScenarioDefinition, type ScenarioStep } from '../scenarios/scenario';
import { estimateReachSeconds, receiveOpportunities } from '../sim/ballQueries';
import { createLooseBallState, type GameState } from '../sim/gameState';
import { createWorldQueries } from './worldQueries';
import { evaluateSpatialCandidates, type SpatialCandidateOptions, type SpatialEvaluation } from './tacticalCandidates';

type CandidateScenario = ScenarioDefinition<GameState, RoutedPlayerIntent>;

function evaluate(definition: CandidateScenario, options?: SpatialCandidateOptions, state = definition.createInitialState()) {
  const tuning = createTuningRegistry();
  const request = getCandidatePreviewRequest(definition.id)!;
  return evaluateSpatialCandidates(state, request.playerId, options ?? request.options, createArenaDefinition(tuning), tuning);
}

function freezeDeep<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freezeDeep);
    Object.freeze(value);
  }
  return value;
}

function previewStep(definition: CandidateScenario, decisions: SpatialEvaluation[], preview = true): ScenarioStep<GameState, RoutedPlayerIntent> {
  const request = getCandidatePreviewRequest(definition.id)!;
  let previousId = request.options.previousId;
  return (state, seconds, context, input) => {
    stepControlledGame(state, seconds, context, input);
    if (!preview) return;
    if (!context.arena || !context.tuning) throw new Error('Candidate preview requires arena and tuning.');
    const decision = evaluateSpatialCandidates(state, request.playerId,
      { ...request.options, previousId }, context.arena, context.tuning, context.diagnostics);
    previousId = decision.selected?.id;
    decisions.push(decision);
  };
}

describe('shared tactical spatial candidates', () => {
  it('selects open support over an equally progressive but crowded option with inspectable factors', () => {
    const result = evaluate(aiOpenSupportScenario);
    const open = result.candidates.find((candidate) => candidate.id === 'open')!;
    const crowded = result.candidates.find((candidate) => candidate.id === 'crowded')!;
    expect(result.selected?.id).toBe('open');
    expect(open.rejectedReason).toBeUndefined();
    expect(crowded.rejectedReason).toBeUndefined();
    expect(open.factors.progression).toBeCloseTo(crowded.factors.progression);
    expect(open.factors.spacing).toBeGreaterThan(crowded.factors.spacing);
    expect(open.score).toBeGreaterThan(crowded.score);
    expect(open.laneTested).toBe(true);
    expect(result).toEqual(evaluate(aiOpenSupportScenario));
  });

  it('cheap-rejects illegal and occupied points before testing useful lanes', () => {
    const result = evaluate(aiInvalidOptionsScenario);
    const byId = (id: string) => result.candidates.find((candidate) => candidate.id === id)!;
    expect(byId('outside').rejectedReason).toBe('outside-bounds');
    expect(byId('occupied').rejectedReason).toBe('spacing');
    expect(byId('outside').laneTested).toBe(false);
    expect(byId('occupied').laneTested).toBe(false);
    expect(byId('blocked').rejectedReason).toBe('blocked-lane');
    expect(byId('blocked').laneTested).toBe(true);
    expect(result.selected?.id).toBe('open');
    expect(result.expensiveTests).toBe(2);
  });

  it('bounds expensive tests to the useful shortlist when generating a spatial field', () => {
    const state = aiStableSupportScenario.createInitialState();
    const tuning = createTuningRegistry();
    tuning.setOverride('ai.expensiveCandidateLimit', 2);
    const result = evaluateSpatialCandidates(state, 'player-2', {}, createArenaDefinition(tuning), tuning);
    expect(result.candidates.length).toBeGreaterThan(2);
    expect(result.expensiveTests).toBe(2);
    expect(result.candidates.filter((candidate) => candidate.laneTested)).toHaveLength(2);
    expect(result.candidates.some((candidate) => candidate.rejectedReason === 'shortlisted-out')).toBe(true);
    expect(result.selected).toBeDefined();
  });

  it('retains a near-equal prior target but immediately drops it when it becomes illegal', () => {
    const request = getCandidatePreviewRequest(aiStableSupportScenario.id)!;
    const withoutPrior = evaluate(aiStableSupportScenario, { ...request.options, previousId: undefined });
    expect(withoutPrior.selected?.id).toBe('left');
    const retained = evaluate(aiStableSupportScenario);
    expect(retained.selected?.id).toBe('right');
    expect(retained.retained).toBe(true);
    expect(retained.previousId).toBe('right');
    const left = retained.candidates.find((candidate) => candidate.id === 'left')!;
    const right = retained.candidates.find((candidate) => candidate.id === 'right')!;
    expect(left.score).toBeGreaterThan(right.score);
    expect(left.score - right.score).toBeLessThan(createTuningRegistry().getNumber('ai.hysteresisMargin'));
    const invalidated = evaluate(aiStableSupportScenario, { ...request.options, candidates: [
      { id: 'left', position: { x: -3, y: 3 } }, { id: 'right', position: { x: 20, y: 3 } }
    ] });
    expect(invalidated.selected?.id).toBe('left');
    expect(invalidated.retained).toBe(false);
  });

  it('uses the central hysteresis margin to allow a sufficiently better alternative', () => {
    const state = aiStableSupportScenario.createInitialState();
    const request = getCandidatePreviewRequest(aiStableSupportScenario.id)!;
    const tuning = createTuningRegistry();
    tuning.setOverride('ai.hysteresisMargin', 0);
    const result = evaluateSpatialCandidates(state, request.playerId, request.options, createArenaDefinition(tuning), tuning);
    expect(result.selected?.id).toBe('left');
    expect(result.retained).toBe(false);
  });

  it('queries deeply frozen authoritative state and exposes detached player data', () => {
    const state = freezeDeep(aiOpenSupportScenario.createInitialState());
    const before = structuredClone(state);
    const tuning = createTuningRegistry();
    const arena = createArenaDefinition(tuning);
    const queries = createWorldQueries(state, arena, tuning);
    expect(queries.player('player-2')).not.toBe(state.players[1]);
    expect(queries.teamPlayers('human')).toHaveLength(5);
    expect(queries.ballPosition()).toEqual({ x: 0, y: -5 });
    expect(queries.goal('human').planeY).toBeGreaterThan(0);
    expect(queries.goal('human', true).planeY).toBeLessThan(0);
    expect(queries.reachSeconds('player-2', { x: -4, y: 3 })).toBe(
      estimateReachSeconds(state.players[1], { x: -4, y: 3 }, tuning, arena));
    queries.density({ x: 4, y: 3 }, 'human', 'player-2');
    queries.goalSide({ x: 0, y: -7 }, 'human');
    queries.lane({ x: 0, y: -5 }, { x: -4, y: 3 }, 'human', { sourcePlayerId: 'player-1' });
    expect(evaluate(aiOpenSupportScenario, undefined, state).selected?.id).toBe('open');
    expect(state).toEqual(before);
  });

  it('uses the shared trajectory and receive opportunities for an actually released ball', () => {
    const state = aiOpenSupportScenario.createInitialState();
    state.ball = createLooseBallState({ position: { x: 0, y: -4 }, velocity: { x: 0, y: 14 },
      release: { releasedById: 'player-1', reacquisitionLockoutTicksRemaining: 12 } });
    freezeDeep(state);
    const tuning = createTuningRegistry();
    const arena = createArenaDefinition(tuning);
    const queries = createWorldQueries(state, arena, tuning);
    const trajectory = queries.trajectory();
    expect(trajectory).toBeDefined();
    expect(trajectory!.samples.length).toBeGreaterThan(1);
    expect(queries.receivers()).toEqual(receiveOpportunities(state, tuning, arena));
    expect(queries.receivers().some((receiver) => receiver.playerId === 'player-2')).toBe(true);
    expect(queries.trajectory()).toEqual(trajectory);
  });

  it('distinguishes a blocked ground lane from a real lob trajectory clearing the same opponent', () => {
    const state = aiInvalidOptionsScenario.createInitialState();
    const tuning = createTuningRegistry();
    const queries = createWorldQueries(state, createArenaDefinition(tuning), tuning);
    const from = queries.ballPosition();
    const to = { x: 0, y: 4 };
    const low = queries.lane(from, to, 'human', { family: 'low', sourcePlayerId: 'player-1' });
    const high = queries.lane(from, to, 'human', { family: 'high', sourcePlayerId: 'player-1' });
    expect(low.reachesTarget).toBe(true);
    expect(low.clear).toBe(false);
    expect(low.contacts.map((contact) => contact.playerId)).toContain('opponent-1');
    expect(high.reachesTarget).toBe(true);
    expect(high.clear).toBe(true);
    expect(high.contacts).toHaveLength(0);
    expect(high.travelTimeSeconds).toBeGreaterThan(0);
  });

  it('publishes the same scores, rejection reasons and selection as the read-only evaluation', () => {
    const state = aiInvalidOptionsScenario.createInitialState();
    const request = getCandidatePreviewRequest(aiInvalidOptionsScenario.id)!;
    const tuning = createTuningRegistry();
    const diagnostics = createDiagnosticStore();
    diagnostics.setLayerEnabled('ai', true);
    diagnostics.setLayerEnabled('aiScores', true);
    diagnostics.beginTick(state.tick);
    const observed = evaluateSpatialCandidates(state, request.playerId, request.options, createArenaDefinition(tuning), tuning, diagnostics);
    diagnostics.endTick();
    expect(observed).toEqual(evaluate(aiInvalidOptionsScenario));
    const records = diagnostics.getFrame().records;
    expect(records.some((record) => record.layer === 'ai' && record.data)).toBe(true);
    expect(records.some((record) => record.layer === 'aiScores' && record.primitive.type === 'scalarGrid')).toBe(true);
    expect(JSON.stringify(records)).toContain('outside-bounds');
    expect(JSON.stringify(records)).toContain('blocked-lane');
    expect(JSON.stringify(records)).toContain('progression');
    expect(JSON.stringify(records)).toContain('selected');
  });

  it('executes every registered AI tuning boundary through finite, deterministic spatial evaluation', () => {
    const entries = createTuningRegistry().list().filter((entry) => entry.key.startsWith('ai.'));
    expect(entries.length).toBeGreaterThan(0);
    const state = freezeDeep(aiOpenSupportScenario.createInitialState());
    for (const entry of entries) {
      for (const value of [entry.min, entry.max]) {
        const tuning = createTuningRegistry();
        tuning.setOverride(entry.key, value);
        const arena = createArenaDefinition(tuning);
        const result = evaluateSpatialCandidates(state, 'player-2', {}, arena, tuning);
        expect(result, `${entry.key}=${value}`).toEqual(evaluateSpatialCandidates(state, 'player-2', {}, arena, tuning));
        expect(result.expensiveTests).toBeLessThanOrEqual(tuning.getNumber('ai.expensiveCandidateLimit'));
        for (const candidate of result.candidates.filter((item) => !item.rejectedReason)) {
          expect([candidate.position.x, candidate.position.y, candidate.score,
            ...Object.values(candidate.factors)].every(Number.isFinite), `${entry.key}=${value}`).toBe(true);
        }
      }
    }
  });

  it('runs the registered workbench fixtures without changing gameplay when preview diagnostics are disabled', () => {
    for (const definition of AI_CANDIDATE_SCENARIOS) {
      expect(DEFAULT_SCENARIOS).toContain(definition);
      const decisions: SpatialEvaluation[] = [];
      const enabled = runScenario({ definition, getArena: createArenaDefinition,
        step: previewStep(definition, decisions), ticks: 5 });
      const disabled = runScenario({ definition, getArena: createArenaDefinition,
        step: previewStep(definition, [], false), ticks: 5, diagnosticsEnabled: false });
      expect(enabled.state).toEqual(disabled.state);
      expect(decisions).toHaveLength(5);
      expect(decisions.every((decision) => decision.selected)).toBe(true);
      expect(enabled.diagnostics!.getFrame().records.some((record) => record.layer === 'ai')).toBe(true);
    }
  });

  it('preserves changing candidate decisions and gameplay across render schedules and replayed external intents', () => {
    const definition: CandidateScenario = { ...aiStableSupportScenario, scriptedInputs: Array.from({ length: 20 }, (_, index) => ({
      tick: index + 1, input: { playerId: 'player-2', intent: createNeutralPlayerIntent({ movement: { x: 0.2, y: 0 } }) }
    })) };
    const atRate = (fps: number) => {
      const decisions: SpatialEvaluation[] = [];
      const run = createScenarioRun({ definition, getArena: createArenaDefinition, step: previewStep(definition, decisions) });
      for (let frame = 0; frame < fps / 3; frame++) run.runtime.advance(1 / fps);
      return { state: run.state, decisions };
    };
    const slow = atRate(30);
    expect(slow).toEqual(atRate(120));
    expect(slow.decisions).toHaveLength(20);
    expect(new Set(slow.decisions.map((decision) => decision.candidates[0].score)).size).toBeGreaterThan(1);
    let recorder: ReplayRecorder<GameState, RoutedPlayerIntent>;
    const decisions: SpatialEvaluation[] = [];
    const run = createScenarioRun({ definition, getArena: createArenaDefinition, step: previewStep(definition, decisions),
      onStep: (state, tick, input) => recorder.recordStep(tick, input, state) });
    recorder = createReplayRecorder({ scenarioId: definition.id, initialState: run.state, tuning: run.tuning, checkpointIntervalTicks: 5 });
    run.runtime.pause();
    for (let tick = 0; tick < 20; tick++) run.runtime.stepOnce();
    const replayDecisions: SpatialEvaluation[] = [];
    const replayed = replayScenario({ scenario: definition, replay: recorder.finish(run.state), getArena: createArenaDefinition,
      step: previewStep(definition, replayDecisions) });
    expect(replayed.run.state).toEqual(run.state);
    expect(replayDecisions).toEqual(decisions);
    expect(replayed.run.state).toEqual(slow.state);
  });
});
