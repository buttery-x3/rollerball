import type { RoutedPlayerIntent } from '../control/types';
import type { Vec2 } from '../physics/geometry';
import { PLAYER_CONTACT_DIAGNOSTIC_LAYER } from '../sim/diagnostics';
import { createFieldPlayerState, createGameState, type GameState } from '../sim/gameState';
import type { ScenarioDefinition } from './scenario';

function contactScenario(
  id: string,
  name: string,
  players: readonly { position: Vec2; velocity: Vec2 }[]
): ScenarioDefinition<GameState, RoutedPlayerIntent> {
  return {
    id,
    name,
    automatedRunTicks: 180,
    createInitialState: () => ({
      ...createGameState(),
      players: players.map((player, index) => createFieldPlayerState({
        id: `contact-${index + 1}`,
        position: player.position,
        velocity: player.velocity
      }))
    }),
    scriptedInputs: [],
    diagnosticLayerOverrides: [{ key: PLAYER_CONTACT_DIAGNOSTIC_LAYER, enabled: true }],
    assertions: [{
      id: 'finite-player-contact-state',
      check: (state) => state.players.every((player) => [
        player.position.x, player.position.y, player.velocity.x, player.velocity.y
      ].every(Number.isFinite))
    }]
  };
}

export const playerHeadOnContactScenario = contactScenario(
  'contact-head-on', 'Player contact · head-on',
  [
    { position: { x: -1.2, y: 0 }, velocity: { x: 8, y: 0 } },
    { position: { x: 1.2, y: 0 }, velocity: { x: -8, y: 0 } }
  ]
);

export const playerGlancingContactScenario = contactScenario(
  'contact-glancing', 'Player contact · glancing',
  [
    { position: { x: -1.2, y: -0.4 }, velocity: { x: 8, y: 0 } },
    { position: { x: 1.2, y: 0.4 }, velocity: { x: -8, y: 0 } }
  ]
);

export const playerStationaryContactScenario = contactScenario(
  'contact-stationary-moving', 'Player contact · stationary versus moving',
  [
    { position: { x: -2, y: 0 }, velocity: { x: 10, y: 0 } },
    { position: { x: 0, y: 0 }, velocity: { x: 0, y: 0 } }
  ]
);

export const playerCrowdedContactScenario = contactScenario(
  'contact-multiple-players', 'Player contact · crowded separation',
  [
    { position: { x: -0.4, y: -0.4 }, velocity: { x: 2, y: 2 } },
    { position: { x: 0.4, y: -0.4 }, velocity: { x: -2, y: 2 } },
    { position: { x: -0.4, y: 0.4 }, velocity: { x: 2, y: -2 } },
    { position: { x: 0.4, y: 0.4 }, velocity: { x: -2, y: -2 } }
  ]
);

export const PLAYER_CONTACT_SCENARIOS = [
  playerHeadOnContactScenario,
  playerGlancingContactScenario,
  playerStationaryContactScenario,
  playerCrowdedContactScenario
] as const;
