import { describe, expect, it } from 'vitest';
import { createTuningRegistry } from '../config/tuning';
import { createControlRouter } from './controlRouter';
import {
  createBrowserInputSource,
  type StandardGamepadLike
} from './browserInput';

describe('browser input source', () => {
  it('clears sampled input when the active Gamepad disconnects', () => {
    const target = new EventTarget();
    const gamepad: StandardGamepadLike = {
      axes: [0, -1, 0, 0],
      buttons: [{ pressed: true }]
    };
    let connected = true;
    let resetCount = 0;
    const source = createBrowserInputSource(createTuningRegistry(), {
      eventTarget: target as unknown as Window,
      getGamepads: () => (connected ? [gamepad] : []),
      onReset: () => {
        resetCount += 1;
      }
    });

    source.poll();
    expect(source.getSnapshot()).toMatchObject({
      movement: { x: 0, y: expect.any(Number) },
      buttons: { low: true }
    });

    connected = false;
    target.dispatchEvent(new Event('gamepaddisconnected'));

    expect(resetCount).toBe(1);
    expect(source.getSnapshot()).toEqual({
      movement: { x: 0, y: 0 },
      rightStick: { x: 0, y: 0 },
      buttons: { low: false, high: false, switch: false }
    });
    source.dispose();
  });

  it('also detects a missing Gamepad during polling and returns keyboard-neutral state', () => {
    let connected = true;
    const source = createBrowserInputSource(createTuningRegistry(), {
      getGamepads: () => (connected ? [{ axes: [0, 0, 0, 0], buttons: [] }] : [])
    });

    source.poll();
    connected = false;
    source.poll();

    expect(source.getSnapshot()).toEqual({
      movement: { x: 0, y: 0 },
      rightStick: { x: 0, y: 0 },
      buttons: { low: false, high: false, switch: false }
    });
    source.dispose();
  });

  it('clears router transient input on device reset without changing assignment', () => {
    const tuning = createTuningRegistry();
    const router = createControlRouter({ tuning, initialPlayerId: 'player-a' });
    router.assignPlayer('player-b', 'manual');

    const target = new EventTarget();
    const gamepad: StandardGamepadLike = {
      axes: [0, 0, 0.8, 0],
      buttons: [{ pressed: true }]
    };
    let connected = true;
    const source = createBrowserInputSource(tuning, {
      eventTarget: target as unknown as Window,
      getGamepads: () => (connected ? [gamepad] : []),
      onReset: () => router.resetInput()
    });

    source.poll();
    const held = router.consumeTick(source.getSnapshot(), 'possessed');
    router.consumeTick(source.getSnapshot(), 'possessed');

    expect(held.input.buttons.low).toEqual({ held: true, pressed: true, released: false });
    expect(held.capture.phase).toBe('capturing');

    connected = false;
    target.dispatchEvent(new Event('gamepaddisconnected'));
    const neutral = router.consumeTick(source.getSnapshot(), 'possessed');

    expect(neutral.assignment).toEqual({ playerId: 'player-b', reason: 'manual' });
    expect(neutral.input.buttons.low).toEqual({
      held: false,
      pressed: false,
      released: false
    });
    expect(neutral.capture).toEqual({
      phase: 'neutral',
      ticksCaptured: 0,
      ticksRemaining: 0,
      peakMagnitude: 0,
      direction: { x: 0, y: 0 }
    });
    expect(neutral.routedIntent?.intent.rightStickThrow).toBeUndefined();
    source.dispose();
  });
});
