import { RUNTIME_DIAGNOSTIC_LAYER } from '../sim/diagnostics';
import { createGameState, type GameState } from '../sim/gameState';
import type { RoutedPlayerIntent } from '../control/types';
import type { ScenarioDefinition } from './scenario';
import { PLAYER_MOVEMENT_SCENARIOS } from './playerMovementScenario';

export const DETERMINISTIC_TICK_SCENARIO_ID = 'deterministic-tick';

export const deterministicTickScenario: ScenarioDefinition<GameState, RoutedPlayerIntent> = {
  id: DETERMINISTIC_TICK_SCENARIO_ID,
  name: 'Deterministic tick',
  createInitialState: createGameState,
  diagnosticLayerOverrides: [{ key: RUNTIME_DIAGNOSTIC_LAYER, enabled: true }],
  assertions: [
    {
      id: 'tick-advances-once',
      check: (state, tick) => {
        if (state.tick !== tick) {
          throw new Error(`Expected state.tick to be ${tick}, received ${state.tick}.`);
        }
      }
    }
  ]
};

export const DEFAULT_SCENARIOS: readonly ScenarioDefinition<
  GameState,
  RoutedPlayerIntent
>[] = [deterministicTickScenario, ...PLAYER_MOVEMENT_SCENARIOS];

export function getScenario(
  id: string
): ScenarioDefinition<GameState, RoutedPlayerIntent> {
  const scenario = DEFAULT_SCENARIOS.find((candidate) => candidate.id === id);
  if (!scenario) {
    throw new Error(`Unknown scenario '${id}'.`);
  }

  return scenario;
}
