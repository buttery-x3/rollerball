import type { TuningReader } from '../config/tuning';
import {
  CONTROLS_LEFT_STICK_DEADZONE_KEY,
  CONTROLS_RIGHT_STICK_DEADZONE_KEY
} from '../config/tuning';
import { normalizeDigitalMovement, normalizeStick, vectorMagnitude } from './inputNormalization';
import type { InputSnapshot } from './types';

const LOW_BUTTON_INDEX = 0;
const HIGH_BUTTON_INDEX = 1;
const SWITCH_BUTTON_INDEX = 2;
const LEFT_STICK_X_AXIS = 0;
const LEFT_STICK_Y_AXIS = 1;
const RIGHT_STICK_X_AXIS = 2;
const RIGHT_STICK_Y_AXIS = 3;

export const DEFAULT_KEY_BINDINGS = {
  up: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  low: ['KeyJ'],
  high: ['KeyK'],
  switch: ['KeyL']
} as const;

export interface GamepadButtonLike {
  readonly pressed?: boolean;
  readonly value?: number;
}

export interface StandardGamepadLike {
  readonly axes: readonly number[];
  readonly buttons: readonly GamepadButtonLike[];
  readonly connected?: boolean;
}

export interface BrowserInputSource {
  poll(): void;
  /** Consumes at most one sampled button transition for the next fixed tick. */
  getSnapshot(): InputSnapshot;
  reset(): void;
  dispose(): void;
}

export interface BrowserInputSourceOptions {
  readonly eventTarget?: Window;
  readonly getGamepads?: () => readonly (StandardGamepadLike | null)[];
  readonly onReset?: () => void;
}

function axis(gamepad: StandardGamepadLike | undefined, index: number): number {
  const value = gamepad?.axes[index] ?? 0;
  return Number.isFinite(value) ? value : 0;
}

function button(gamepad: StandardGamepadLike | undefined, index: number): boolean {
  const value = gamepad?.buttons[index];
  const analogValue = value?.value ?? 0;
  return Boolean(value?.pressed) || (Number.isFinite(analogValue) && analogValue > 0.5);
}

function hasKey(keys: ReadonlySet<string>, bindings: readonly string[]): boolean {
  return bindings.some((binding) => keys.has(binding));
}

function keyboardMovement(keys: ReadonlySet<string>): { x: number; y: number } {
  const horizontal =
    (hasKey(keys, DEFAULT_KEY_BINDINGS.right) ? 1 : 0) -
    (hasKey(keys, DEFAULT_KEY_BINDINGS.left) ? 1 : 0);
  const vertical =
    (hasKey(keys, DEFAULT_KEY_BINDINGS.up) ? 1 : 0) -
    (hasKey(keys, DEFAULT_KEY_BINDINGS.down) ? 1 : 0);

  return normalizeDigitalMovement(horizontal, vertical);
}

export function createNeutralInputSnapshot(): InputSnapshot {
  return {
    movement: { x: 0, y: 0 },
    rightStick: { x: 0, y: 0 },
    buttons: { low: false, high: false, switch: false }
  };
}

export function createInputSnapshotFromDevices(
  gamepad: StandardGamepadLike | undefined,
  keys: ReadonlySet<string>,
  tuning: TuningReader
): InputSnapshot {
  const gamepadMovement = normalizeStick(
    {
      x: axis(gamepad, LEFT_STICK_X_AXIS),
      y: -axis(gamepad, LEFT_STICK_Y_AXIS)
    },
    tuning.getNumber(CONTROLS_LEFT_STICK_DEADZONE_KEY)
  );
  const fallbackMovement = keyboardMovement(keys);
  const movement = vectorMagnitude(gamepadMovement) > 0 ? gamepadMovement : fallbackMovement;

  const rightStick = normalizeStick(
    {
      x: axis(gamepad, RIGHT_STICK_X_AXIS),
      y: -axis(gamepad, RIGHT_STICK_Y_AXIS)
    },
    tuning.getNumber(CONTROLS_RIGHT_STICK_DEADZONE_KEY)
  );

  return {
    movement,
    rightStick,
    buttons: {
      low: button(gamepad, LOW_BUTTON_INDEX) || hasKey(keys, DEFAULT_KEY_BINDINGS.low),
      high: button(gamepad, HIGH_BUTTON_INDEX) || hasKey(keys, DEFAULT_KEY_BINDINGS.high),
      switch: button(gamepad, SWITCH_BUTTON_INDEX) || hasKey(keys, DEFAULT_KEY_BINDINGS.switch)
    }
  };
}

function firstConnectedGamepad(
  gamepads: readonly (StandardGamepadLike | null)[]
): StandardGamepadLike | undefined {
  return gamepads.find((gamepad) => gamepad !== null && gamepad.connected !== false) ?? undefined;
}

export function createBrowserInputSource(
  tuning: TuningReader,
  options: BrowserInputSourceOptions = {}
): BrowserInputSource {
  const eventTarget =
    options.eventTarget ?? (typeof window === 'undefined' ? undefined : window);
  const getGamepads =
    options.getGamepads ??
    (() =>
      typeof navigator === 'undefined'
        ? []
        : (navigator.getGamepads() as readonly (StandardGamepadLike | null)[]));
  const keys = new Set<string>();
  let snapshot = createNeutralInputSnapshot();
  const pendingButtons: InputSnapshot['buttons'][] = [];
  let hadGamepad = false;

  const sample = (gamepad: StandardGamepadLike | undefined): void => {
    const next = createInputSnapshotFromDevices(gamepad, keys, tuning);
    if (next.buttons.low !== snapshot.buttons.low || next.buttons.high !== snapshot.buttons.high || next.buttons.switch !== snapshot.buttons.switch) {
      pendingButtons.push(next.buttons);
    }
    snapshot = next;
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    const element = event.target as HTMLElement | null;
    if (element && (['INPUT', 'SELECT', 'TEXTAREA'].includes(element.tagName) || element.isContentEditable)) return;
    if (!Object.values(DEFAULT_KEY_BINDINGS).some(bindings => (bindings as readonly string[]).includes(event.code))) return;
    event.preventDefault();
    keys.add(event.code);
    sample(firstConnectedGamepad(getGamepads()));
  };

  const onKeyUp = (event: KeyboardEvent): void => {
    keys.delete(event.code);
    sample(firstConnectedGamepad(getGamepads()));
  };

  const onReset = (): void => {
    keys.clear();
    pendingButtons.length = 0;
    snapshot = createNeutralInputSnapshot();
    hadGamepad = false;
    options.onReset?.();
  };

  const onGamepadDisconnected = (): void => {
    onReset();
  };

  if (eventTarget) {
    eventTarget.addEventListener('keydown', onKeyDown);
    eventTarget.addEventListener('keyup', onKeyUp);
    eventTarget.addEventListener('blur', onReset);
    eventTarget.addEventListener('gamepaddisconnected', onGamepadDisconnected);
  }

  return {
    poll(): void {
      const gamepad = firstConnectedGamepad(getGamepads());
      if (hadGamepad && !gamepad) {
        onReset();
      }

      hadGamepad = gamepad !== undefined;
      sample(gamepad);
    },

    getSnapshot(): InputSnapshot {
      return {
        movement: { ...snapshot.movement },
        rightStick: { ...snapshot.rightStick },
        buttons: { ...(pendingButtons.shift() ?? snapshot.buttons) }
      };
    },

    reset(): void {
      onReset();
    },

    dispose(): void {
      if (eventTarget) {
        eventTarget.removeEventListener('keydown', onKeyDown);
        eventTarget.removeEventListener('keyup', onKeyUp);
        eventTarget.removeEventListener('blur', onReset);
        eventTarget.removeEventListener('gamepaddisconnected', onGamepadDisconnected);
      }

      onReset();
    }
  };
}
