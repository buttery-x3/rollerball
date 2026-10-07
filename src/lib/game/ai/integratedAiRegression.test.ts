import { describe, expect, it } from 'vitest';
import { createTuningRegistry } from '../config/tuning';
import type { RoutedPlayerIntent } from '../control/types';
import { createDiagnosticStore } from '../debug/diagnosticStore';
import { createArenaDefinition } from '../physics/arena';
import { stepControlledGame } from '../runtime/stepControlledGame';
import { aiPossessionExchangeScenario } from '../scenarios/aiActionsScenario';
import { friendlyKeeperObstructionScenario, keeperUnreachableCrossingScenario,
  pressureCheckFromRestScenario } from '../scenarios/integratedAiScenario';
import { createScenarioRun } from '../scenarios/scenario';
import { createReplayRecorder, replayScenario, type ReplayRecorder } from '../scenarios/replay';
import type { CheckImpact } from '../sim/checking';
import type { GameState } from '../sim/gameState';
import { planActions, type ActionCandidate } from './actionPlanner';
import { goalkeeperIntent } from './goalkeeperController';
import { createWorldQueries } from './worldQueries';

describe('integrated AI physical regressions', () => {
  it('rejects a pass whose shared swept path hits the friendly keeper before its intended receiver', () => {
    const state = friendlyKeeperObstructionScenario.createInitialState(), tuning = createTuningRegistry(), arena = createArenaDefinition(tuning);
    const before = structuredClone(state);
    const opportunity = createWorldQueries(state, arena, tuning)
      .throwOpportunity('thrower', { x: -3, y: -13 }, 'low', 1, 'receiver');
    expect(opportunity.friendlyKeeperContact?.playerId).toBe('keeper');
    expect(opportunity.friendlyKeeperContact!.timeSeconds).toBeLessThan(opportunity.receiver!.timeSeconds);
    const diagnostics = createDiagnosticStore();
    diagnostics.setLayerEnabled('ai', true);
    diagnostics.beginTick(1);
    planActions(state, tuning, arena, [], diagnostics);
    diagnostics.endTick();
    const candidates = diagnostics.getFrame().records.find(record => record.entityId === 'thrower-action-candidates')!
      .data!.candidates as readonly ActionCandidate[];
    expect(candidates.filter(candidate => candidate.receiverId === 'receiver' && candidate.kind === 'pass-low')
      .every(candidate => candidate.rejectedReason === 'friendly-keeper-before-target')).toBe(true);
    expect(state).toEqual(before);

    // Independently force the very same ordinary throw to confirm that the
    // rejected obstruction is a real gameplay contact, not a tactical guess.
    const definition = friendlyKeeperObstructionScenario;
    const run = createScenarioRun({ definition, step: stepControlledGame, getArena: createArenaDefinition });
    const interactions: { playerId: string; outcome: string }[] = [];
    run.runtime.pause();
    for (let tick = 0; tick < definition.automatedRunTicks; tick++) {
      run.runtime.stepOnce();
      for (const record of run.diagnostics!.getFrame().records) if (record.entityId === 'receive-interaction') {
        interactions.push(record.data as unknown as { playerId: string; outcome: string });
      }
    }
    expect(interactions[0]?.playerId).toBe('keeper');
    expect(interactions[0]?.outcome).toMatch(/^keeper-/);
  });

  it('builds a check from rest through normal movement and keeps speed until actual contact', () => {
    const definition = pressureCheckFromRestScenario;
    const run = createScenarioRun({ definition, step: stepControlledGame, getArena: createArenaDefinition });
    const impacts: CheckImpact[] = [];
    run.runtime.pause();
    for (let tick = 0; tick < definition.automatedRunTicks; tick++) {
      run.runtime.stepOnce();
      for (const record of run.diagnostics!.getFrame().records) if (record.entityId === 'checking-state') {
        impacts.push(...record.data!.impacts as CheckImpact[]);
      }
    }
    const impact = impacts.find(item => item.checkerId === 'opponent-1' && item.targetId === 'player-1');
    expect(impact?.outcome).toBe('turnover');
    expect(impact!.closingSpeed).toBeGreaterThanOrEqual(impact!.retentionThreshold);
  });

  it('covers the predicted goal crossing when a released shot is beyond both save envelopes', () => {
    const definition = keeperUnreachableCrossingScenario;
    const run = createScenarioRun({ definition, step: stepControlledGame, getArena: createArenaDefinition });
    const keeper = run.state.players[0];
    const diagnostics = createDiagnosticStore(); diagnostics.setLayerEnabled('keeper', true);
    const before = structuredClone(run.state);
    diagnostics.beginTick(1);
    const intent = goalkeeperIntent(run.state, keeper, run.tuning, createArenaDefinition(run.tuning), diagnostics);
    diagnostics.endTick();
    const decision = diagnostics.getFrame().records.find(record => record.entityId === 'keeper-decision')!.data!;
    expect(decision.reason).toBe('cover-goal-crossing');
    expect(intent.intent.movement.x).toBeGreaterThan(0);
    expect(intent.intent.movement.y).toBeCloseTo(0, 12);
    expect(intent.intent.save?.pressed).toBe(false);
    expect(run.state).toEqual(before);
    run.runtime.pause();
    for (let tick = 0; tick < 5; tick++) run.runtime.stepOnce();
    expect(run.state.players[0].velocity.x).toBeGreaterThan(0);
    expect(run.state.players[0].position.y).toBeCloseTo(-14.4, 12);
  });

  it('sustains an exchange without rapid pass or covered-shot loops and replays with diagnostics disabled', () => {
    const definition = aiPossessionExchangeScenario;
    let recorder: ReplayRecorder<GameState, RoutedPlayerIntent>;
    const run = createScenarioRun({ definition, step: stepControlledGame, getArena: createArenaDefinition,
      onStep: (state, tick, input) => recorder.recordStep(tick, input, state) });
    recorder = createReplayRecorder({ scenarioId: definition.id, initialState: run.state,
      tuning: run.tuning, checkpointIntervalTicks: 120 });
    let releases = 0, shots = 0;
    run.runtime.pause();
    for (let tick = 0; tick < definition.automatedRunTicks; tick++) {
      run.runtime.stepOnce();
      const records = run.diagnostics!.getFrame().records;
      for (const record of records.filter(item => item.entityId === 'throw-release')) {
        releases++;
        const action = records.find(item => item.source === 'actionController' && item.data?.playerId === record.data?.playerId);
        if (typeof action?.data?.kind === 'string' && action.data.kind.startsWith('shot-')) shots++;
      }
    }
    // The integrated failures produced over 140 rapid passes or around 40
    // repeated covered shots in one episode. Leave room for ordinary play.
    expect(releases).toBeGreaterThan(3);
    expect(releases).toBeLessThan(60);
    expect(shots).toBeGreaterThan(0);
    expect(shots).toBeLessThan(10);
    const replay = recorder.finish(run.state);
    const playback = replayScenario({ scenario: definition, replay, step: stepControlledGame,
      getArena: createArenaDefinition, diagnosticsEnabled: false });
    expect(playback.finalStateHash).toBe(replay.finalStateHash);
    expect(playback.run.state).toEqual(run.state);
  }, 15000);
});
