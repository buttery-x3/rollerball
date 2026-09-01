import { describe, expect, it } from 'vitest';
import {
  BALL_LOW_THROW_MAX_SPEED_KEY,
  createTuningRegistry
} from '../config/tuning';
import { createControlRouter } from '../control/controlRouter';
import { createArenaDefinition } from '../physics/arena';
import { DEFAULT_FIXED_STEP_SECONDS } from '../runtime/fixedStepRuntime';
import { createDiagnosticStore } from '../debug/diagnosticStore';
import {
  BALL_DIAGNOSTIC_LAYER,
  THROW_DIAGNOSTIC_LAYER
} from './diagnostics';
import {
  createPlayablePossessedGameState,
  createPlayableGameState,
  createEmptyThrowChargeState
} from './gameState';
import { stepGame } from './stepGame';
import { advanceThrowState } from './throwing';
import {
  createThrowIntent,
  THROW_FACING_AT_RELEASE_SCENARIO_ID,
  THROW_HIGH_MAX_CHARGE_SCENARIO_ID,
  THROW_HIGH_MIN_CHARGE_SCENARIO_ID,
  THROW_LOW_MAX_CHARGE_SCENARIO_ID,
  THROW_LOW_MIN_CHARGE_SCENARIO_ID,
  THROW_RELEASE_LOCKOUT_SCENARIO_ID,
  THROW_RIGHT_STICK_LOW_SCENARIO_ID,
  THROW_SCENARIOS,
  throwFacingAtReleaseScenario,
  throwHighMaximumChargeScenario,
  throwHighMinimumChargeScenario,
  throwLowMaximumChargeScenario,
  throwLowMinimumChargeScenario,
  throwReleaseLockoutScenario,
  throwRightStickLowScenario
} from '../scenarios/throwScenario';
import { DEFAULT_SCENARIOS } from '../scenarios/defaultScenarios';
import { runScenario } from '../scenarios/scenario';
import type { InputSnapshot } from '../control/types';

function runThrowScenario(
  definition: (typeof THROW_SCENARIOS)[number],
  ticks: number
) {
  return runScenario({
    definition,
    step: stepGame,
    getArena: (tuning) => createArenaDefinition(tuning),
    ticks
  });
}

function looseBall(run: ReturnType<typeof runThrowScenario>) {
  if (run.state.ball.mode !== 'loose') {
    throw new Error('The throw scenario did not release the ball.');
  }

  return run.state.ball;
}

function normalized(vector: { x: number; y: number }) {
  const magnitude = Math.hypot(vector.x, vector.y);
  return { x: vector.x / magnitude, y: vector.y / magnitude };
}

function inputSnapshot(rightStick: { x: number; y: number }): InputSnapshot {
  return {
    movement: { x: 0, y: 0 },
    rightStick,
    buttons: { low: false, high: false, switch: false }
  };
}

describe('throw action simulation', () => {
  it('registers reusable headless and interactive throw scenarios', () => {
    expect(THROW_SCENARIOS).toHaveLength(8);
    expect(DEFAULT_SCENARIOS.filter((scenario) => scenario.id.startsWith('throw-'))).toHaveLength(
      8
    );
    expect(THROW_SCENARIOS.map((scenario) => scenario.id)).toEqual([
      'throw-possessed-free-play',
      THROW_LOW_MIN_CHARGE_SCENARIO_ID,
      THROW_LOW_MAX_CHARGE_SCENARIO_ID,
      THROW_HIGH_MIN_CHARGE_SCENARIO_ID,
      THROW_HIGH_MAX_CHARGE_SCENARIO_ID,
      THROW_FACING_AT_RELEASE_SCENARIO_ID,
      THROW_RIGHT_STICK_LOW_SCENARIO_ID,
      THROW_RELEASE_LOCKOUT_SCENARIO_ID
    ]);
  });

  it('releases a low throw at minimum charge', () => {
    const run = runThrowScenario(throwLowMinimumChargeScenario, 2);
    const ball = looseBall(run);

    expect(ball.velocity.y).toBeGreaterThan(0);
    expect(ball.verticalVelocity).toBe(0);
    expect(ball.release?.releasedById).toBe('player-1');
    expect(ball.release?.reacquisitionLockoutTicksRemaining).toBe(6);
  });

  it('charges low throws to a clamped maximum', () => {
    const minimum = looseBall(runThrowScenario(throwLowMinimumChargeScenario, 2));
    const maximum = looseBall(runThrowScenario(throwLowMaximumChargeScenario, 32));

    expect(maximum.velocity.y).toBeGreaterThan(minimum.velocity.y);
    expect(maximum.velocity.y).toBeCloseTo(30 * Math.exp(-0.25 / 60), 6);
    expect(maximum.verticalVelocity).toBe(0);
  });

  it('releases high throws with a distinct lob trajectory and clamps maximum charge', () => {
    const minimumRun = runThrowScenario(throwHighMinimumChargeScenario, 2);
    const maximumRun = runThrowScenario(throwHighMaximumChargeScenario, 32);
    const minimum = looseBall(minimumRun);
    const maximum = looseBall(maximumRun);

    expect(minimum.verticalVelocity).toBeGreaterThan(0);
    expect(maximum.verticalVelocity).toBeGreaterThan(minimum.verticalVelocity);
    expect(maximum.velocity.y).toBeGreaterThan(minimum.velocity.y);
    expect(maximum.velocity.y).toBeLessThan(
      looseBall(runThrowScenario(throwLowMaximumChargeScenario, 32)).velocity.y
    );
  });

  it('uses facing at release after the player turns during charge', () => {
    const run = runThrowScenario(throwFacingAtReleaseScenario, 3);
    const ball = looseBall(run);
    const player = run.state.players[0];
    const ballDirection = normalized(ball.velocity);
    const playerFacing = normalized(player.facing);

    expect(ballDirection.x).toBeCloseTo(playerFacing.x, 8);
    expect(ballDirection.y).toBeCloseTo(playerFacing.y, 8);
    expect(playerFacing.x).toBeGreaterThan(0.5);
  });

  it('executes a right-stick-only low release from the captured magnitude', () => {
    const run = runThrowScenario(throwRightStickLowScenario, 1);
    const ball = looseBall(run);
    const release = run.diagnostics?.getFrame().records.find(
      (record) =>
        record.layer === THROW_DIAGNOSTIC_LAYER && record.entityId === 'throw-release'
    );

    expect(ball.velocity.x).toBeGreaterThan(0);
    expect(ball.velocity.y).toBeCloseTo(0, 8);
    expect(ball.verticalVelocity).toBe(0);
    expect(release?.data).toMatchObject({
      source: 'right-stick',
      family: 'low',
      strength: 0.8
    });
  });

  it('connects the FLAME-109 captured right-stick pulse to one simulation release', () => {
    const state = createPlayablePossessedGameState();
    const tuning = createTuningRegistry();
    const router = createControlRouter({ tuning, initialPlayerId: 'player-1' });

    for (const stick of [
      { x: 0.4, y: 0 },
      { x: 0.8, y: 0 },
      { x: 0.8, y: 0 }
    ]) {
      const routed = router.consumeTick(inputSnapshot(stick), 'possessed').routedIntent;
      stepGame(state, DEFAULT_FIXED_STEP_SECONDS, {
        tuning,
        arena: createArenaDefinition(tuning)
      }, routed);
    }

    expect(state.ball.mode).toBe('loose');
    if (state.ball.mode === 'loose') {
      expect(state.ball.release?.releasedById).toBe('player-1');
      expect(state.ball.velocity.x).toBeGreaterThan(0);
      expect(state.ball.velocity.y).toBeCloseTo(0, 8);
    }
  });

  it('transitions from possessed to loose exactly once and exposes lockout diagnostics', () => {
    const run = runThrowScenario(throwReleaseLockoutScenario, 4);
    const ball = looseBall(run);
    const ballRecords = run.diagnostics?.getFrame().records.filter(
      (record) => record.layer === BALL_DIAGNOSTIC_LAYER && record.entityId === 'ball-state'
    );

    expect(ball.release).toMatchObject({
      releasedById: 'player-1',
      reacquisitionLockoutTicksRemaining: 5
    });
    expect(run.state.players[0].throwCharge).toEqual(createEmptyThrowChargeState());
    expect(ballRecords).toHaveLength(1);
  });

  it('cancels ordinary charge whenever possession is lost', () => {
    const state = createPlayableGameState({
      throwCharge: {
        family: 'low',
        elapsedSeconds: 0.2,
        strength: 0.5,
        progress: 0.4
      }
    });
    const tuning = createTuningRegistry();
    const result = advanceThrowState(
      state,
      DEFAULT_FIXED_STEP_SECONDS,
      tuning,
      createThrowIntent({ lowThrow: { held: true, pressed: false, released: false } })
    );

    expect(result.cancelledPlayerIds).toEqual(['player-1']);
    expect(state.players[0].throwCharge).toEqual(createEmptyThrowChargeState());
  });

  it('does not resolve throw actions outside the possessed action context', () => {
    const state = createPlayablePossessedGameState();
    const tuning = createTuningRegistry();
    const possessedInput = createThrowIntent({
      lowThrow: { held: true, pressed: true, released: false }
    });
    const input = {
      ...possessedInput,
      intent: { ...possessedInput.intent, actionContext: 'neutral' as const }
    };

    const result = advanceThrowState(
      state,
      DEFAULT_FIXED_STEP_SECONDS,
      tuning,
      input
    );

    expect(result.release).toBeUndefined();
    expect(state.ball.mode).toBe('possessed');
    expect(state.players[0].throwCharge).toEqual(createEmptyThrowChargeState());
  });

  it('keeps charge, release, and launch diagnostics structured and layer-gated', () => {
    const state = createPlayablePossessedGameState();
    const tuning = createTuningRegistry();
    const diagnostics = createDiagnosticStore();
    diagnostics.setLayerEnabled(BALL_DIAGNOSTIC_LAYER, false);

    diagnostics.beginTick(1);
    stepGame(
      state,
      DEFAULT_FIXED_STEP_SECONDS,
      {
        tuning,
        arena: createArenaDefinition(tuning),
        diagnostics
      },
      createThrowIntent({
        lowThrow: { held: true, pressed: true, released: false }
      })
    );
    diagnostics.endTick();

    expect(diagnostics.getFrame().records.some((record) => record.layer === BALL_DIAGNOSTIC_LAYER)).toBe(
      false
    );
    expect(diagnostics.getFrame().records.some((record) => record.layer === THROW_DIAGNOSTIC_LAYER)).toBe(
      true
    );
  });

  it('reads live tuning overrides when creating a release', () => {
    const state = createPlayablePossessedGameState();
    const tuning = createTuningRegistry();
    tuning.setOverride(BALL_LOW_THROW_MAX_SPEED_KEY, 40);

    const result = advanceThrowState(
      state,
      DEFAULT_FIXED_STEP_SECONDS,
      tuning,
      createThrowIntent({
        rightStickThrow: { direction: { x: 0, y: 1 }, magnitude: 1 }
      })
    );

    expect(result.release?.velocity).toEqual({ x: 0, y: 40 });
  });
});
