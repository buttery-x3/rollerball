import type {
  ButtonState,
  RightStickThrowPulse,
  RoutedPlayerIntent
} from '../control/types';
import {
  BALL_LOW_THROW_MAX_SPEED_KEY,
  BALL_LOW_THROW_MIN_SPEED_KEY
} from '../config/tuning';
import {
  createFieldPlayerState,
  createLooseBallState,
  createPlayablePossessedGameState,
  type GameState
} from '../sim/gameState';
import {
  BALL_DIAGNOSTIC_LAYER,
  RECEIVE_DIAGNOSTIC_LAYER,
  THROW_DIAGNOSTIC_LAYER
} from '../sim/diagnostics';
import { createThrowIntent } from './throwScenario';
import type { ScenarioDefinition, ScenarioInputFrame } from './scenario';

const EMPTY_BUTTON_STATE: ButtonState = {
  held: false,
  pressed: false,
  released: false
};
const RECEIVER_ID = 'player-1';

function buttonState(
  held: boolean,
  pressed = false,
  released = false
): ButtonState {
  return { held, pressed, released };
}

export interface ReceivingIntentOptions {
  readonly playerId?: string;
  readonly low?: ButtonState;
  readonly high?: ButtonState;
  readonly rightStickThrow?: RightStickThrowPulse;
}

export function createReceivingIntent(
  options: ReceivingIntentOptions = {}
): RoutedPlayerIntent {
  return {
    playerId: options.playerId ?? RECEIVER_ID,
    intent: {
      movement: { x: 0, y: 0 },
      desiredFacing: undefined,
      actionContext: 'receiving',
      lowThrow: EMPTY_BUTTON_STATE,
      highThrow: EMPTY_BUTTON_STATE,
      check: EMPTY_BUTTON_STATE,
      rightStickThrow: undefined,
      receive: {
        low: options.low ?? EMPTY_BUTTON_STATE,
        high: options.high ?? EMPTY_BUTTON_STATE,
        rightStickThrow: options.rightStickThrow
      }
    }
  };
}

function createReceivingState(
  ball: Parameters<typeof createLooseBallState>[0],
  facing = { x: 1, y: 0 }
): GameState {
  return {
    tick: 0,
    players: [
      createFieldPlayerState({
        id: RECEIVER_ID,
        teamId: 'opponent',
        position: { x: 0, y: 0 },
        facing
      })
    ],
    ball: createLooseBallState(ball)
  };
}

function createIncomingWorkbenchState(): GameState {
  return {
    tick: 0,
    players: [
      createFieldPlayerState({
        id: RECEIVER_ID,
        teamId: 'opponent',
        position: { x: 0, y: 0 },
        facing: { x: 1, y: 0 }
      }),
      createFieldPlayerState({
        id: 'player-2',
        teamId: 'human',
        position: { x: 6, y: 8 },
        facing: { x: 0, y: -1 }
      })
    ],
    ball: createLooseBallState({
      position: { x: 0, y: -5 },
      velocity: { x: 0, y: 14 },
      height: 0,
      release: {
        releasedById: 'player-2',
        reacquisitionLockoutTicksRemaining: 6
      }
    })
  };
}

function validReceivingState(state: GameState): void {
  const ball = state.ball;
  if (ball.mode === 'possessed') {
    if (!state.players.some((player) => player.definition.id === ball.holderId)) {
      throw new Error('Possessed ball holder is missing from the receiving scenario.');
    }
  } else {
    const values = [
      ball.position.x,
      ball.position.y,
      ball.velocity.x,
      ball.velocity.y,
      ball.height,
      ball.verticalVelocity
    ];
    if (!values.every(Number.isFinite) || ball.height < 0) {
      throw new Error('Receiving scenario loose-ball state is invalid.');
    }
  }

  for (const player of state.players) {
    const charge = player.oneTouch.charge;
    const buffer = player.oneTouch.buffer;
    if (
      ![
        charge.elapsedSeconds,
        charge.strength,
        charge.progress,
        buffer?.magnitude ?? 0,
        buffer?.ticksRemaining ?? 0
      ].every(Number.isFinite)
    ) {
      throw new Error(`Player '${player.definition.id}' has invalid one-touch state.`);
    }
  }
}

function receivingScenario(
  id: string,
  name: string,
  automatedRunTicks: number,
  createInitialState: () => GameState,
  scriptedInputs?: readonly ScenarioInputFrame<RoutedPlayerIntent>[]
): ScenarioDefinition<GameState, RoutedPlayerIntent> {
  return {
    id,
    name,
    automatedRunTicks,
    createInitialState,
    ...(scriptedInputs ? { scriptedInputs } : {}),
    diagnosticLayerOverrides: [
      { key: BALL_DIAGNOSTIC_LAYER, enabled: true },
      { key: RECEIVE_DIAGNOSTIC_LAYER, enabled: true }
    ],
    assertions: [{ id: 'valid-receiving-state', check: validReceivingState }]
  };
}

function heldFrames(
  family: 'low' | 'high',
  endTick: number
): readonly ScenarioInputFrame<RoutedPlayerIntent>[] {
  return Array.from({ length: endTick }, (_, index) => {
    const tick = index + 1;
    return {
      tick,
      input: createReceivingIntent(
        family === 'low'
          ? { low: buttonState(true, tick === 1) }
          : { high: buttonState(true, tick === 1) }
      )
    };
  });
}

function cancellationFrames(
  family: 'low' | 'high'
): readonly ScenarioInputFrame<RoutedPlayerIntent>[] {
  return [
    {
      tick: 1,
      input: createReceivingIntent(
        family === 'low'
          ? { low: buttonState(true, true) }
          : { high: buttonState(true, true) }
      )
    },
    {
      tick: 2,
      input: createReceivingIntent(
        family === 'low'
          ? { low: buttonState(false, false, true) }
          : { high: buttonState(false, false, true) }
      )
    }
  ];
}

export const RECEIVE_EASY_PICKUP_SCENARIO_ID = 'receive-easy-pickup';
export const RECEIVE_LOCKOUT_REACQUISITION_SCENARIO_ID =
  'receive-full-lockout-then-reacquire';
export const RECEIVE_INCOMING_WORKBENCH_SCENARIO_ID =
  'receive-incoming-workbench';
export const RECEIVE_ABOVE_CATCH_HEIGHT_SCENARIO_ID =
  'receive-above-catch-height';
export const RECEIVE_LOW_ONE_TOUCH_SCENARIO_ID = 'receive-low-one-touch';
export const RECEIVE_HIGH_ONE_TOUCH_SCENARIO_ID = 'receive-high-one-touch';
export const RECEIVE_RIGHT_STICK_ONE_TOUCH_SCENARIO_ID =
  'receive-buffered-right-stick-one-touch';
export const RECEIVE_LOW_CANCEL_SCENARIO_ID =
  'receive-low-release-before-contact';
export const RECEIVE_HIGH_CANCEL_SCENARIO_ID =
  'receive-high-release-before-contact';

export const receiveEasyPickupScenario = receivingScenario(
  RECEIVE_EASY_PICKUP_SCENARIO_ID,
  'Receiving · easy pickup',
  1,
  () => createReceivingState({ position: { x: 0, y: 0 }, height: 0 }),
  []
);

export const receiveLockoutReacquisitionScenario: ScenarioDefinition<
  GameState,
  RoutedPlayerIntent
> = {
  id: RECEIVE_LOCKOUT_REACQUISITION_SCENARIO_ID,
  name: 'Receiving · full release lockout then reacquire',
  automatedRunTicks: 8,
  createInitialState: createPlayablePossessedGameState,
  scriptedInputs: [
    {
      tick: 1,
      input: createThrowIntent({
        lowThrow: buttonState(true, true)
      })
    },
    {
      tick: 2,
      input: createThrowIntent({
        lowThrow: buttonState(false, false, true)
      })
    }
  ],
  tuningOverrides: [
    { key: BALL_LOW_THROW_MIN_SPEED_KEY, value: 0 },
    { key: BALL_LOW_THROW_MAX_SPEED_KEY, value: 0 }
  ],
  diagnosticLayerOverrides: [
    { key: BALL_DIAGNOSTIC_LAYER, enabled: true },
    { key: THROW_DIAGNOSTIC_LAYER, enabled: true },
    { key: RECEIVE_DIAGNOSTIC_LAYER, enabled: true }
  ],
  assertions: [
    { id: 'valid-receiving-state', check: validReceivingState }
  ]
};

export const receiveIncomingWorkbenchScenario: ScenarioDefinition<
  GameState,
  RoutedPlayerIntent
> = {
  ...receivingScenario(
    RECEIVE_INCOMING_WORKBENCH_SCENARIO_ID,
    'Receiving · incoming ball workbench',
    24,
    createIncomingWorkbenchState
  ),
  interactiveActionContext: 'receiving'
};

export const receiveAboveCatchHeightScenario = receivingScenario(
  RECEIVE_ABOVE_CATCH_HEIGHT_SCENARIO_ID,
  'Receiving · ball passes above catch height',
  1,
  () =>
    createReceivingState({
      position: { x: 0, y: -3 },
      velocity: { x: 0, y: 240 },
      height: 2.5
    }),
  []
);

export const receiveLowOneTouchScenario = receivingScenario(
  RECEIVE_LOW_ONE_TOUCH_SCENARIO_ID,
  'Receiving · low button one-touch',
  11,
  () =>
    createReceivingState({
      position: { x: 0, y: -3 },
      velocity: { x: 0, y: 12 },
      height: 0
    }),
  heldFrames('low', 11)
);

export const receiveHighOneTouchScenario = receivingScenario(
  RECEIVE_HIGH_ONE_TOUCH_SCENARIO_ID,
  'Receiving · high button one-touch',
  11,
  () =>
    createReceivingState({
      position: { x: 0, y: -3 },
      velocity: { x: 0, y: 12 },
      height: 0
    }),
  heldFrames('high', 11)
);

export const receiveRightStickOneTouchScenario = receivingScenario(
  RECEIVE_RIGHT_STICK_ONE_TOUCH_SCENARIO_ID,
  'Receiving · buffered right-stick one-touch',
  4,
  () =>
    createReceivingState({
      position: { x: 0, y: -1.55 },
      velocity: { x: 0, y: 12 },
      height: 0
    }),
  [
    {
      tick: 1,
      input: createReceivingIntent({
        rightStickThrow: {
          direction: { x: -1, y: 0 },
          magnitude: 0.75
        }
      })
    }
  ]
);

export const receiveLowCancelScenario = receivingScenario(
  RECEIVE_LOW_CANCEL_SCENARIO_ID,
  'Receiving · low release cancels before contact',
  6,
  () =>
    createReceivingState({
      position: { x: 0, y: -2 },
      velocity: { x: 0, y: 12 },
      height: 0
    }),
  cancellationFrames('low')
);

export const receiveHighCancelScenario = receivingScenario(
  RECEIVE_HIGH_CANCEL_SCENARIO_ID,
  'Receiving · high release cancels before contact',
  6,
  () =>
    createReceivingState({
      position: { x: 0, y: -2 },
      velocity: { x: 0, y: 12 },
      height: 0
    }),
  cancellationFrames('high')
);

export const RECEIVING_SCENARIOS: readonly ScenarioDefinition<
  GameState,
  RoutedPlayerIntent
>[] = [
  receiveEasyPickupScenario,
  receiveLockoutReacquisitionScenario,
  receiveIncomingWorkbenchScenario,
  receiveAboveCatchHeightScenario,
  receiveLowOneTouchScenario,
  receiveHighOneTouchScenario,
  receiveRightStickOneTouchScenario,
  receiveLowCancelScenario,
  receiveHighCancelScenario
];
