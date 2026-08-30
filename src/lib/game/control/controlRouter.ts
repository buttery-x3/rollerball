import type { TuningReader } from '../config/tuning';
import { cloneVector, vectorMagnitude } from './inputNormalization';
import { createInputProcessor } from './inputProcessor';
import type {
  ButtonState,
  ControlActionContext,
  ControlAssignment,
  ControlAssignmentReason,
  ControlStepResult,
  InputSnapshot,
  PlayerId,
  PlayerIntent,
  ReceiveIntent,
  RightStickThrowPulse,
  RoutedPlayerIntent
} from './types';

const EPSILON = 1e-9;
const EMPTY_BUTTON_STATE: ButtonState = {
  held: false,
  pressed: false,
  released: false
};

function assertPlayerId(playerId: PlayerId): void {
  if (!playerId.trim()) {
    throw new RangeError('A controlled player ID must have a non-empty value.');
  }
}

function cloneButtonState(state: ButtonState): ButtonState {
  return {
    held: state.held,
    pressed: state.pressed,
    released: state.released
  };
}

function emptyReceiveIntent(): ReceiveIntent {
  return {
    low: EMPTY_BUTTON_STATE,
    high: EMPTY_BUTTON_STATE,
    rightStickThrow: undefined
  };
}

export interface ControlRouterOptions {
  readonly tuning: TuningReader;
  readonly initialPlayerId?: PlayerId;
}

export interface ControlRouter {
  readonly assignment: ControlAssignment | undefined;
  consumeTick(
    snapshot: InputSnapshot,
    actionContext?: ControlActionContext
  ): ControlStepResult;
  assignPlayer(playerId: PlayerId, reason?: ControlAssignmentReason): void;
  clearAssignment(): void;
  resetInput(): void;
  reset(): void;
}

function createIntent(
  processed: ControlStepResult['input'],
  rightStickThrow: RightStickThrowPulse | undefined,
  actionContext: ControlActionContext
): PlayerIntent {
  const movement = cloneVector(processed.movement);
  const movementLength = vectorMagnitude(movement);
  const desiredFacing =
    movementLength > EPSILON
      ? { x: movement.x / movementLength, y: movement.y / movementLength }
      : undefined;

  const check =
    actionContext === 'neutral' || actionContext === 'defending'
      ? cloneButtonState(processed.buttons.low)
      : EMPTY_BUTTON_STATE;

  const receive =
    actionContext === 'receiving'
      ? {
          low: cloneButtonState(processed.buttons.low),
          high: cloneButtonState(processed.buttons.high),
          rightStickThrow: rightStickThrow
            ? {
                direction: cloneVector(rightStickThrow.direction),
                magnitude: rightStickThrow.magnitude
              }
            : undefined
        }
      : emptyReceiveIntent();

  return {
    movement,
    desiredFacing,
    actionContext,
    lowThrow:
      actionContext === 'possessed'
        ? cloneButtonState(processed.buttons.low)
        : EMPTY_BUTTON_STATE,
    highThrow:
      actionContext === 'possessed'
        ? cloneButtonState(processed.buttons.high)
        : EMPTY_BUTTON_STATE,
    check,
    rightStickThrow: actionContext === 'possessed' && rightStickThrow
      ? {
          direction: cloneVector(rightStickThrow.direction),
          magnitude: rightStickThrow.magnitude
        }
      : undefined,
    receive
  };
}

export function createControlRouter(options: ControlRouterOptions): ControlRouter {
  if (options.initialPlayerId !== undefined) {
    assertPlayerId(options.initialPlayerId);
  }

  const inputProcessor = createInputProcessor(options.tuning);
  const initialPlayerId = options.initialPlayerId;
  let currentAssignment: ControlAssignment | undefined = initialPlayerId
    ? { playerId: initialPlayerId, reason: 'initial' }
    : undefined;

  return {
    get assignment(): ControlAssignment | undefined {
      return currentAssignment ? { ...currentAssignment } : undefined;
    },

    consumeTick(snapshot, actionContext = 'neutral'): ControlStepResult {
      const processed = inputProcessor.process(snapshot);
      const intent = createIntent(processed.input, processed.rightStickThrow, actionContext);
      const routedIntent: RoutedPlayerIntent | undefined = currentAssignment
        ? {
            playerId: currentAssignment.playerId,
            intent
          }
        : undefined;

      return {
        input: processed.input,
        assignment: currentAssignment ? { ...currentAssignment } : undefined,
        routedIntent,
        capture: processed.capture
      };
    },

    assignPlayer(playerId, reason = 'manual'): void {
      assertPlayerId(playerId);
      currentAssignment = { playerId, reason };
    },

    clearAssignment(): void {
      currentAssignment = undefined;
    },

    resetInput(): void {
      inputProcessor.reset();
    },

    reset(): void {
      inputProcessor.reset();
      currentAssignment = initialPlayerId
        ? { playerId: initialPlayerId, reason: 'reset' }
        : undefined;
    }
  };
}
