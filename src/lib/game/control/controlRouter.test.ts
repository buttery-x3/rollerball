import { describe, expect, it } from 'vitest';
import { createTuningRegistry } from '../config/tuning';
import {
  createFixedStepRuntime,
  DEFAULT_FIXED_STEP_SECONDS
} from '../runtime/fixedStepRuntime';
import { createGameState } from '../sim/gameState';
import { createControlRouter } from './controlRouter';
import type { ControlStepResult, InputSnapshot } from './types';

function snapshot(
  overrides: Partial<{
    movement: { x: number; y: number };
    rightStick: { x: number; y: number };
    low: boolean;
    high: boolean;
    switch: boolean;
  }> = {}
): InputSnapshot {
  return {
    movement: overrides.movement ?? { x: 0, y: 0 },
    rightStick: overrides.rightStick ?? { x: 0, y: 0 },
    buttons: {
      low: overrides.low ?? false,
      high: overrides.high ?? false,
      switch: overrides.switch ?? false
    }
  };
}

describe('control router', () => {
  it('consumes button edges exactly once while preserving held state', () => {
    const router = createControlRouter({
      tuning: createTuningRegistry(),
      initialPlayerId: 'player-a'
    });

    const pressed = router.consumeTick(snapshot({ low: true }), 'possessed');
    const held = router.consumeTick(snapshot({ low: true }), 'possessed');
    const released = router.consumeTick(snapshot(), 'possessed');

    expect(pressed.input.buttons.low).toEqual({ held: true, pressed: true, released: false });
    expect(held.input.buttons.low).toEqual({ held: true, pressed: false, released: false });
    expect(released.input.buttons.low).toEqual({ held: false, pressed: false, released: true });
    expect(pressed.routedIntent?.intent.lowThrow.held).toBe(true);
    expect(pressed.routedIntent?.intent.check).toEqual({
      held: false,
      pressed: false,
      released: false
    });
  });

  it('maps low input into check and receive contexts without exposing switch as intent', () => {
    const router = createControlRouter({ tuning: createTuningRegistry(), initialPlayerId: 'p1' });

    const defending = router.consumeTick(snapshot({ low: true, switch: true }), 'defending');
    const receiving = router.consumeTick(snapshot({ low: true }), 'receiving');

    expect(defending.routedIntent?.intent.check).toEqual({
      held: true,
      pressed: true,
      released: false
    });
    expect(receiving.routedIntent?.intent.receive.low.held).toBe(true);
    expect('switch' in receiving.routedIntent!.intent).toBe(false);
  });

  it('captures one right-stick pulse, then rearms only after neutral', () => {
    const router = createControlRouter({ tuning: createTuningRegistry(), initialPlayerId: 'p1' });

    expect(router.consumeTick(snapshot({ rightStick: { x: 0.4, y: 0 } })).routedIntent)
      .toBeDefined();
    expect(
      router.consumeTick(snapshot({ rightStick: { x: 0.8, y: 0 } })).routedIntent?.intent
        .rightStickThrow
    ).toBeUndefined();

    const captured = router.consumeTick(
      snapshot({ rightStick: { x: 0.8, y: 0.2 } }),
      'possessed'
    );
    const expectedMagnitude = Math.hypot(0.8, 0.2);
    expect(captured.routedIntent?.intent.rightStickThrow?.magnitude).toBeCloseTo(
      expectedMagnitude
    );
    expect(captured.routedIntent?.intent.rightStickThrow?.direction).toEqual({
      x: 0.8 / expectedMagnitude,
      y: 0.2 / expectedMagnitude
    });
    expect(captured.capture.phase).toBe('awaitingNeutral');

    expect(
      router.consumeTick(snapshot({ rightStick: { x: 0.8, y: 0.2 } }), 'possessed').routedIntent
        ?.intent.rightStickThrow
    ).toBeUndefined();
    expect(router.consumeTick(snapshot()).capture.phase).toBe('neutral');

    router.consumeTick(snapshot({ rightStick: { x: 0.5, y: 0 } }), 'possessed');
    router.consumeTick(snapshot({ rightStick: { x: 0.5, y: 0 } }), 'possessed');
    const second = router.consumeTick(snapshot({ rightStick: { x: 0.5, y: 0 } }), 'possessed');
    expect(second.routedIntent?.intent.rightStickThrow).toEqual({
      direction: { x: 1, y: 0 },
      magnitude: 0.5
    });
  });

  it('keeps peak magnitude while using the latest valid capture direction', () => {
    const router = createControlRouter({ tuning: createTuningRegistry(), initialPlayerId: 'p1' });

    router.consumeTick(snapshot({ rightStick: { x: 0.8, y: 0 } }), 'possessed');
    router.consumeTick(snapshot({ rightStick: { x: 0, y: 0.4 } }), 'possessed');
    const captured = router.consumeTick(
      snapshot({ rightStick: { x: 0, y: 0.2 } }),
      'possessed'
    );

    expect(captured.routedIntent?.intent.rightStickThrow).toEqual({
      direction: { x: 0, y: 1 },
      magnitude: 0.8
    });
  });

  it('changes assignment without replacing player runtime state', () => {
    const router = createControlRouter({
      tuning: createTuningRegistry(),
      initialPlayerId: 'player-a'
    });
    const playerState = {
      position: { x: 2, y: 3 },
      velocity: { x: 1, y: 0 }
    };
    const playerStates = new Map([
      ['player-a', playerState],
      ['player-b', { position: { x: -2, y: -3 }, velocity: { x: 0, y: 1 } }]
    ]);
    const before = structuredClone(playerState);

    expect(router.consumeTick(snapshot()).routedIntent?.playerId).toBe('player-a');
    router.assignPlayer('player-b', 'manual');
    const reassigned = router.consumeTick(snapshot({ movement: { x: 0, y: 1 } }));

    expect(reassigned.assignment).toEqual({ playerId: 'player-b', reason: 'manual' });
    expect(reassigned.routedIntent?.playerId).toBe('player-b');
    expect(playerStates.get('player-a')).toBe(playerState);
    expect(playerState).toEqual(before);
  });

  it('clears transient input and restores the initial assignment on reset', () => {
    const router = createControlRouter({
      tuning: createTuningRegistry(),
      initialPlayerId: 'player-a'
    });

    router.consumeTick(snapshot({ low: true, rightStick: { x: 0.8, y: 0 } }));
    router.assignPlayer('player-b');
    router.reset();

    const reset = router.consumeTick(snapshot());
    expect(reset.assignment).toEqual({ playerId: 'player-a', reason: 'reset' });
    expect(reset.input.buttons.low).toEqual({ held: false, pressed: false, released: false });
    expect(reset.capture).toEqual({
      phase: 'neutral',
      ticksCaptured: 0,
      ticksRemaining: 0,
      peakMagnitude: 0,
      direction: { x: 0, y: 0 }
    });
    expect(reset.routedIntent?.intent.rightStickThrow).toBeUndefined();
  });

  it('does not repeat a physical press during fixed-step catch-up', () => {
    const router = createControlRouter({
      tuning: createTuningRegistry(),
      initialPlayerId: 'player-a'
    });
    const state = createGameState();
    const consumed: ControlStepResult[] = [];
    const heldInput = snapshot({ low: true });
    const runtime = createFixedStepRuntime({
      state,
      getInput: () => router.consumeTick(heldInput, 'possessed'),
      step: (stepState, _fixedStepSeconds, _context, input) => {
        stepState.tick += 1;
        consumed.push(input as ControlStepResult);
      }
    });

    const frame = runtime.advance(DEFAULT_FIXED_STEP_SECONDS * 3);

    expect(frame.simulationSteps).toBe(3);
    expect(consumed).toHaveLength(3);
    expect(consumed.map((result) => result.input.buttons.low.pressed)).toEqual([
      true,
      false,
      false
    ]);
    expect(consumed.every((result) => result.input.buttons.low.held)).toBe(true);
  });
});
