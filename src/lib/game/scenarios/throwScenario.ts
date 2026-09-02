import type {
  ButtonState,
  RightStickThrowPulse,
  RoutedPlayerIntent
} from '../control/types';
import {
  MOVEMENT_FACING_RESPONSE_KEY
} from '../config/tuning';
import {
  createPlayablePossessedGameState,
  type GameState,
  type ThrowChargeFamily
} from '../sim/gameState';
import {
  BALL_DIAGNOSTIC_LAYER,
  THROW_DIAGNOSTIC_LAYER
} from '../sim/diagnostics';
import type { ScenarioDefinition, ScenarioInputFrame } from './scenario';

const EMPTY_BUTTON_STATE: ButtonState = {
  held: false,
  pressed: false,
  released: false
};

const PLAYER_ID = 'player-1';

function buttonState(
  held: boolean,
  pressed = false,
  released = false
): ButtonState {
  return { held, pressed, released };
}

function emptyReceiveIntent() {
  return {
    low: EMPTY_BUTTON_STATE,
    high: EMPTY_BUTTON_STATE,
    rightStickThrow: undefined
  };
}

export interface ThrowIntentOptions {
  readonly movement?: { readonly x: number; readonly y: number };
  readonly desiredFacing?: { readonly x: number; readonly y: number };
  readonly lowThrow?: ButtonState;
  readonly highThrow?: ButtonState;
  readonly rightStickThrow?: RightStickThrowPulse;
}

export function createThrowIntent(
  options: ThrowIntentOptions = {}
): RoutedPlayerIntent {
  return {
    playerId: PLAYER_ID,
    intent: {
      movement: options.movement ?? { x: 0, y: 0 },
      desiredFacing: options.desiredFacing,
      actionContext: 'possessed',
      lowThrow: options.lowThrow ?? EMPTY_BUTTON_STATE,
      highThrow: options.highThrow ?? EMPTY_BUTTON_STATE,
      check: EMPTY_BUTTON_STATE,
      rightStickThrow: options.rightStickThrow,
      receive: emptyReceiveIntent()
    }
  };
}

function chargeFrames(
  family: ThrowChargeFamily,
  holdTicks: number
): readonly ScenarioInputFrame<RoutedPlayerIntent>[] {
  const frames: ScenarioInputFrame<RoutedPlayerIntent>[] = [];
  for (let tick = 1; tick <= holdTicks; tick += 1) {
    frames.push({
      tick,
      input: createThrowIntent(
        family === 'low'
          ? { lowThrow: buttonState(true, tick === 1) }
          : { highThrow: buttonState(true, tick === 1) }
      )
    });
  }

  frames.push({
    tick: holdTicks + 1,
    input: createThrowIntent(
      family === 'low'
        ? { lowThrow: buttonState(false, false, true) }
        : { highThrow: buttonState(false, false, true) }
    )
  });
  return frames;
}

function validThrowState(state: GameState): void {
  const ball = state.ball;
  if (ball.mode === 'possessed') {
    if (!state.players.some((player) => player.definition.id === ball.holderId)) {
      throw new Error('Possessed ball holder is missing from the scenario state.');
    }
    return;
  }

  const values = [
    ball.position.x,
    ball.position.y,
    ball.velocity.x,
    ball.velocity.y,
    ball.height,
    ball.verticalVelocity,
    ball.release?.reacquisitionLockoutTicksRemaining ?? 0
  ];
  if (!values.every(Number.isFinite) || ball.height < 0) {
    throw new Error('Released ball state contains an invalid value.');
  }
}

function throwScenario(
  id: string,
  name: string,
  automatedRunTicks: number,
  scriptedInputs?: readonly ScenarioInputFrame<RoutedPlayerIntent>[],
  tuningOverrides?: ScenarioDefinition<GameState, RoutedPlayerIntent>['tuningOverrides']
): ScenarioDefinition<GameState, RoutedPlayerIntent> {
  return {
    id,
    name,
    automatedRunTicks,
    createInitialState: () => createPlayablePossessedGameState(),
    ...(scriptedInputs ? { scriptedInputs } : {}),
    tuningOverrides,
    diagnosticLayerOverrides: [
      { key: BALL_DIAGNOSTIC_LAYER, enabled: true },
      { key: THROW_DIAGNOSTIC_LAYER, enabled: true }
    ],
    assertions: [
      {
        id: 'valid-throw-state',
        check: validThrowState
      }
    ]
  };
}

export const THROW_FREE_PLAY_SCENARIO_ID = 'throw-possessed-free-play';
export const THROW_LOW_MIN_CHARGE_SCENARIO_ID = 'throw-low-minimum-charge';
export const THROW_LOW_MAX_CHARGE_SCENARIO_ID = 'throw-low-maximum-charge';
export const THROW_HIGH_MIN_CHARGE_SCENARIO_ID = 'throw-high-minimum-charge';
export const THROW_HIGH_MAX_CHARGE_SCENARIO_ID = 'throw-high-maximum-charge';
export const THROW_FACING_AT_RELEASE_SCENARIO_ID = 'throw-facing-at-release';
export const THROW_RIGHT_STICK_LOW_SCENARIO_ID = 'throw-right-stick-low';
export const THROW_RELEASE_LOCKOUT_SCENARIO_ID = 'throw-release-once-lockout';

export const throwFreePlayScenario = throwScenario(
  THROW_FREE_PLAY_SCENARIO_ID,
  'Throwing · possessed free play',
  1
);

export const throwLowMinimumChargeScenario = throwScenario(
  THROW_LOW_MIN_CHARGE_SCENARIO_ID,
  'Throwing · low minimum charge',
  2,
  chargeFrames('low', 1)
);

export const throwLowMaximumChargeScenario = throwScenario(
  THROW_LOW_MAX_CHARGE_SCENARIO_ID,
  'Throwing · low maximum charge',
  32,
  chargeFrames('low', 31)
);

export const throwHighMinimumChargeScenario = throwScenario(
  THROW_HIGH_MIN_CHARGE_SCENARIO_ID,
  'Throwing · high minimum charge',
  2,
  chargeFrames('high', 1)
);

export const throwHighMaximumChargeScenario = throwScenario(
  THROW_HIGH_MAX_CHARGE_SCENARIO_ID,
  'Throwing · high maximum charge',
  32,
  chargeFrames('high', 31)
);

export const throwFacingAtReleaseScenario = throwScenario(
  THROW_FACING_AT_RELEASE_SCENARIO_ID,
  'Throwing · facing at release',
  3,
  [
    {
      tick: 1,
      input: createThrowIntent({
        lowThrow: buttonState(true, true),
        movement: { x: 0, y: 1 }
      })
    },
    {
      tick: 2,
      input: createThrowIntent({
        lowThrow: buttonState(true),
        movement: { x: 1, y: 0 }
      })
    },
    {
      tick: 3,
      input: createThrowIntent({
        lowThrow: buttonState(false, false, true)
      })
    }
  ],
  [{ key: MOVEMENT_FACING_RESPONSE_KEY, value: 60 }]
);

export const throwRightStickLowScenario = throwScenario(
  THROW_RIGHT_STICK_LOW_SCENARIO_ID,
  'Throwing · right-stick low release',
  1,
  [
    {
      tick: 1,
      input: createThrowIntent({
        rightStickThrow: {
          direction: { x: 1, y: 0 },
          magnitude: 0.75
        }
      })
    }
  ]
);

export const throwReleaseLockoutScenario = throwScenario(
  THROW_RELEASE_LOCKOUT_SCENARIO_ID,
  'Throwing · exactly one release and lockout',
  4,
  [
    {
      tick: 1,
      input: createThrowIntent({ lowThrow: buttonState(true, true) })
    },
    {
      tick: 2,
      input: createThrowIntent({ lowThrow: buttonState(true) })
    },
    {
      tick: 3,
      input: createThrowIntent({ lowThrow: buttonState(false, false, true) })
    },
    {
      tick: 4,
      input: createThrowIntent()
    }
  ]
);

export const THROW_SCENARIOS: readonly ScenarioDefinition<
  GameState,
  RoutedPlayerIntent
>[] = [
  throwFreePlayScenario,
  throwLowMinimumChargeScenario,
  throwLowMaximumChargeScenario,
  throwHighMinimumChargeScenario,
  throwHighMaximumChargeScenario,
  throwFacingAtReleaseScenario,
  throwRightStickLowScenario,
  throwReleaseLockoutScenario
];
