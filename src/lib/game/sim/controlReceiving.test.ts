import { describe, expect, it } from 'vitest';
import { createControlRouter } from '../control/controlRouter';
import type { RoutedPlayerIntent } from '../control/types';
import { createPlayerTuning } from '../config/playerAttributes';
import { createTuningRegistry } from '../config/tuning';
import { createArenaDefinition } from '../physics/arena';
import { createBallThrowLaunch } from '../physics/ballTrajectory';
import { DEFAULT_SCENARIOS } from '../scenarios/defaultScenarios';
import {
  CONTROL_RECEIVER_ID,
  CONTROL_RECEIVING_SCENARIOS,
  createControlReceiveScenario,
  createControlRetentionScenario
} from '../scenarios/controlReceivingScenario';
import {
  createReplayRecorder,
  replayScenario,
  stableStateHash,
  type ReplayRecorder
} from '../scenarios/replay';
import { createScenarioRun, runScenario, type ScenarioDefinition } from '../scenarios/scenario';
import type { CheckImpact } from './checking';
import type { GameState } from './gameState';
import type { ReceiveInteractionObservation } from './receiving';
import { stepGame } from './stepGame';

type ControlScenario = ScenarioDefinition<GameState, RoutedPlayerIntent>;

function sample(definition: ControlScenario, diagnosticsEnabled = true) {
  return runScenario({
    definition, step: stepGame, getArena: createArenaDefinition,
    ticks: definition.automatedRunTicks, diagnosticsEnabled
  });
}

function interaction(run: ReturnType<typeof sample>) {
  return run.diagnostics?.getFrame().records.find((record) =>
    record.entityId === 'receive-interaction')?.data as unknown as ReceiveInteractionObservation;
}

function impact(run: ReturnType<typeof sample>) {
  const record = run.diagnostics?.getFrame().records.find((item) => item.entityId === 'checking-state');
  return (record?.data?.impacts as readonly CheckImpact[])[0];
}

describe('Control receiving, redirects and retention', () => {
  it('keeps easy uncontested pickups dependable throughout the attribute scale', () => {
    for (const control of [0, 25, 50, 75, 100]) {
      const result = sample(createControlReceiveScenario({ control, easy: true }));
      expect(result.state.ball).toEqual({ mode: 'possessed', holderId: CONTROL_RECEIVER_ID });
      expect(interaction(result).outcome).toBe('possession');
      expect(interaction(result).difficulty).toMatchObject({ easy: true, total: 0, control, succeeds: true });
    }
  });

  it('widens difficult receive success and deflects failed body-height catches', () => {
    const low = sample(createControlReceiveScenario({ control: 0 }));
    const high = sample(createControlReceiveScenario({ control: 100 }));
    expect(interaction(low).outcome).toBe('deflection');
    expect(low.state.ball.mode).toBe('loose');
    if (low.state.ball.mode === 'loose') {
      expect(low.state.ball.velocity.y).toBeLessThan(0);
    }
    expect(interaction(high).outcome).toBe('possession');
    expect(high.state.ball).toEqual({ mode: 'possessed', holderId: CONTROL_RECEIVER_ID });
  });

  it('lets a failed catch above body height continue instead of inventing body contact', () => {
    const low = sample(createControlReceiveScenario({ control: 0, height: 1.2 }));
    const high = sample(createControlReceiveScenario({ control: 100, height: 1.2 }));
    expect(interaction(low).outcome).toBe('miss');
    expect(low.state.ball.mode).toBe('loose');
    if (low.state.ball.mode === 'loose') {
      expect(low.state.ball.velocity.y).toBeGreaterThan(0);
      expect(low.state.ball.position.y).toBeGreaterThan(-1.2);
    }
    expect(interaction(high).outcome).toBe('possession');
  });

  it.each(['low', 'high', 'right-stick'] as const)(
    'uses Control for a severe %s redirect and retains shared launch physics', (source) => {
      const low = sample(createControlReceiveScenario({ control: 0, source }));
      const high = sample(createControlReceiveScenario({ control: 100, source }));
      expect(interaction(low).outcome).toBe('deflection');
      const successful = interaction(high);
      expect(successful.outcome).toBe('one-touch');
      if (successful.outcome !== 'one-touch') throw new Error('Expected successful redirect.');
      expect(successful.direction).toEqual({ x: 0, y: -1 });
      const expected = createBallThrowLaunch(
        source === 'high' ? 'high' : 'low', successful.direction, successful.strength,
        createPlayerTuning(high.state.players[0].definition.attributes, high.tuning)
      );
      expect(successful.velocity).toEqual(expected.velocity);
      expect(successful.verticalVelocity).toBe(expected.verticalVelocity);
      expect(high.state.ball.mode).toBe('loose');
      expect(high.state.players[0].oneTouch.charge.family).toBeUndefined();
      expect(high.state.players[0].oneTouch.buffer).toBeUndefined();
    });

  it('shows a bounded Control benefit for marginal checks and no immunity to severe checks', () => {
    const low = sample(createControlRetentionScenario(0));
    const high = sample(createControlRetentionScenario(100));
    const severe = sample(createControlRetentionScenario(100, true));
    expect(impact(low).impactScore).toBeCloseTo(impact(high).impactScore);
    expect(impact(low).impactScore).toBeGreaterThan(6);
    expect(impact(low).impactScore).toBeLessThan(8);
    expect(impact(low).outcome).toBe('turnover');
    expect(impact(low).control).toBe(0);
    expect(impact(low).retentionThreshold).toBeCloseTo(4);
    expect(low.state.ball.mode).toBe('loose');
    expect(impact(high).outcome).not.toBe('turnover');
    expect(impact(high).control).toBe(100);
    expect(impact(high).retentionThreshold).toBeCloseTo(8);
    expect(high.state.ball).toEqual({ mode: 'possessed', holderId: CONTROL_RECEIVER_ID });
    expect(impact(severe).impactScore).toBeGreaterThan(9);
    expect(impact(severe).outcome).toBe('turnover');
    expect(severe.state.ball.mode).toBe('loose');
  });

  it('applies the same receive rule to both teams', () => {
    for (const control of [0, 100]) {
      for (const source of [undefined, 'low'] as const) {
        const human = sample(createControlReceiveScenario({ control, source }));
        const opponent = sample(createControlReceiveScenario({ control, source, teamId: 'opponent' }));
        expect(opponent.state.ball).toEqual(human.state.ball);
        expect(interaction(opponent).outcome).toBe(interaction(human).outcome);
      }
    }
  });

  it('uses visible contention and facing to distinguish otherwise identical receives', () => {
    const clear = sample(createControlReceiveScenario({ control: 50 }));
    const contested = sample(createControlReceiveScenario({ control: 50, contested: true }));
    const misaligned = sample(createControlReceiveScenario({ control: 50, misaligned: true }));
    expect(interaction(clear).outcome).toBe('possession');
    expect(interaction(contested).outcome).toBe('deflection');
    expect(interaction(misaligned).outcome).toBe('deflection');
    expect(interaction(contested).difficulty.contention).toBeGreaterThan(interaction(clear).difficulty.contention);
    expect(interaction(misaligned).difficulty.approach).toBeGreaterThan(interaction(clear).difficulty.approach);
  });

  it('explains difficult receive and redirect decisions with contributions and effective capacity', () => {
    for (const control of [0, 100]) {
      const result = sample(createControlReceiveScenario({ control, source: 'low' }));
      const record = interaction(result);
      const difficulty = record.difficulty;
      expect(difficulty.control).toBe(control);
      expect(difficulty.easy).toBe(false);
      expect(difficulty.speed).toBeGreaterThan(0);
      expect(difficulty.height).toBeGreaterThan(0);
      expect(difficulty.redirect).toBeCloseTo(0.6);
      expect(difficulty.total).toBeCloseTo(difficulty.speed + difficulty.height +
        difficulty.approach + difficulty.contention + difficulty.redirect);
      expect(difficulty.capacity).toBeCloseTo(control === 0 ? 0.55 : 1.85);
      expect(difficulty.succeeds).toBe(difficulty.total <= difficulty.capacity);
      expect(record.outcome).toBe(difficulty.succeeds ? 'one-touch' : 'deflection');
    }
  });

  it('executes equivalent human-device and direct intents through the same redirect path', () => {
    const definition = createControlReceiveScenario({ control: 100, source: 'high' });
    const router = createControlRouter({ tuning: createTuningRegistry(), initialPlayerId: CONTROL_RECEIVER_ID });
    const input = router.consumeTick({
      movement: { x: 0, y: 0 }, rightStick: { x: 0, y: 0 },
      buttons: { low: false, high: true, switch: false }
    }, 'receiving').routedIntent!;
    const human = sample({ ...definition, scriptedInputs: [{ tick: 1, input }] });
    const direct = sample(definition);
    expect(human.state).toEqual(direct.state);
    expect(interaction(human)).toEqual(interaction(direct));
  });

  it('registers scenarios and preserves gameplay with optional diagnostics', () => {
    for (const definition of CONTROL_RECEIVING_SCENARIOS) {
      expect(DEFAULT_SCENARIOS).toContain(definition);
      expect(stableStateHash(sample(definition).state)).toBe(stableStateHash(sample(definition, false).state));
    }
  });

  it('replays a difficult redirect and preserves outcomes at different render rates', () => {
    const definition = createControlReceiveScenario({ control: 100, source: 'high' });
    const atFrameRate = (fps: number) => {
      const run = createScenarioRun({ definition, step: stepGame, getArena: createArenaDefinition });
      for (let frame = 0; frame < fps / 2; frame++) run.runtime.advance(1 / fps);
      return run.state;
    };
    expect(atFrameRate(30)).toEqual(atFrameRate(120));
    let recorder: ReplayRecorder<GameState, RoutedPlayerIntent>;
    const run = createScenarioRun({
      definition, step: stepGame, getArena: createArenaDefinition,
      onStep: (state, tick, input) => recorder.recordStep(tick, input, state)
    });
    recorder = createReplayRecorder({
      scenarioId: definition.id, initialState: run.state, tuning: run.tuning,
      checkpointIntervalTicks: 1
    });
    run.runtime.pause();
    for (let tick = 0; tick < 30; tick++) run.runtime.stepOnce();
    const replay = replayScenario({
      scenario: definition, replay: recorder.finish(run.state), step: stepGame,
      getArena: createArenaDefinition
    });
    expect(replay.run.state).toEqual(run.state);
  });
});
