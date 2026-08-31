import type { RoutedPlayerIntent, PlayerIntent } from '../control/types';
import {
  createPlayableGameState,
  type GameState,
  type PlayerState
} from '../sim/gameState';
import type { Vec2 } from '../physics/geometry';
import { PLAYER_MOVEMENT_DIAGNOSTIC_LAYER } from '../sim/diagnostics';
import type { ScenarioDefinition, ScenarioInputFrame } from './scenario';

const PLAYER_ID = 'player-1';
const EPSILON = 1e-9;
const EMPTY_BUTTON_STATE = { held: false, pressed: false, released: false } as const;

function movementDirection(movement: Vec2): Vec2 | undefined {
  const magnitude = Math.hypot(movement.x, movement.y);
  if (magnitude <= EPSILON) {
    return undefined;
  }

  return { x: movement.x / magnitude, y: movement.y / magnitude };
}

function createIntent(movement: Vec2): PlayerIntent {
  return {
    movement: { ...movement },
    desiredFacing: movementDirection(movement),
    actionContext: 'neutral',
    lowThrow: EMPTY_BUTTON_STATE,
    highThrow: EMPTY_BUTTON_STATE,
    check: EMPTY_BUTTON_STATE,
    rightStickThrow: undefined,
    receive: {
      low: EMPTY_BUTTON_STATE,
      high: EMPTY_BUTTON_STATE,
      rightStickThrow: undefined
    }
  };
}

export function createRoutedMovementIntent(movement: Vec2): RoutedPlayerIntent {
  return {
    playerId: PLAYER_ID,
    intent: createIntent(movement)
  };
}

function movementFrames(
  startTick: number,
  endTick: number,
  movement: Vec2
): readonly ScenarioInputFrame<RoutedPlayerIntent>[] {
  return Array.from({ length: endTick - startTick + 1 }, (_, index) => ({
    tick: startTick + index,
    input: createRoutedMovementIntent(movement)
  }));
}

function player(state: GameState): PlayerState {
  const result = state.players.find((candidate) => candidate.definition.id === PLAYER_ID);
  if (!result) {
    throw new Error(`Movement scenario player '${PLAYER_ID}' is missing.`);
  }

  return result;
}

function finitePlayerStateAssertion(state: GameState): void {
  for (const currentPlayer of state.players) {
    const values = [
      currentPlayer.position.x,
      currentPlayer.position.y,
      currentPlayer.velocity.x,
      currentPlayer.velocity.y,
      currentPlayer.facing.x,
      currentPlayer.facing.y
    ];
    if (!values.every(Number.isFinite)) {
      throw new Error(`Player '${currentPlayer.definition.id}' contains a non-finite value.`);
    }

    const facingLength = Math.hypot(currentPlayer.facing.x, currentPlayer.facing.y);
    if (Math.abs(facingLength - 1) > 1e-6) {
      throw new Error(`Player '${currentPlayer.definition.id}' facing is not normalized.`);
    }
  }
}

function movementScenario(
  id: string,
  name: string,
  scriptedInputs: readonly ScenarioInputFrame<RoutedPlayerIntent>[],
  createInitialState: () => GameState = createPlayableGameState
): ScenarioDefinition<GameState, RoutedPlayerIntent> {
  return {
    id,
    name,
    createInitialState,
    scriptedInputs,
    diagnosticLayerOverrides: [
      { key: PLAYER_MOVEMENT_DIAGNOSTIC_LAYER, enabled: true }
    ],
    assertions: [
      {
        id: 'finite-normalized-player-state',
        check: finitePlayerStateAssertion
      }
    ]
  };
}

export const MOVEMENT_ACCELERATION_SCENARIO_ID = 'movement-acceleration-coast-stop';
export const MOVEMENT_REVERSAL_SCENARIO_ID = 'movement-hard-reversal';
export const MOVEMENT_TURN_SCENARIO_ID = 'movement-maximum-speed-turn';
export const MOVEMENT_BOUNDARY_SCENARIO_ID = 'movement-arena-boundary';
export const MOVEMENT_FREE_PLAY_SCENARIO_ID = 'movement-free-play';

export const movementFreePlayScenario: ScenarioDefinition<
  GameState,
  RoutedPlayerIntent
> = {
  id: MOVEMENT_FREE_PLAY_SCENARIO_ID,
  name: 'Field movement · free play',
  createInitialState: createPlayableGameState,
  diagnosticLayerOverrides: [
    { key: PLAYER_MOVEMENT_DIAGNOSTIC_LAYER, enabled: true }
  ],
  assertions: [
    {
      id: 'finite-normalized-player-state',
      check: finitePlayerStateAssertion
    }
  ]
};

export const movementAccelerationScenario = movementScenario(
  MOVEMENT_ACCELERATION_SCENARIO_ID,
  'Field movement · acceleration, coast and stop',
  [
    ...movementFrames(1, 30, { x: 0, y: 1 }),
    { tick: 31, input: createRoutedMovementIntent({ x: 0, y: 0 }) }
  ]
);

export const movementReversalScenario = movementScenario(
  MOVEMENT_REVERSAL_SCENARIO_ID,
  'Field movement · hard reversal',
  [
    ...movementFrames(1, 30, { x: 0, y: 1 }),
    ...movementFrames(31, 120, { x: 0, y: -1 })
  ]
);

export const movementMaximumSpeedTurnScenario = movementScenario(
  MOVEMENT_TURN_SCENARIO_ID,
  'Field movement · maximum-speed turn',
  [
    ...movementFrames(1, 60, { x: 0, y: 1 }),
    ...movementFrames(61, 120, { x: 1, y: 0 })
  ]
);

function createBoundaryState(): GameState {
  return createPlayableGameState({
    position: { x: 8.2, y: 0 },
    velocity: { x: 8, y: 0 }
  });
}

export const movementArenaBoundaryScenario = movementScenario(
  MOVEMENT_BOUNDARY_SCENARIO_ID,
  'Field movement · arena boundary contact',
  [{ tick: 1, input: createRoutedMovementIntent({ x: 1, y: 0 }) }],
  createBoundaryState
);

export const PLAYER_MOVEMENT_SCENARIOS: readonly ScenarioDefinition<
  GameState,
  RoutedPlayerIntent
>[] = [
  movementFreePlayScenario,
  movementAccelerationScenario,
  movementReversalScenario,
  movementMaximumSpeedTurnScenario,
  movementArenaBoundaryScenario
];

export function getMovementScenarioPlayer(state: GameState): PlayerState {
  return player(state);
}
