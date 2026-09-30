import type { RoutedPlayerIntent } from '../control/types';
import {
  createFieldPlayerState,
  createLooseBallState,
  createPlayablePossessedGameState,
  type GameState
} from '../sim/gameState';
import {
  BALL_DIAGNOSTIC_LAYER,
  PLAYER_MOVEMENT_DIAGNOSTIC_LAYER,
  RECEIVE_DIAGNOSTIC_LAYER,
  THROW_DIAGNOSTIC_LAYER
} from '../sim/diagnostics';
import { createRoutedMovementIntent } from './playerMovementScenario';
import { createReceivingIntent } from './receivingScenario';
import { createThrowIntent } from './throwScenario';
import type { ScenarioDefinition, ScenarioInputFrame } from './scenario';

const layers = [PLAYER_MOVEMENT_DIAGNOSTIC_LAYER, BALL_DIAGNOSTIC_LAYER,
  THROW_DIAGNOSTIC_LAYER, RECEIVE_DIAGNOSTIC_LAYER].map((key) => ({ key, enabled: true }));

const assertions = [{
  id: 'finite-state-and-bounded-attributes',
  check(state: GameState) {
    for (const player of state.players) {
      const numbers = [player.position.x, player.position.y, player.velocity.x,
        player.velocity.y, player.facing.x, player.facing.y];
      if (!numbers.every(Number.isFinite) ||
          !Object.values(player.definition.attributes).every((value) => value >= 0 && value <= 100)) {
        throw new Error('Invalid attribute scenario player state.');
      }
    }
    if (state.ball.mode === 'loose' && ![
      state.ball.position.x, state.ball.position.y, state.ball.velocity.x,
      state.ball.velocity.y, state.ball.height, state.ball.verticalVelocity
    ].every(Number.isFinite)) {
      throw new Error('Invalid attribute scenario ball state.');
    }
  }
}];

export function createAttributeMovementScenario(
  attribute: 'speed' | 'agility',
  value: number
): ScenarioDefinition<GameState, RoutedPlayerIntent> {
  const scriptedInputs = Array.from({ length: 150 }, (_, index) => ({
    tick: index + 1,
    input: createRoutedMovementIntent(index < 30 ? { x: 0, y: 1 }
      : index < 60 ? { x: 1, y: 0 }
      : index < 120 ? { x: -1, y: 0 } : { x: 0, y: 0 })
  }));
  return {
    id: `attributes-${attribute}-${value}`,
    name: `Attributes · ${attribute} ${value} · accelerate, turn, reverse, stop`,
    automatedRunTicks: 150,
    createInitialState: () => createPlayablePossessedGameState({
      position: { x: 0, y: -8 }, attributes: { [attribute]: value }
    }),
    scriptedInputs,
    diagnosticLayerOverrides: layers,
    assertions
  };
}

export function createAttributeThrowScenario(
  power: number,
  family: 'low' | 'high',
  oneTouch = false,
  rightStick = false
): ScenarioDefinition<GameState, RoutedPlayerIntent> {
  const kind = `${oneTouch ? 'one-touch-' : ''}${rightStick ? 'right-stick' : family}`;
  const held = { held: true, pressed: true, released: false };
  const released = { held: false, pressed: false, released: true };
  let inputs: readonly ScenarioInputFrame<RoutedPlayerIntent>[];
  if (oneTouch) {
    inputs = [{ tick: 1, input: createReceivingIntent(rightStick
      ? { rightStickThrow: { direction: { x: 0, y: 1 }, magnitude: 1 } }
      : { [family]: held }) }];
  } else if (rightStick) {
    inputs = [{ tick: 1, input: createThrowIntent({
      rightStickThrow: { direction: { x: 0, y: 1 }, magnitude: 1 }
    }) }];
  } else {
    inputs = [
      ...Array.from({ length: 31 }, (_, index) => ({
        tick: index + 1,
        input: createThrowIntent({ [`${family}Throw`]: { ...held, pressed: index === 0 } })
      })),
      { tick: 32, input: createThrowIntent({ [`${family}Throw`]: released }) }
    ];
  }
  return {
    id: `attributes-power-${power}-${kind}`,
    name: `Attributes · power ${power} · ${kind}`,
    automatedRunTicks: oneTouch || rightStick ? 1 : 32,
    createInitialState: () => oneTouch ? {
      tick: 0,
      players: [createFieldPlayerState({ attributes: { power } })],
      ball: createLooseBallState({ position: { x: 0, y: -0.95 }, velocity: { x: 0, y: 10 } })
    } : createPlayablePossessedGameState({ attributes: { power } }),
    scriptedInputs: inputs,
    diagnosticLayerOverrides: layers,
    assertions
  };
}

export const PLAYER_ATTRIBUTE_SCENARIOS: readonly ScenarioDefinition<GameState, RoutedPlayerIntent>[] = [
  ...(['speed', 'agility'] as const).flatMap((attribute) =>
    [0, 100].map((value) => createAttributeMovementScenario(attribute, value))),
  ...([false, true]).flatMap((oneTouch) =>
    (['low', 'high'] as const).flatMap((family) =>
      [0, 100].map((power) => createAttributeThrowScenario(power, family, oneTouch))))
];
