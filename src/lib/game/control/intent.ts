import type { PlayerIntent } from './types';

export const RELEASED_BUTTON = Object.freeze({ held: false, pressed: false, released: false });

/** Device-independent neutral action, also the starting point for AI intent. */
export function createNeutralPlayerIntent(overrides: Partial<PlayerIntent> = {}): PlayerIntent {
  return {
    movement: { x: 0, y: 0 }, desiredFacing: undefined, actionContext: 'neutral',
    lowThrow: RELEASED_BUTTON, highThrow: RELEASED_BUTTON, check: RELEASED_BUTTON,
    rightStickThrow: undefined,
    receive: { low: RELEASED_BUTTON, high: RELEASED_BUTTON, rightStickThrow: undefined },
    ...overrides
  };
}
