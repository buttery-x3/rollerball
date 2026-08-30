import { RUNTIME_DIAGNOSTIC_LAYER } from '../sim/diagnostics';
import { createGameState, type GameState } from '../sim/gameState';
import type { ScenarioDefinition } from './scenario';

export const DETERMINISTIC_TICK_SCENARIO_ID = 'deterministic-tick';

export const DEFAULT_SCENARIOS: readonly ScenarioDefinition<GameState, unknown>[] = [
  {
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
  }
];

export function getScenario(id: string): ScenarioDefinition<GameState, unknown> {
  const scenario = DEFAULT_SCENARIOS.find((candidate) => candidate.id === id);
  if (!scenario) {
    throw new Error(`Unknown scenario '${id}'.`);
  }

  return scenario;
}
