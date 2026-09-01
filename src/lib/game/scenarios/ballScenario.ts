import type { RoutedPlayerIntent } from '../control/types';
import type { CreateLooseBallOptions, GameState } from '../sim/gameState';
import { createGameState, createLooseBallState } from '../sim/gameState';
import { BALL_DIAGNOSTIC_LAYER } from '../sim/diagnostics';
import type { ScenarioDefinition } from './scenario';

function createBallState(options: CreateLooseBallOptions): GameState {
  return {
    ...createGameState(),
    ball: createLooseBallState(options)
  };
}

function finiteBallStateAssertion(state: GameState): void {
  const { ball } = state;
  const values = [
    ball.position.x,
    ball.position.y,
    ball.velocity.x,
    ball.velocity.y,
    ball.height,
    ball.verticalVelocity
  ];

  if (ball.mode !== 'loose' || !values.every(Number.isFinite) || ball.height < 0) {
    throw new Error('Loose ball state contains an invalid value.');
  }
}

function ballScenario(
  id: string,
  name: string,
  ball: CreateLooseBallOptions
): ScenarioDefinition<GameState, RoutedPlayerIntent> {
  return {
    id,
    name,
    createInitialState: () => createBallState(ball),
    scriptedInputs: [],
    diagnosticLayerOverrides: [{ key: BALL_DIAGNOSTIC_LAYER, enabled: true }],
    assertions: [
      {
        id: 'finite-loose-ball-state',
        check: finiteBallStateAssertion
      }
    ]
  };
}

export const BALL_LOW_WALL_REBOUND_SCENARIO_ID = 'ball-low-wall-rebound';
export const BALL_MAX_SPEED_SWEEP_SCENARIO_ID = 'ball-maximum-speed-wall-sweep';
export const BALL_VALID_LOW_APERTURE_SCENARIO_ID = 'ball-centred-valid-low-aperture';
export const BALL_DIAGONAL_NEAR_POST_SCENARIO_ID = 'ball-diagonal-near-post-miss';
export const BALL_RISING_NEAR_CROSSBAR_SCENARIO_ID =
  'ball-rising-near-crossbar-miss';
export const BALL_VALID_SLOW_APERTURE_SCENARIO_ID = 'ball-valid-slow-aperture';
export const BALL_LOB_FLIGHT_SCENARIO_ID = 'ball-lob-flight-and-landing';
export const BALL_OVER_CROSSBAR_SCENARIO_ID = 'ball-over-crossbar-end-wall';

export const ballLowWallReboundScenario = ballScenario(
  BALL_LOW_WALL_REBOUND_SCENARIO_ID,
  'Loose ball · low wall rebound',
  {
    position: { x: 8.2, y: 0 },
    velocity: { x: 40, y: 2 },
    height: 0
  }
);

export const ballMaximumSpeedSweepScenario = ballScenario(
  BALL_MAX_SPEED_SWEEP_SCENARIO_ID,
  'Loose ball · maximum-speed wall sweep',
  {
    position: { x: 8, y: 0 },
    velocity: { x: 240, y: 0 },
    height: 0
  }
);

export const ballValidLowApertureScenario = ballScenario(
  BALL_VALID_LOW_APERTURE_SCENARIO_ID,
  'Loose ball · centred valid low aperture crossing',
  {
    position: { x: 0, y: 14 },
    velocity: { x: 0, y: 60 },
    height: 0
  }
);

export const ballDiagonalNearPostScenario = ballScenario(
  BALL_DIAGONAL_NEAR_POST_SCENARIO_ID,
  'Loose ball · diagonal near-post miss',
  {
    position: { x: 3.4, y: 14 },
    velocity: { x: 30, y: 60 },
    height: 0
  }
);

export const ballRisingNearCrossbarScenario = ballScenario(
  BALL_RISING_NEAR_CROSSBAR_SCENARIO_ID,
  'Loose ball · rising near-crossbar miss',
  {
    position: { x: 0, y: 14 },
    velocity: { x: 0, y: 60 },
    height: 2.2,
    verticalVelocity: 20
  }
);

export const ballValidSlowApertureScenario = ballScenario(
  BALL_VALID_SLOW_APERTURE_SCENARIO_ID,
  'Loose ball · valid slow goal-aperture crossing',
  {
    position: { x: 0, y: 14 },
    velocity: { x: 0, y: 20 },
    height: 0
  }
);

export const ballLobFlightScenario = ballScenario(
  BALL_LOB_FLIGHT_SCENARIO_ID,
  'Loose ball · lob flight and landing',
  {
    position: { x: -3, y: 0 },
    velocity: { x: 2, y: 6 },
    height: 0,
    verticalVelocity: 18
  }
);

export const ballOverCrossbarScenario = ballScenario(
  BALL_OVER_CROSSBAR_SCENARIO_ID,
  'Loose ball · over-crossbar end-wall rebound',
  {
    position: { x: 0, y: 14 },
    velocity: { x: 0, y: 60 },
    height: 2.5
  }
);

export const BALL_SCENARIOS: readonly ScenarioDefinition<
  GameState,
  RoutedPlayerIntent
>[] = [
  ballLowWallReboundScenario,
  ballMaximumSpeedSweepScenario,
  ballValidLowApertureScenario,
  ballDiagonalNearPostScenario,
  ballRisingNearCrossbarScenario,
  ballValidSlowApertureScenario,
  ballLobFlightScenario,
  ballOverCrossbarScenario
];
