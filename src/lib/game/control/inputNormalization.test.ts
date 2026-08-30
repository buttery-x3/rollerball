import { describe, expect, it } from 'vitest';
import { createTuningRegistry } from '../config/tuning';
import {
  createInputSnapshotFromDevices,
  DEFAULT_KEY_BINDINGS,
  type StandardGamepadLike
} from './browserInput';
import { normalizeDigitalMovement, normalizeStick } from './inputNormalization';

describe('control input normalization', () => {
  it('maps the stick deadzone to zero and remaps the usable range', () => {
    expect(normalizeStick({ x: 0.2, y: 0 }, 0.2)).toEqual({ x: 0, y: 0 });
    expect(normalizeStick({ x: 0.6, y: 0 }, 0.2).x).toBeCloseTo(0.5);
    expect(normalizeStick({ x: 1, y: 1 }, 0.2).x).toBeCloseTo(Math.SQRT1_2);
    expect(normalizeStick({ x: 1, y: 1 }, 0.2).y).toBeCloseTo(Math.SQRT1_2);
  });

  it('normalizes keyboard diagonals without giving them extra magnitude', () => {
    expect(normalizeDigitalMovement(1, 1).x).toBeCloseTo(Math.SQRT1_2);
    expect(normalizeDigitalMovement(1, 1).y).toBeCloseTo(Math.SQRT1_2);
    expect(normalizeDigitalMovement(-1, 0)).toEqual({ x: -1, y: 0 });
    expect(normalizeDigitalMovement(0, 0)).toEqual({ x: 0, y: 0 });
  });

  it('produces equivalent normalized movement from keyboard and standard Gamepad input', () => {
    const tuning = createTuningRegistry();
    const keyboardSnapshot = createInputSnapshotFromDevices(
      undefined,
      new Set([DEFAULT_KEY_BINDINGS.up[0], DEFAULT_KEY_BINDINGS.right[0]]),
      tuning
    );
    const gamepad: StandardGamepadLike = {
      axes: [1, -1, 0, 0],
      buttons: []
    };
    const gamepadSnapshot = createInputSnapshotFromDevices(gamepad, new Set(), tuning);

    expect(gamepadSnapshot.movement).toEqual(keyboardSnapshot.movement);
    expect(keyboardSnapshot.movement.x).toBeCloseTo(Math.SQRT1_2);
    expect(keyboardSnapshot.movement.y).toBeCloseTo(Math.SQRT1_2);
  });

  it('combines logical keyboard actions with standard Gamepad actions', () => {
    const tuning = createTuningRegistry();
    const snapshot = createInputSnapshotFromDevices(
      {
        axes: [0, 0, 0, 0],
        buttons: [{ pressed: true }, { value: 0.75 }, { pressed: false }]
      },
      new Set(DEFAULT_KEY_BINDINGS.switch),
      tuning
    );

    expect(snapshot.buttons).toEqual({ low: true, high: true, switch: true });
  });
});
