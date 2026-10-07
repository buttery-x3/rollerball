import { describe, expect, it } from 'vitest';
import { createTuningRegistry, PLAYER_RADIUS_KEY } from '../config/tuning';
import { createNeutralPlayerIntent } from '../control/intent';
import type { RoutedPlayerIntent } from '../control/types';
import { createArenaDefinition } from '../physics/arena';
import { createBallThrowLaunch } from '../physics/ballTrajectory';
import { createPlayerTuning } from '../config/playerAttributes';
import { stepControlledGame } from '../runtime/stepControlledGame';
import {
  AI_ACTION_SCENARIOS, aiAdvanceScenario, aiDefensiveCheckScenario, aiHighOneTouchScenario, aiKeeperDistributionScenario,
  aiKeeperRecoveryScenario, aiLobPassScenario, aiLowOneTouchScenario, aiLowPassScenario,
  aiOrdinaryReceiveScenario, aiPossessionExchangeScenario, aiShotChoiceScenario
} from '../scenarios/aiActionsScenario';
import { DEFAULT_SCENARIOS } from '../scenarios/defaultScenarios';
import { createReplayRecorder, replayScenario, type ReplayRecorder } from '../scenarios/replay';
import { createScenarioRun, type ScenarioDefinition, type ScenarioStep } from '../scenarios/scenario';
import type { AiActionDecision } from '../sim/actionState';
import type { CheckImpact } from '../sim/checking';
import type { DiagnosticRecord } from '../sim/diagnostics';
import { createFieldPlayerState, type GameState } from '../sim/gameState';
import { getPlayerMovementBounds } from '../sim/goalkeeping';
import type { ReceiveInteractionObservation } from '../sim/receiving';
import type { ThrowReleaseObservation } from '../sim/throwing';
import { actionPlayerIntent, planActions, type ActionCandidate } from './actionPlanner';

type ActionScenario = ScenarioDefinition<GameState, RoutedPlayerIntent>;

function sample(definition: ActionScenario, ticks = definition.automatedRunTicks,
  diagnosticsEnabled = true, step: ScenarioStep<GameState, RoutedPlayerIntent> = stepControlledGame) {
  const run = createScenarioRun({ definition, step, getArena: createArenaDefinition, diagnosticsEnabled });
  const states: GameState[] = [];
  const releases: (ThrowReleaseObservation & { tick: number })[] = [];
  const interactions: (ReceiveInteractionObservation & { tick: number })[] = [];
  const impacts: CheckImpact[] = [];
  const records: DiagnosticRecord[] = [];
  run.runtime.pause();
  for (let tick = 0; tick < ticks; tick++) {
    run.runtime.stepOnce();
    states.push(structuredClone(run.state));
    for (const record of run.diagnostics?.getFrame().records ?? []) {
      if (record.entityId === 'throw-release' && record.data) releases.push({
        ...record.data as unknown as ThrowReleaseObservation, tick: run.state.tick
      });
      if (record.entityId === 'receive-interaction' && record.data) interactions.push({
        ...record.data as unknown as ReceiveInteractionObservation, tick: run.state.tick
      });
      if (record.entityId === 'checking-state' && record.data) impacts.push(...record.data.impacts as CheckImpact[]);
      if (record.source === 'actionPlanner' || record.source === 'actionCandidates' || record.source === 'actionController') records.push(record);
    }
  }
  return { run, states, releases, interactions, impacts, records };
}

function decisions(result: ReturnType<typeof sample>, playerId: string): AiActionDecision[] {
  return result.states.flatMap((state) => state.aiActions?.decisions.filter((decision) => decision.playerId === playerId) ?? []);
}

function context(result: ReturnType<typeof sample>): string {
  const candidates = result.records.find((record) => record.entityId === 'player-2-action-candidates')?.data?.candidates as readonly ActionCandidate[] | undefined;
  return JSON.stringify({ releases: result.releases.slice(0, 5),
    interactions: result.interactions.slice(0, 5), impacts: result.impacts.slice(0, 3),
    receiverOptions: candidates?.map((candidate) => ({ id: candidate.id, score: candidate.score, rejected: candidate.rejectedReason })),
    actions: result.states.filter((_, index) => index % 12 === 0).slice(0, 8).map((state) => ({
      tick: state.tick, ball: state.ball.mode === 'loose' ? { position: state.ball.position, height: state.ball.height } : state.ball.holderId,
      players: state.players.filter((player) => ['player-1', 'player-2'].includes(player.definition.id)).map((player) => ({ id: player.definition.id, position: player.position })),
      actions: state.aiActions?.decisions.filter((decision) => ['player-1', 'player-2'].includes(decision.playerId))
        .map((decision) => ({ player: decision.playerId, kind: decision.kind, target: decision.target }))
    })) });
}

function freezeDeep<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freezeDeep);
    Object.freeze(value);
  }
  return value;
}

describe('possession-aware AI actions through normal simulation', () => {
  it('advances the carrier through ordinary inertial movement when throwing offers no useful progress', () => {
    const result = sample(aiAdvanceScenario, 5);
    expect(decisions(result, 'player-1').every((decision) => decision.kind === 'advance'), context(result)).toBe(true);
    expect(result.run.state.ball).toEqual({ mode: 'possessed', holderId: 'player-1' });
    const initial = aiAdvanceScenario.createInitialState().players[0];
    const carrier = result.run.state.players[0];
    expect(carrier.position.y).toBeGreaterThan(initial.position.y);
    expect(carrier.velocity.y).toBeGreaterThan(0);
    expect(carrier.position.y - initial.position.y).toBeLessThan(0.5);
    expect(result.releases).toHaveLength(0);
  });

  it('chooses an obvious low pass, releases physically and gives the teammate real possession', () => {
    const result = sample(aiLowPassScenario, 90);
    expect(decisions(result, 'player-1').some((decision) => decision.kind === 'pass-low' && decision.receiverId === 'player-2'), context(result)).toBe(true);
    const release = result.releases.find((entry) => entry.playerId === 'player-1')!;
    expect(release, context(result)).toBeDefined();
    expect(release.family).toBe('low');
    expect(release.verticalVelocity).toBe(0);
    expect(result.interactions.some((entry) => entry.playerId === 'player-2' && entry.outcome === 'possession'), context(result)).toBe(true);
    const attributes = aiLowPassScenario.createInitialState().players[0].definition.attributes;
    const launch = createBallThrowLaunch('low', release.direction, release.strength,
      createPlayerTuning(attributes, result.run.tuning));
    expect(release.velocity.x).toBeCloseTo(launch.velocity.x, 12);
    expect(release.velocity.y).toBeCloseTo(launch.velocity.y, 12);
  });

  it('lobs over an obstructed low lane and completes a real teammate reception', () => {
    const result = sample(aiLobPassScenario, 150);
    expect(decisions(result, 'player-1').some((decision) => decision.kind === 'pass-high' && decision.receiverId === 'player-2'), context(result)).toBe(true);
    const release = result.releases.find((entry) => entry.playerId === 'player-1')!;
    expect(release?.family, context(result)).toBe('high');
    expect(release.verticalVelocity).toBeGreaterThan(0);
    expect(result.states.some((state) => state.ball.mode === 'loose' && state.ball.height > 2)).toBe(true);
    expect(result.interactions.some((entry) => entry.playerId === 'player-2' && entry.outcome === 'possession'), context(result)).toBe(true);
  });

  it('prefers an open goal over a supporting pass and scores through the goal aperture', () => {
    const result = sample(aiShotChoiceScenario, 90);
    expect(decisions(result, 'player-1').some((decision) => decision.kind.startsWith('shot-')), context(result)).toBe(true);
    expect(result.releases.some((entry) => entry.playerId === 'player-1'), context(result)).toBe(true);
    expect(result.states.some((state) => (state.match?.score.human ?? 0) > 0), context(result)).toBe(true);
    const goal = result.states.find((state) => state.match?.lastGoal)?.match?.lastGoal;
    expect(goal?.crossing.crossed).toBe(true);
    expect(goal?.crossing.verticalFit).toBe(true);
    expect(goal?.crossing.horizontalFit).toBe(true);
  });

  it('chooses an ordinary catch when an immediate redirect has no useful attacking continuation', () => {
    const result = sample(aiOrdinaryReceiveScenario, 30);
    expect(decisions(result, 'player-2').some((decision) => decision.kind === 'receive'), context(result)).toBe(true);
    const interaction = result.interactions.find((entry) => entry.playerId === 'player-2');
    expect(interaction?.outcome, context(result)).toBe('possession');
    expect(result.states.some((state) => state.ball.mode === 'possessed' && state.ball.holderId === 'player-2')).toBe(true);
  });

  for (const [family, definition] of [['low', aiLowOneTouchScenario], ['high', aiHighOneTouchScenario]] as const) {
    it(`executes a cross-goal ${family} one-touch through the shared receive mechanic`, () => {
      const result = sample(definition, 90);
      expect(decisions(result, 'player-2').some((decision) => decision.kind === `one-touch-${family}`), context(result)).toBe(true);
      const redirect = result.interactions.find((entry) => entry.playerId === 'player-2' && entry.outcome === 'one-touch');
      expect(redirect?.outcome, context(result)).toBe('one-touch');
      if (!redirect || redirect.outcome !== 'one-touch') throw new Error('Expected a real one-touch interaction.');
      expect(redirect.family).toBe(family);
      expect(redirect.source).toBe(`${family}-button`);
      expect(redirect.verticalVelocity > 0).toBe(family === 'high');
      if (family === 'high') {
        expect(result.interactions.some((entry) => entry.tick > redirect.tick && entry.playerId === 'player-1' && entry.outcome === 'possession'), context(result)).toBe(true);
      } else {
        expect(result.states.some((state) => (state.match?.score.human ?? 0) > 0) ||
          result.interactions.some((entry) => entry.playerId === 'opponent-keeper' && entry.outcome.startsWith('keeper-')), context(result)).toBe(true);
      }
    });
  }

  it('rejects a physically difficult redirect for low Control while high Control can execute it', () => {
    const withControl = (control: number): ActionScenario => ({ ...aiLowOneTouchScenario,
      createInitialState() {
        const state = aiLowOneTouchScenario.createInitialState();
        state.players = state.players.map((player) => player.definition.id === 'player-2' ? createFieldPlayerState({
          id: player.definition.id, teamId: player.definition.teamId, position: player.position,
          facing: { x: 1.6875 / Math.hypot(1.6875, 5), y: 5 / Math.hypot(1.6875, 5) }, attributes: { control }
        }) : player);
        if (state.ball.mode === 'loose') state.ball.velocity = { x: 30, y: 0 };
        return state;
      } });
    const strong = sample(withControl(100), 20);
    const weak = sample(withControl(0), 20);
    expect(strong.interactions.some((entry) => entry.playerId === 'player-2' && entry.outcome === 'one-touch'), context(strong)).toBe(true);
    expect(weak.interactions.some((entry) => entry.playerId === 'player-2' && entry.outcome === 'one-touch')).toBe(false);
    expect(decisions(weak, 'player-2').some((decision) => decision.kind.startsWith('one-touch'))).toBe(false);
  });

  it('pressures with an ordinary check intent and resolves a real impact and turnover', () => {
    const result = sample(aiDefensiveCheckScenario, 30);
    expect(decisions(result, 'opponent-1').some((decision) => decision.kind === 'check'), context(result)).toBe(true);
    expect(result.states.some((state) => state.players.find((player) => player.definition.id === 'opponent-1')!.contact.checkTicksRemaining > 0)).toBe(true);
    expect(result.impacts.some((impact) => impact.checkerId === 'opponent-1' && impact.targetId === 'player-1' && impact.outcome === 'turnover'), context(result)).toBe(true);
    expect(result.states.some((state) => state.ball.mode === 'loose')).toBe(true);
    expect(result.states.some((state) => state.players.find((player) => player.definition.id === 'player-1')!.contact.stumbleTicksRemaining > 0)).toBe(true);
  });

  it('preserves specialised keeper recovery and legal lateral movement during a cross-goal continuation', () => {
    const result = sample(aiKeeperRecoveryScenario, 60);
    const keeperStates = result.states.map((state) => state.players.find((player) => player.definition.id === 'opponent-keeper')!);
    expect(keeperStates[0].goalkeeper!.recoveryTicksRemaining).toBe(17);
    expect(keeperStates.some((player) => player.goalkeeper!.recoveryTicksRemaining === 0)).toBe(true);
    const initialX = aiKeeperRecoveryScenario.createInitialState().players.find((player) => player.definition.id === 'opponent-keeper')!.position.x;
    expect(keeperStates.some((player) => player.position.x > initialX && player.velocity.x > 0)).toBe(true);
    const recoveryLimit = result.run.tuning.getNumber('keeper.maxSpeed') * result.run.tuning.getNumber('keeper.recoveryMovementScale');
    for (const keeper of keeperStates.filter((player) => player.goalkeeper!.recoveryTicksRemaining > 0)) {
      expect(Math.hypot(keeper.velocity.x, keeper.velocity.y)).toBeLessThanOrEqual(recoveryLimit + 1e-8);
    }
    const arena = createArenaDefinition(result.run.tuning);
    const radius = result.run.tuning.getNumber(PLAYER_RADIUS_KEY);
    for (const keeper of keeperStates) {
      const bounds = getPlayerMovementBounds(keeper, arena);
      expect(keeper.position.x).toBeGreaterThanOrEqual(bounds.minX + radius - 1e-8);
      expect(keeper.position.x).toBeLessThanOrEqual(bounds.maxX - radius + 1e-8);
      expect(keeper.position.y).toBeGreaterThanOrEqual(bounds.minY + radius - 1e-8);
      expect(keeper.position.y).toBeLessThanOrEqual(bounds.maxY - radius + 1e-8);
    }
    expect(result.interactions.some((entry) => entry.playerId === 'player-2' && entry.outcome === 'one-touch'), context(result)).toBe(true);
  });

  it('distributes keeper possession through an actual throw to a field receiver', () => {
    const result = sample(aiKeeperDistributionScenario, 120);
    expect(decisions(result, 'human-keeper').some((decision) => decision.kind.startsWith('pass-')), context(result)).toBe(true);
    expect(result.releases.some((entry) => entry.playerId === 'human-keeper'), context(result)).toBe(true);
    expect(result.interactions.some((entry) => entry.outcome === 'possession' && entry.playerId.startsWith('player-')), context(result)).toBe(true);
    expect(result.states.some((state) => state.ball.mode === 'possessed' && state.ball.holderId.startsWith('player-'))).toBe(true);
  });

  it('sustains unrestricted 5v5 movement with real possession changes between both teams', () => {
    const result = sample(aiPossessionExchangeScenario, aiPossessionExchangeScenario.automatedRunTicks, true);
    const holders = result.states.flatMap((state) => state.ball.mode === 'possessed' ? [state.ball.holderId] : []);
    expect(new Set(holders).size, context(result)).toBeGreaterThanOrEqual(3);
    expect(holders.some((id) => id.startsWith('player-') || id === 'human-keeper'), context(result)).toBe(true);
    expect(holders.some((id) => id.startsWith('opponent-')), context(result)).toBe(true);
    expect(result.releases.length, context(result)).toBeGreaterThanOrEqual(3);
    expect(result.interactions.filter((entry) => entry.outcome === 'possession' || entry.outcome === 'one-touch').length).toBeGreaterThanOrEqual(3);
    expect(result.run.state.players.map((player) => player.definition)).toEqual(aiPossessionExchangeScenario.createInitialState().players.map((player) => player.definition));
  }, 15000);

  it('keeps action planning below physics frequency before an actual possession event', () => {
    const result = sample(aiOrdinaryReceiveScenario, 6);
    const receiver = decisions(result, 'player-2');
    expect(receiver).toHaveLength(6);
    expect(new Set(receiver.map((decision) => decision.plannedTick)).size).toBe(1);
    expect(new Set(receiver.map((decision) => decision.candidateId)).size).toBe(1);
    expect(receiver[0].nextThinkTick - receiver[0].plannedTick).toBe(result.run.tuning.getNumber('ai.actionThinkTicks'));
  });

  it('plans and generates action intents without mutating authoritative simulation state', () => {
    const state = freezeDeep(aiLowPassScenario.createInitialState());
    const before = structuredClone(state);
    const tuning = createTuningRegistry();
    const arena = createArenaDefinition(tuning);
    const plan = planActions(state, tuning, arena, [])!;
    expect(state).toEqual(before);
    const planned = freezeDeep({ ...state, aiActions: plan });
    const intent = actionPlayerIntent(planned, 'player-1', createNeutralPlayerIntent(), tuning, arena);
    expect(intent).toBeDefined();
    expect(state).toEqual(before);
    expect(planned.aiActions).toEqual(plan);
  });

  it('respects external human ownership without issuing an AI throw for the controlled carrier', () => {
    const result = sample(aiLowPassScenario, 12, true, (state, seconds, simulationContext) => {
      stepControlledGame(state, seconds, simulationContext, { playerId: 'player-1', intent: createNeutralPlayerIntent() });
    });
    expect(result.releases.some((release) => release.playerId === 'player-1')).toBe(false);
    expect(decisions(result, 'player-1')).toHaveLength(0);
    expect(result.run.state.ball).toEqual({ mode: 'possessed', holderId: 'player-1' });
  });

  it('registers reusable scenarios and records candidate factors, final choices and intents without changing outcomes', () => {
    for (const definition of AI_ACTION_SCENARIOS) expect(DEFAULT_SCENARIOS).toContain(definition);
    const enabled = sample(aiLowPassScenario, 30);
    const disabled = sample(aiLowPassScenario, 30, false);
    expect(enabled.run.state).toEqual(disabled.run.state);
    expect(enabled.records.length).toBeGreaterThan(0);
    const records = JSON.stringify(enabled.records);
    expect(records.includes('candidates')).toBe(true);
    expect(records.includes('factors')).toBe(true);
    expect(records.includes('intent')).toBe(true);
    expect(records.includes('pass-low')).toBe(true);
  });

  it('preserves action memory, releases and physics across render rates and deterministic replay', () => {
    const definition = aiLowPassScenario;
    const atRate = (fps: number) => {
      const run = createScenarioRun({ definition, step: stepControlledGame, getArena: createArenaDefinition });
      for (let frame = 0; frame < fps; frame++) run.runtime.advance(1 / fps);
      return run.state;
    };
    const slow = atRate(30);
    expect(slow).toEqual(atRate(120));
    expect(slow.players[1].position).not.toEqual(definition.createInitialState().players[1].position);
    let recorder: ReplayRecorder<GameState, RoutedPlayerIntent>;
    const run = createScenarioRun({ definition, step: stepControlledGame, getArena: createArenaDefinition,
      onStep: (state, tick, input) => recorder.recordStep(tick, input, state) });
    recorder = createReplayRecorder({ scenarioId: definition.id, initialState: run.state,
      tuning: run.tuning, checkpointIntervalTicks: 10 });
    run.runtime.pause();
    for (let tick = 0; tick < 60; tick++) run.runtime.stepOnce();
    const replayed = replayScenario({ scenario: definition, replay: recorder.finish(run.state),
      step: stepControlledGame, getArena: createArenaDefinition });
    expect(replayed.run.state).toEqual(run.state);
    expect(replayed.run.state).toEqual(slow);
  });
});
