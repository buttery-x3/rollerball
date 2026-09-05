import { describe, expect, it } from 'vitest';
import {
  BALL_LOW_THROW_MAX_SPEED_KEY,
  BALL_LOW_THROW_MIN_SPEED_KEY,
  createTuningRegistry
} from '../config/tuning';
import { createControlRouter } from '../control/controlRouter';
import type { InputSnapshot } from '../control/types';
import { createArenaDefinition } from '../physics/arena';
import { createBallThrowLaunch } from '../physics/ballTrajectory';
import { DEFAULT_FIXED_STEP_SECONDS } from '../runtime/fixedStepRuntime';
import { DEFAULT_SCENARIOS } from '../scenarios/defaultScenarios';
import {
  RECEIVING_SCENARIOS,
  RECEIVE_ABOVE_CATCH_HEIGHT_SCENARIO_ID,
  RECEIVE_EASY_PICKUP_SCENARIO_ID,
  RECEIVE_HIGH_CANCEL_SCENARIO_ID,
  RECEIVE_HIGH_ONE_TOUCH_SCENARIO_ID,
  RECEIVE_INCOMING_WORKBENCH_SCENARIO_ID,
  RECEIVE_LOCKOUT_REACQUISITION_SCENARIO_ID,
  RECEIVE_LOW_CANCEL_SCENARIO_ID,
  RECEIVE_LOW_ONE_TOUCH_SCENARIO_ID,
  RECEIVE_RIGHT_STICK_ONE_TOUCH_SCENARIO_ID,
  receiveAboveCatchHeightScenario,
  receiveEasyPickupScenario,
  receiveHighCancelScenario,
  receiveHighOneTouchScenario,
  receiveIncomingWorkbenchScenario,
  receiveLockoutReacquisitionScenario,
  receiveLowCancelScenario,
  receiveLowOneTouchScenario,
  receiveRightStickOneTouchScenario
} from '../scenarios/receivingScenario';
import { runScenario } from '../scenarios/scenario';
import {
  RECEIVE_DIAGNOSTIC_LAYER
} from './diagnostics';
import {
  createFieldPlayerState,
  createLooseBallState,
  createPlayablePossessedGameState,
  type GameState
} from './gameState';
import { stepGame } from './stepGame';

function runReceivingScenario(
  definition: (typeof RECEIVING_SCENARIOS)[number],
  ticks = definition.automatedRunTicks,
  onStep?: (state: GameState, tick: number) => void
) {
  return runScenario({
    definition,
    step: stepGame,
    getArena: (tuning) => createArenaDefinition(tuning),
    ticks,
    onStep
  });
}

function interactionRecord(run: ReturnType<typeof runReceivingScenario>) {
  return run.diagnostics?.getFrame().records.find(
    (record) =>
      record.layer === RECEIVE_DIAGNOSTIC_LAYER &&
      record.entityId === 'receive-interaction'
  );
}

function receiveStateRecord(run: ReturnType<typeof runReceivingScenario>) {
  return run.diagnostics?.getFrame().records.find(
    (record) =>
      record.layer === RECEIVE_DIAGNOSTIC_LAYER &&
      record.entityId === 'receive-state'
  );
}

function snapshot(low = false): InputSnapshot {
  return {
    movement: { x: 0, y: 0 },
    rightStick: { x: 0, y: 0 },
    buttons: { low, high: false, switch: false }
  };
}

describe('loose-ball pickup and receiving', () => {
  it('registers every required reusable receiving scenario', () => {
    expect(RECEIVING_SCENARIOS).toHaveLength(9);
    expect(
      DEFAULT_SCENARIOS.filter((scenario) => scenario.id.startsWith('receive-'))
    ).toHaveLength(9);
    expect(RECEIVING_SCENARIOS.map((scenario) => scenario.id)).toEqual([
      RECEIVE_EASY_PICKUP_SCENARIO_ID,
      RECEIVE_LOCKOUT_REACQUISITION_SCENARIO_ID,
      RECEIVE_INCOMING_WORKBENCH_SCENARIO_ID,
      RECEIVE_ABOVE_CATCH_HEIGHT_SCENARIO_ID,
      RECEIVE_LOW_ONE_TOUCH_SCENARIO_ID,
      RECEIVE_HIGH_ONE_TOUCH_SCENARIO_ID,
      RECEIVE_RIGHT_STICK_ONE_TOUCH_SCENARIO_ID,
      RECEIVE_LOW_CANCEL_SCENARIO_ID,
      RECEIVE_HIGH_CANCEL_SCENARIO_ID
    ]);
    expect(receiveIncomingWorkbenchScenario.interactiveActionContext).toBe(
      'receiving'
    );
  });

  it('establishes ordinary possession exactly once for an easy pickup', () => {
    const run = runReceivingScenario(receiveEasyPickupScenario);

    expect(run.state.ball).toEqual({ mode: 'possessed', holderId: 'player-1' });
    expect(interactionRecord(run)?.data).toMatchObject({
      outcome: 'possession',
      holderId: 'player-1'
    });
  });

  it('ignores the releaser for the full configured lockout then reacquires', () => {
    const history: Array<{
      tick: number;
      mode: GameState['ball']['mode'];
      remaining: number | undefined;
    }> = [];
    const run = runReceivingScenario(
      receiveLockoutReacquisitionScenario,
      receiveLockoutReacquisitionScenario.automatedRunTicks,
      (state, tick) => {
        history.push({
          tick,
          mode: state.ball.mode,
          remaining:
            state.ball.mode === 'loose'
              ? state.ball.release?.reacquisitionLockoutTicksRemaining
              : undefined
        });
      }
    );

    expect(history).toEqual([
      { tick: 1, mode: 'possessed', remaining: undefined },
      { tick: 2, mode: 'loose', remaining: 6 },
      { tick: 3, mode: 'loose', remaining: 5 },
      { tick: 4, mode: 'loose', remaining: 4 },
      { tick: 5, mode: 'loose', remaining: 3 },
      { tick: 6, mode: 'loose', remaining: 2 },
      { tick: 7, mode: 'loose', remaining: 1 },
      { tick: 8, mode: 'possessed', remaining: undefined }
    ]);
    expect(run.state.ball).toEqual({ mode: 'possessed', holderId: 'player-1' });
  });

  it('lets another field player receive regardless of team identity', () => {
    const run = runReceivingScenario(receiveIncomingWorkbenchScenario);
    const receiver = run.state.players.find(
      (player) => player.definition.id === 'player-1'
    );

    expect(receiver?.definition.teamId).toBe('opponent');
    expect(run.state.ball).toEqual({ mode: 'possessed', holderId: 'player-1' });
  });

  it('allows other players to acquire while the releaser is locked out', () => {
    const tuning = createTuningRegistry();
    const state: GameState = {
      tick: 0,
      players: [
        createFieldPlayerState({ id: 'releaser', teamId: 'human' }),
        createFieldPlayerState({ id: 'other', teamId: 'opponent' })
      ],
      ball: createLooseBallState({
        release: {
          releasedById: 'releaser',
          reacquisitionLockoutTicksRemaining: 6
        }
      })
    };

    stepGame(state, DEFAULT_FIXED_STEP_SECONDS, {
      tuning,
      arena: createArenaDefinition(tuning)
    });

    expect(state.ball).toEqual({ mode: 'possessed', holderId: 'other' });
  });

  it('uses stable player ID order to break simultaneous contact ties', () => {
    const tuning = createTuningRegistry();
    const state: GameState = {
      tick: 0,
      players: [
        createFieldPlayerState({ id: 'player-z' }),
        createFieldPlayerState({ id: 'player-a' })
      ],
      ball: createLooseBallState()
    };

    stepGame(state, DEFAULT_FIXED_STEP_SECONDS, {
      tuning,
      arena: createArenaDefinition(tuning)
    });

    expect(state.ball).toEqual({ mode: 'possessed', holderId: 'player-a' });
  });

  it('sweeps fast incoming contact but lets a ball above catch height pass through', () => {
    const pickupState: GameState = {
      tick: 0,
      players: [createFieldPlayerState({ id: 'receiver' })],
      ball: createLooseBallState({
        position: { x: 0, y: -3 },
        velocity: { x: 0, y: 240 },
        height: 0
      })
    };
    const tuning = createTuningRegistry();

    stepGame(pickupState, DEFAULT_FIXED_STEP_SECONDS, {
      tuning,
      arena: createArenaDefinition(tuning)
    });
    const overhead = runReceivingScenario(receiveAboveCatchHeightScenario);

    expect(pickupState.ball).toEqual({ mode: 'possessed', holderId: 'receiver' });
    expect(overhead.state.ball.mode).toBe('loose');
    if (overhead.state.ball.mode === 'loose') {
      expect(overhead.state.ball.position.y).toBeGreaterThan(0);
      expect(overhead.state.ball.velocity.y).toBeGreaterThan(0);
    }
  });

  it('keeps free-play control assigned through throw, loose chase, reacquire, and rethrow', () => {
    const tuning = createTuningRegistry();
    tuning.setOverride(BALL_LOW_THROW_MIN_SPEED_KEY, 0);
    tuning.setOverride(BALL_LOW_THROW_MAX_SPEED_KEY, 0);
    const state = createPlayablePossessedGameState();
    const router = createControlRouter({ tuning, initialPlayerId: 'player-1' });
    const arena = createArenaDefinition(tuning);

    const step = (low: boolean, actionContext: 'possessed' | 'neutral') => {
      const routed = router.consumeTick(snapshot(low), actionContext).routedIntent;
      stepGame(state, DEFAULT_FIXED_STEP_SECONDS, { tuning, arena }, routed);
      expect(router.assignment?.playerId).toBe('player-1');
    };

    step(true, 'possessed');
    step(false, 'possessed');
    for (let tick = 3; tick <= 8; tick += 1) {
      step(false, 'neutral');
    }
    expect(state.ball).toEqual({ mode: 'possessed', holderId: 'player-1' });

    step(true, 'possessed');
    step(false, 'possessed');
    expect(state.ball.mode).toBe('loose');
    expect(router.assignment?.playerId).toBe('player-1');
  });
});

describe('one-touch receiving actions', () => {
  it.each([
    ['low', receiveLowOneTouchScenario],
    ['high', receiveHighOneTouchScenario]
  ] as const)('redirects a held %s action with the ordinary throw launch mapping', (family, scenario) => {
    const run = runReceivingScenario(scenario);
    const interaction = interactionRecord(run)?.data as
      | { strength?: number; source?: string; outcome?: string }
      | undefined;

    expect(run.state.ball.mode).toBe('loose');
    expect(interaction).toMatchObject({
      outcome: 'one-touch',
      source: `${family}-button`
    });
    const expected = createBallThrowLaunch(
      family,
      { x: 1, y: 0 },
      interaction?.strength ?? Number.NaN,
      run.tuning
    );
    if (run.state.ball.mode === 'loose') {
      expect(run.state.ball.velocity.x).toBeCloseTo(expected.velocity.x, 10);
      expect(run.state.ball.velocity.y).toBeCloseTo(expected.velocity.y, 10);
      expect(run.state.ball.verticalVelocity).toBeCloseTo(
        expected.verticalVelocity,
        10
      );
      expect(run.state.ball.release).toMatchObject({
        releasedById: 'player-1',
        reacquisitionLockoutTicksRemaining: 6
      });
    }
  });

  it('buffers a right-stick pulse and redirects low from its captured vector', () => {
    const run = runReceivingScenario(receiveRightStickOneTouchScenario);

    expect(interactionRecord(run)?.data).toMatchObject({
      outcome: 'one-touch',
      source: 'right-stick',
      family: 'low',
      direction: { x: -1, y: 0 },
      strength: 0.8
    });
    expect(run.state.ball.mode).toBe('loose');
    if (run.state.ball.mode === 'loose') {
      expect(run.state.ball.velocity.x).toBeLessThan(0);
      expect(run.state.ball.velocity.y).toBeCloseTo(0, 10);
      expect(run.state.ball.verticalVelocity).toBe(0);
    }
  });

  it.each([
    ['low', receiveLowCancelScenario],
    ['high', receiveHighCancelScenario]
  ] as const)('cancels a %s one-touch released before contact', (_family, scenario) => {
    const run = runReceivingScenario(scenario);

    expect(run.state.ball).toEqual({ mode: 'possessed', holderId: 'player-1' });
    expect(run.state.players[0].oneTouch).toEqual({
      charge: {
        family: undefined,
        elapsedSeconds: 0,
        strength: 0,
        progress: 0
      },
      buffer: undefined
    });
  });

  it('exposes active charge, buffer, lockout, envelope, and resolved interaction diagnostics', () => {
    const charging = runReceivingScenario(receiveLowOneTouchScenario, 5);
    const chargeData = receiveStateRecord(charging)?.data as
      | { players?: Array<{ oneTouch?: { charge?: { active?: boolean } } }> }
      | undefined;
    const buffered = runReceivingScenario(receiveRightStickOneTouchScenario, 2);
    const bufferData = receiveStateRecord(buffered)?.data as
      | { players?: Array<{ oneTouch?: { buffer?: { ticksRemaining?: number } } }> }
      | undefined;
    const lockout = runReceivingScenario(receiveLockoutReacquisitionScenario, 3);
    const lockoutData = receiveStateRecord(lockout)?.data as
      | {
          envelopeRadius?: number;
          releaseLockout?: { reacquisitionLockoutTicksRemaining?: number };
          players?: Array<{ lockedOut?: boolean }>;
        }
      | undefined;
    const resolved = runReceivingScenario(receiveEasyPickupScenario);

    expect(chargeData?.players?.[0]?.oneTouch?.charge?.active).toBe(true);
    expect(bufferData?.players?.[0]?.oneTouch?.buffer?.ticksRemaining).toBe(5);
    expect(lockoutData).toMatchObject({
      envelopeRadius: 0.95,
      releaseLockout: { reacquisitionLockoutTicksRemaining: 5 },
      players: [{ lockedOut: true }]
    });
    expect(interactionRecord(resolved)?.data).toMatchObject({
      outcome: 'possession'
    });
  });
});
