import { describe, expect, it } from 'vitest';
import { createControlRouter } from '../control/controlRouter';
import { createTuningRegistry } from '../config/tuning';
import type { RoutedPlayerIntent } from '../control/types';
import { createArenaDefinition } from '../physics/arena';
import { DEFAULT_SCENARIOS } from '../scenarios/defaultScenarios';
import {
  CHECK_SCENARIOS,
  CHECKER_ID,
  CHECK_TARGET_ID,
  carrierTurnoverCheckScenario,
  checkFreePlayScenario,
  createCheckIntent,
  glancingCheckScenario,
  highSpeedCheckScenario,
  lowSpeedCheckScenario,
  repeatedCheckImmunityScenario,
  strongStrengthCheckScenario,
  weakStrengthCheckScenario
} from '../scenarios/checkScenario';
import { stableStateHash } from '../scenarios/replay';
import { createScenarioRun, runScenario, type ScenarioDefinition } from '../scenarios/scenario';
import type { GameState } from './gameState';
import { stepGame } from './stepGame';

interface ImpactRecord {
  readonly checkerId: string;
  readonly targetId: string;
  readonly closingSpeed: number;
  readonly alignment: number;
  readonly strengthFactor: number;
  readonly impactScore: number;
  readonly outcome: 'weak' | 'knockback' | 'stumble' | 'turnover' | 'immune';
}

type CheckScenario = ScenarioDefinition<GameState, RoutedPlayerIntent>;

function sampleScenario(definition: CheckScenario, ticks = definition.automatedRunTicks) {
  const run = createScenarioRun({ definition, step: stepGame, getArena: createArenaDefinition });
  const impacts: ImpactRecord[] = [];
  const states: GameState[] = [];
  run.runtime.pause();
  for (let tick = 0; tick < ticks; tick += 1) {
    run.runtime.stepOnce();
    const record = run.diagnostics!.getFrame().records.find((item) => item.entityId === 'checking-state');
    expect(record).toBeDefined();
    impacts.push(...(record!.data!.impacts as readonly ImpactRecord[]));
    states.push(structuredClone(run.state));
  }
  return { run, impacts, states };
}

function target(state: GameState) {
  return state.players.find((player) => player.definition.id === CHECK_TARGET_ID)!;
}

describe('authored active checking', () => {
  it('registers the same named scenarios for automated and interactive execution', () => {
    expect(checkFreePlayScenario.scriptedInputs).toBeUndefined();
    expect(checkFreePlayScenario.interactiveActionContext).toBe('defending');
    for (const scenario of CHECK_SCENARIOS) {
      expect(DEFAULT_SCENARIOS).toContain(scenario);
      expect(scenario.diagnosticLayerOverrides).toContainEqual({ key: 'checking', enabled: true });
    }
  });

  it('distinguishes incidental contact and weak checks from an aligned high-speed check', () => {
    const incidental = sampleScenario({ ...highSpeedCheckScenario, scriptedInputs: [] }, 1);
    const weak = sampleScenario(lowSpeedCheckScenario, 1);
    const strong = sampleScenario(highSpeedCheckScenario, 1);
    expect(incidental.impacts).toEqual([]);
    expect(target(incidental.run.state).contact.stumbleTicksRemaining).toBe(0);
    expect(weak.impacts).toHaveLength(1);
    expect(weak.impacts[0].outcome).toBe('weak');
    expect(target(weak.run.state).contact.stumbleTicksRemaining).toBe(0);
    expect(strong.impacts).toHaveLength(1);
    expect(strong.impacts[0].outcome).toBe('stumble');
    expect(strong.impacts[0].impactScore).toBeGreaterThan(weak.impacts[0].impactScore);
    expect(target(strong.run.state).contact.stumbleTicksRemaining).toBeGreaterThan(0);
    expect(target(strong.run.state).velocity.x).toBeGreaterThan(target(incidental.run.state).velocity.x);
  });

  it('uses contact alignment and Strength without changing ordinary collision geometry', () => {
    const glancing = sampleScenario(glancingCheckScenario);
    const aligned = sampleScenario(highSpeedCheckScenario);
    const weak = sampleScenario(weakStrengthCheckScenario, 1);
    const strong = sampleScenario(strongStrengthCheckScenario, 1);
    expect(glancing.impacts.length).toBeGreaterThan(0);
    expect(glancing.impacts[0].alignment).toBeLessThan(aligned.impacts[0].alignment);
    expect(glancing.impacts[0].impactScore).toBeLessThan(aligned.impacts[0].impactScore);
    expect(strong.impacts[0].strengthFactor).toBeGreaterThan(weak.impacts[0].strengthFactor);
    expect(strong.impacts[0].impactScore).toBeGreaterThan(weak.impacts[0].impactScore);
    const weakIncidental = sampleScenario({ ...weakStrengthCheckScenario, scriptedInputs: [] }, 1);
    const strongIncidental = sampleScenario({ ...strongStrengthCheckScenario, scriptedInputs: [] }, 1);
    expect(weakIncidental.run.state.players.map((player) => [player.position, player.velocity]))
      .toEqual(strongIncidental.run.state.players.map((player) => [player.position, player.velocity]));
  });

  it('forces exactly one clean carrier release and clears held/receive throw state', () => {
    const result = sampleScenario({
      ...carrierTurnoverCheckScenario,
      createInitialState: () => {
        const state = carrierTurnoverCheckScenario.createInitialState();
        target(state).throwCharge = { family: 'low', elapsedSeconds: 0.2, strength: 0.6, progress: 0.5 };
        target(state).oneTouch.buffer = { direction: { x: 1, y: 0 }, magnitude: 1, ticksRemaining: 3 };
        return state;
      }
    });
    expect(result.impacts.filter((impact) => impact.outcome === 'turnover')).toHaveLength(1);
    const first = result.states[0];
    expect(first.ball.mode).toBe('loose');
    if (first.ball.mode === 'loose') {
      expect(first.ball.release?.releasedById).toBe(CHECK_TARGET_ID);
      expect(first.ball.release?.reacquisitionLockoutTicksRemaining).toBeGreaterThan(0);
    }
    expect(target(first).throwCharge.family).toBeUndefined();
    expect(target(first).oneTouch.buffer).toBeUndefined();
    expect(result.impacts.filter((impact) => impact.checkerId === CHECKER_ID && impact.targetId === CHECK_TARGET_ID))
      .toHaveLength(1);
  });

  it('keeps a below-threshold carrier impact in possession', () => {
    const result = sampleScenario({
      ...lowSpeedCheckScenario,
      createInitialState: () => ({
        ...lowSpeedCheckScenario.createInitialState(),
        ball: { mode: 'possessed', holderId: CHECK_TARGET_ID }
      })
    }, 1);
    expect(result.run.state.ball).toEqual({ mode: 'possessed', holderId: CHECK_TARGET_ID });
  });

  it('does not chain-stun a recovering target when a second checker makes contact', () => {
    const result = sampleScenario(repeatedCheckImmunityScenario);
    expect(result.impacts.some((impact) => impact.checkerId === CHECKER_ID && impact.outcome === 'stumble')).toBe(true);
    expect(result.impacts.some((impact) => impact.checkerId === 'second-checker' && impact.targetId === CHECK_TARGET_ID && impact.outcome === 'immune')).toBe(true);
    let initialStumble = 0;
    for (const state of result.states) {
      const remaining = target(state).contact.stumbleTicksRemaining;
      if (initialStumble > 0) {
        expect(remaining).toBeLessThanOrEqual(initialStumble);
      }
      initialStumble = remaining;
    }
    expect(target(result.run.state).contact.stumbleTicksRemaining).toBe(0);
    expect(target(result.run.state).contact.immunityTicksRemaining).toBe(0);
  });

  it('requires a new input edge after the active window and recovery', () => {
    const result = sampleScenario({
      ...highSpeedCheckScenario,
      createInitialState: () => {
        const state = highSpeedCheckScenario.createInitialState();
        state.players = [state.players[0]];
        return state;
      },
      scriptedInputs: Array.from({ length: 80 }, (_, index) => ({
        tick: index + 1,
        input: createCheckIntent(CHECKER_ID, index === 0)
      }))
    }, 80);
    const activeTicks = result.states.filter((state) => state.players[0].contact.checkTicksRemaining > 0);
    expect(activeTicks.length).toBeLessThanOrEqual(result.run.tuning.getNumber('contact.checkWindowTicks'));
    expect(result.run.state.players[0].contact.checkTicksRemaining).toBe(0);
    expect(result.run.state.players[0].contact.checkRecoveryTicksRemaining).toBe(0);
  });

  it('does not activate a check while the player possesses the ball', () => {
    const result = sampleScenario({
      ...highSpeedCheckScenario,
      createInitialState: () => ({
        ...highSpeedCheckScenario.createInitialState(),
        ball: { mode: 'possessed', holderId: CHECKER_ID }
      })
    }, 1);
    expect(result.run.state.players[0].contact.checkTicksRemaining).toBe(0);
    expect(result.impacts).toEqual([]);
  });

  it('resolves equivalent human-router and direct AI intents identically', () => {
    const router = createControlRouter({ tuning: createTuningRegistry(), initialPlayerId: CHECKER_ID });
    const routed = router.consumeTick({
      movement: { x: 0, y: 0 }, rightStick: { x: 0, y: 0 },
      buttons: { low: true, high: false, switch: false }
    }, 'defending').routedIntent!;
    const human = sampleScenario({ ...highSpeedCheckScenario, scriptedInputs: [{ tick: 1, input: routed }] });
    const ai = sampleScenario(highSpeedCheckScenario);
    expect(stableStateHash(human.run.state)).toBe(stableStateHash(ai.run.state));
    expect(human.impacts).toEqual(ai.impacts);
  });

  it('keeps diagnostics optional and results deterministic for every check scenario', () => {
    for (const definition of CHECK_SCENARIOS) {
      const enabled = sampleScenario(definition);
      const disabled = runScenario({
        definition, step: stepGame, getArena: createArenaDefinition,
        ticks: definition.automatedRunTicks, diagnosticsEnabled: false
      });
      expect(stableStateHash(enabled.run.state)).toBe(stableStateHash(disabled.state));
      for (const impact of enabled.impacts) {
        expect([impact.closingSpeed, impact.alignment, impact.strengthFactor, impact.impactScore].every(Number.isFinite)).toBe(true);
      }
    }
  });
});
