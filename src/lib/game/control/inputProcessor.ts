import type { TuningReader } from '../config/tuning';
import { cloneVector, vectorMagnitude } from './inputNormalization';
import {
  CONTROLS_RIGHT_STICK_CAPTURE_WINDOW_TICKS_KEY,
  CONTROLS_RIGHT_STICK_NEUTRAL_THRESHOLD_KEY
} from '../config/tuning';
import type {
  ButtonState,
  InputSnapshot,
  ProcessedInputSnapshot,
  RightStickCaptureState,
  RightStickThrowPulse
} from './types';

const EPSILON = 1e-9;
const ZERO = { x: 0, y: 0 };

export interface InputProcessorResult {
  readonly input: ProcessedInputSnapshot;
  readonly rightStickThrow: RightStickThrowPulse | undefined;
  readonly capture: RightStickCaptureState;
}

export interface InputProcessor {
  process(snapshot: InputSnapshot): InputProcessorResult;
  reset(): void;
}

function assertButtonSnapshot(snapshot: InputSnapshot): void {
  const buttons = snapshot.buttons;
  if (
    typeof buttons.low !== 'boolean' ||
    typeof buttons.high !== 'boolean' ||
    typeof buttons.switch !== 'boolean'
  ) {
    throw new TypeError('Input button states must be boolean values.');
  }
}

function assertInputSnapshot(snapshot: InputSnapshot): void {
  if (!snapshot || typeof snapshot !== 'object') {
    throw new TypeError('An input snapshot is required.');
  }

  vectorMagnitude(snapshot.movement);
  vectorMagnitude(snapshot.rightStick);
  assertButtonSnapshot(snapshot);
}

function buttonState(held: boolean, wasHeld: boolean): ButtonState {
  return {
    held,
    pressed: held && !wasHeld,
    released: !held && wasHeld
  };
}

function captureState(
  phase: RightStickCaptureState['phase'],
  ticksCaptured: number,
  ticksRemaining: number,
  peakMagnitude: number,
  direction: { readonly x: number; readonly y: number }
): RightStickCaptureState {
  return {
    phase,
    ticksCaptured,
    ticksRemaining,
    peakMagnitude,
    direction: cloneVector(direction)
  };
}

export function createInputProcessor(tuning: TuningReader): InputProcessor {
  let previousLow = false;
  let previousHigh = false;
  let previousSwitch = false;

  let phase: RightStickCaptureState['phase'] = 'neutral';
  let ticksCaptured = 0;
  let peakMagnitude = 0;
  let latestDirection = ZERO;

  const resetCapture = (): void => {
    phase = 'neutral';
    ticksCaptured = 0;
    peakMagnitude = 0;
    latestDirection = ZERO;
  };

  const currentCapture = (windowTicks: number): RightStickCaptureState =>
    captureState(
      phase,
      ticksCaptured,
      phase === 'capturing' ? Math.max(0, windowTicks - ticksCaptured) : 0,
      peakMagnitude,
      latestDirection
    );

  const recordStickSample = (stick: { readonly x: number; readonly y: number }): void => {
    const magnitude = vectorMagnitude(stick);
    if (magnitude <= EPSILON) {
      return;
    }

    const capturedMagnitude = Math.min(1, magnitude);
    if (capturedMagnitude > peakMagnitude) {
      peakMagnitude = capturedMagnitude;
    }

    latestDirection = { x: stick.x / magnitude, y: stick.y / magnitude };
  };

  const emitPulse = (): RightStickThrowPulse | undefined => {
    if (peakMagnitude <= EPSILON) {
      resetCapture();
      return undefined;
    }

    phase = 'awaitingNeutral';
    return {
      direction: cloneVector(latestDirection),
      magnitude: peakMagnitude
    };
  };

  const processRightStick = (
    stick: { readonly x: number; readonly y: number },
    windowTicks: number,
    neutralThreshold: number
  ): RightStickThrowPulse | undefined => {
    const magnitude = vectorMagnitude(stick);

    if (phase === 'awaitingNeutral') {
      if (magnitude <= neutralThreshold) {
        resetCapture();
      }

      return undefined;
    }

    if (phase === 'neutral') {
      if (magnitude <= EPSILON) {
        return undefined;
      }

      phase = 'capturing';
      ticksCaptured = 1;
      peakMagnitude = 0;
      latestDirection = ZERO;
      recordStickSample(stick);

      if (windowTicks === 1) {
        return emitPulse();
      }

      return undefined;
    }

    ticksCaptured += 1;
    recordStickSample(stick);
    if (ticksCaptured >= windowTicks) {
      return emitPulse();
    }

    return undefined;
  };

  return {
    process(snapshot): InputProcessorResult {
      assertInputSnapshot(snapshot);

      const windowTicks = tuning.getNumber(CONTROLS_RIGHT_STICK_CAPTURE_WINDOW_TICKS_KEY);
      const neutralThreshold = tuning.getNumber(
        CONTROLS_RIGHT_STICK_NEUTRAL_THRESHOLD_KEY
      );

      if (!Number.isInteger(windowTicks) || windowTicks <= 0) {
        throw new RangeError('The right-stick capture window must be a positive integer.');
      }

      if (!Number.isFinite(neutralThreshold) || neutralThreshold < 0 || neutralThreshold >= 1) {
        throw new RangeError('The right-stick neutral threshold must be in the range [0, 1).');
      }

      const buttons = {
        low: buttonState(snapshot.buttons.low, previousLow),
        high: buttonState(snapshot.buttons.high, previousHigh),
        switch: buttonState(snapshot.buttons.switch, previousSwitch)
      };

      previousLow = snapshot.buttons.low;
      previousHigh = snapshot.buttons.high;
      previousSwitch = snapshot.buttons.switch;

      const rightStickThrow = processRightStick(
        snapshot.rightStick,
        windowTicks,
        neutralThreshold
      );

      return {
        input: {
          movement: cloneVector(snapshot.movement),
          rightStick: cloneVector(snapshot.rightStick),
          buttons
        },
        rightStickThrow,
        capture: currentCapture(windowTicks)
      };
    },

    reset(): void {
      previousLow = false;
      previousHigh = false;
      previousSwitch = false;
      resetCapture();
    }
  };
}
