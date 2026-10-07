import { describe, expect, it } from 'vitest';
import { goalkeeperIntent } from '../ai/goalkeeperController';
import { createTuningRegistry, PLAYER_RADIUS_KEY } from '../config/tuning';
import type { SimulationInput } from '../control/types';
import { createArenaDefinition } from '../physics/arena';
import { stepControlledGame } from '../runtime/stepControlledGame';
import { DEFAULT_SCENARIOS } from '../scenarios/defaultScenarios';
import {
  GOALKEEPER_SCENARIOS,
  KEEPER_REDIRECTOR_ID,
  POSITIVE_KEEPER_ID,
  createKeeperShotState,
  keeperAggressiveLobScenario,
  keeperCommittedRedirectScenario,
  keeperCreaseMovementScenario,
  keeperEasyCatchScenario,
  keeperHardParryScenario,
  keeperHighControlScenario,
  keeperLowControlScenario,
  keeperLowCornerScenario,
  keeperMovementIntent
} from '../scenarios/goalkeeperScenario';
import { createReplayRecorder, replayScenario, type ReplayRecorder } from '../scenarios/replay';
import { createScenarioRun, runScenario, type ScenarioDefinition } from '../scenarios/scenario';
import { createFieldPlayerState, createPossessedBallState, type GameState } from './gameState';
import { getGoalkeeperSaveEnvelope, getPlayerMovementBounds, type GoalkeeperSaveObservation } from './goalkeeping';
import { stepGame } from './stepGame';

type KeeperScenario = ScenarioDefinition<GameState, SimulationInput>;
interface Interaction {
  readonly outcome: string;
  readonly playerId: string;
  readonly [key: string]: unknown;
}

function sample(definition: KeeperScenario, ticks = definition.automatedRunTicks, controlled = true) {
  const run = createScenarioRun({
    definition, step: controlled ? stepControlledGame : stepGame, getArena: createArenaDefinition
  });
  const interactions: Interaction[] = [];
  const states: GameState[] = [];
  const decisions: Readonly<Record<string, unknown>>[] = [];
  run.runtime.pause();
  for (let tick = 0; tick < ticks; tick++) {
    run.runtime.stepOnce();
    states.push(structuredClone(run.state));
    for (const record of run.diagnostics!.getFrame().records) {
      if (record.entityId === 'receive-interaction' && record.data) interactions.push(record.data as unknown as Interaction);
      if (record.entityId === `${POSITIVE_KEEPER_ID}-decision` && record.data) decisions.push(record.data);
    }
  }
  return { run, states, interactions, decisions };
}

function keeper(state: GameState) {
  return state.players.find((player) => player.definition.id === POSITIVE_KEEPER_ID)!;
}

function outcomeContext(result: ReturnType<typeof sample>): string {
  return JSON.stringify({ interactions: result.interactions,
    samples: result.states.filter((_, i) => [0, 5, 11, 17, 29].includes(i)).map((state) => ({
      tick: state.tick, keeper: keeper(state).position, action: keeper(state).goalkeeper, ball: state.ball
    })), decisions: result.decisions.slice(0, 3) });
}

describe('goalkeeper gameplay and controller scenarios', () => {
  it('keeps both roles within their legal creases while allowing lateral, outward and retreat movement', () => {
    const result = sample(keeperCreaseMovementScenario);
    const arena = createArenaDefinition(result.run.tuning);
    const radius = result.run.tuning.getNumber(PLAYER_RADIUS_KEY);
    for (const state of result.states) {
      for (const player of state.players) {
        const bounds = getPlayerMovementBounds(player, arena);
        expect(player.position.x).toBeGreaterThanOrEqual(bounds.minX + radius - 1e-8);
        expect(player.position.x).toBeLessThanOrEqual(bounds.maxX - radius + 1e-8);
        expect(player.position.y).toBeGreaterThanOrEqual(bounds.minY + radius - 1e-8);
        expect(player.position.y).toBeLessThanOrEqual(bounds.maxY - radius + 1e-8);
      }
    }
    expect(keeper(result.states[59]).position.x).toBeGreaterThan(3);
    expect(keeper(result.states[119]).position.y).toBeLessThan(12);
    expect(keeper(result.states[179]).position.y).toBeGreaterThan(14);
  });

  it('uses lower sustained speed and faster stopping/reversal than the field profile', () => {
    const physicsRun = (field: boolean, mode: 'accelerate' | 'stop' | 'reverse') => {
      const definition: KeeperScenario = {
        ...keeperCreaseMovementScenario,
        createInitialState: () => {
          const state = keeperCreaseMovementScenario.createInitialState();
          if (field) state.players[0] = createFieldPlayerState({ id: POSITIVE_KEEPER_ID, position: { x: 0, y: 13 } });
          if (mode !== 'accelerate') state.players[0].velocity = { x: 4, y: 0 };
          return state;
        },
        scriptedInputs: Array.from({ length: mode === 'accelerate' ? 20 : 1 }, (_, index) => ({
          tick: index + 1,
          input: keeperMovementIntent({ x: mode === 'stop' ? 0 : mode === 'reverse' ? -1 : 1, y: 0 })
        }))
      };
      return keeper(sample(definition, mode === 'accelerate' ? 20 : 1, false).run.state).velocity.x;
    };
    expect(physicsRun(false, 'accelerate')).toBeCloseTo(5);
    expect(physicsRun(true, 'accelerate')).toBeCloseTo(11);
    expect(physicsRun(false, 'stop')).toBeLessThan(physicsRun(true, 'stop'));
    expect(physicsRun(false, 'reverse')).toBeLessThan(physicsRun(true, 'reverse'));
  });

  it('catches an easy controlled save and parries a hard shot through normal ball transitions', () => {
    const easy = sample(keeperEasyCatchScenario, 5, false);
    const hard = sample(keeperHardParryScenario, 5, false);
    expect(easy.interactions.some((event) => event.outcome === 'keeper-catch')).toBe(true);
    expect(easy.run.state.ball).toEqual({ mode: 'possessed', holderId: POSITIVE_KEEPER_ID });
    expect(hard.interactions.some((event) => event.outcome === 'keeper-parry')).toBe(true);
    const save = hard.interactions.find((event) => event.outcome === 'keeper-parry') as unknown as GoalkeeperSaveObservation;
    expect(save.save.relativeSpeed).toBeGreaterThan(hard.run.tuning.getNumber('keeper.catchSpeed'));
    expect(save.save.difficulty).toBeGreaterThan(save.save.capacity);
    expect(save.save.reason).toBe('difficulty-exceeds-control');
    expect(hard.run.state.ball.mode).toBe('loose');
    if (hard.run.state.ball.mode === 'loose') expect(hard.run.state.ball.velocity.y).toBeLessThan(0);
  });

  it('uses Control for difficult catches while preserving the same reach and contact geometry', () => {
    const low = sample(keeperLowControlScenario, 2, false);
    const high = sample(keeperHighControlScenario, 2, false);
    expect(low.interactions[0].outcome).toBe('keeper-parry');
    expect(high.interactions[0].outcome).toBe('keeper-catch');
    const lowSave = low.interactions[0] as unknown as GoalkeeperSaveObservation;
    const highSave = high.interactions[0] as unknown as GoalkeeperSaveObservation;
    expect(lowSave.save.difficulty).toBeCloseTo(highSave.save.difficulty);
    expect(lowSave.save.capacity).toBeLessThan(highSave.save.capacity);
    expect(getGoalkeeperSaveEnvelope(keeper(low.run.state), low.run.tuning)).toEqual(
      getGoalkeeperSaveEnvelope(keeper(high.run.state), high.run.tuning));
  });

  it('defends a released low-corner threat using visible trajectory diagnostics', () => {
    const result = sample(keeperLowCornerScenario);
    expect(result.decisions.some((decision) => (decision.threat as { crossing?: unknown })?.crossing)).toBe(true);
    expect(result.decisions.every((decision) => decision.target && decision.intent && decision.reason)).toBe(true);
    expect(result.interactions.some((event) => event.outcome === 'keeper-catch' || event.outcome === 'keeper-parry'), outcomeContext(result)).toBe(true);
    expect(result.run.state.match!.score.human).toBe(0);
  });

  it('allows a lob to clear an advanced keeper and score below the crossbar', () => {
    const result = sample(keeperAggressiveLobScenario);
    expect(result.run.state.match!.score.human, outcomeContext(result)).toBe(1);
    expect(result.run.state.match!.lastGoal!.crossing.height).toBeGreaterThan(0);
    expect(result.run.state.match!.lastGoal!.crossing.height + result.run.tuning.getNumber('ball.radius') * 2)
      .toBeLessThanOrEqual(result.run.tuning.getNumber('arena.crossbarHeight'));
    expect(result.interactions.some((event) => event.playerId === POSITIVE_KEEPER_ID)).toBe(false);
  });

  it('makes a committed save explicitly recover and exposes vulnerability to a following redirect', () => {
    const result = sample(keeperCommittedRedirectScenario);
    expect(result.states.some((state) => keeper(state).goalkeeper!.commitTicksRemaining > 0)).toBe(true);
    expect(result.interactions.some((event) => event.outcome === 'keeper-parry')).toBe(true);
    expect(result.interactions.some((event) => event.outcome === 'one-touch' && event.playerId === KEEPER_REDIRECTOR_ID), outcomeContext(result)).toBe(true);
    const recovering = result.states.find((state) => keeper(state).goalkeeper!.recoveryTicksRemaining > 0)!;
    expect(recovering).toBeDefined();
    const envelope = getGoalkeeperSaveEnvelope(keeper(recovering), result.run.tuning);
    expect(envelope.recovering).toBe(true);
    expect(envelope.radius).toBeLessThan(result.run.tuning.getNumber('keeper.ordinaryReach'));
    const vulnerability = result.states.find((state) => {
      if (state.ball.mode !== 'loose' || state.ball.release?.releasedById !== KEEPER_REDIRECTOR_ID ||
          !keeper(state).goalkeeper!.recoveryTicksRemaining) return false;
      const distance = Math.hypot(state.ball.position.x - keeper(state).position.x,
        state.ball.position.y - keeper(state).position.y);
      const ballRadius = result.run.tuning.getNumber('ball.radius');
      return distance < result.run.tuning.getNumber('keeper.ordinaryReach') + ballRadius &&
        distance > getGoalkeeperSaveEnvelope(keeper(state), result.run.tuning).radius + ballRadius;
    });
    expect(vulnerability, 'Return enters ordinary reach while outside the recovering envelope.').toBeDefined();
    expect(result.run.state.match!.score.human, outcomeContext(result)).toBe(1);
  });

  it('does not react to unreleased throw charge and does not mutate state while deciding', () => {
    const state = createKeeperShotState();
    state.players.push(createFieldPlayerState({ id: 'carrier', position: { x: 2, y: 6 } }));
    state.ball = createPossessedBallState('carrier');
    const tuning = createTuningRegistry();
    const arena = createArenaDefinition(tuning);
    const before = structuredClone(state);
    const uncharged = goalkeeperIntent(state, keeper(state), tuning, arena);
    expect(state).toEqual(before);
    state.players[2].throwCharge = { family: 'high', elapsedSeconds: 0.5, strength: 1, progress: 1 };
    expect(goalkeeperIntent(state, keeper(state), tuning, arena)).toEqual(uncharged);
  });

  it('does not promise an extended save using uncommitted movement speed', () => {
    const state = createKeeperShotState({ ballX: 2.6, ballY: 8, speed: 28 });
    const tuning = createTuningRegistry();
    const before = structuredClone(state);
    const decision = goalkeeperIntent(state, keeper(state), tuning, createArenaDefinition(tuning));
    expect(decision.intent.save?.pressed).toBe(false);
    expect(state).toEqual(before);
  });

  it('gives identical physical/save results to supplied and controller-generated identical intents', () => {
    const state = createKeeperShotState();
    const direct = structuredClone(state);
    const tuning = createTuningRegistry();
    const arena = createArenaDefinition(tuning);
    const intents = state.players.map((player) => goalkeeperIntent(state, player, tuning, arena));
    stepControlledGame(state, 1 / 60, { tuning, arena });
    stepGame(direct, 1 / 60, { tuning, arena }, intents);
    expect(direct).toEqual(state);
  });

  it('registers shared scenarios and preserves results with diagnostics disabled', () => {
    for (const definition of GOALKEEPER_SCENARIOS) {
      expect(DEFAULT_SCENARIOS).toContain(definition);
      const enabled = sample(definition);
      const disabled = runScenario({
        definition, step: stepControlledGame, getArena: createArenaDefinition,
        diagnosticsEnabled: false, ticks: definition.automatedRunTicks
      });
      expect(enabled.run.state).toEqual(disabled.state);
    }
  });

  it('replays controller decisions deterministically and ignores render frequency', () => {
    const definition: KeeperScenario = keeperLowCornerScenario;
    const atRate = (fps: number) => {
      const run = createScenarioRun({ definition, step: stepControlledGame, getArena: createArenaDefinition });
      for (let frame = 0; frame < fps; frame++) run.runtime.advance(1 / fps);
      return run.state;
    };
    expect(atRate(30)).toEqual(atRate(120));
    let recorder: ReplayRecorder<GameState, SimulationInput>;
    const run = createScenarioRun({
      definition, step: stepControlledGame, getArena: createArenaDefinition,
      onStep: (state, tick, input) => recorder.recordStep(tick, input, state)
    });
    recorder = createReplayRecorder({
      scenarioId: definition.id, initialState: run.state, tuning: run.tuning, checkpointIntervalTicks: 10
    });
    run.runtime.pause();
    for (let tick = 0; tick < 60; tick++) run.runtime.stepOnce();
    expect(replayScenario({
      scenario: definition, step: stepControlledGame, getArena: createArenaDefinition,
      replay: recorder.finish(run.state)
    }).run.state).toEqual(run.state);
  });
});
