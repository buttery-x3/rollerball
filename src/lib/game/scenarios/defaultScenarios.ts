import { RUNTIME_DIAGNOSTIC_LAYER } from '../sim/diagnostics';
import { createGameState, type GameState } from '../sim/gameState';
import type { RoutedPlayerIntent } from '../control/types';
import type { ScenarioDefinition } from './scenario';
import { PLAYER_MOVEMENT_SCENARIOS } from './playerMovementScenario';
import { BALL_SCENARIOS } from './ballScenario';
import { THROW_SCENARIOS } from './throwScenario';
import { RECEIVING_SCENARIOS } from './receivingScenario';
import { SCORING_SCENARIOS } from './scoringScenario';
import { PLAYER_ATTRIBUTE_SCENARIOS } from './playerAttributesScenario';
import { PLAYER_CONTACT_SCENARIOS } from './playerContactScenario';
import { CHECK_SCENARIOS } from './checkScenario';
import { CONTROL_RECEIVING_SCENARIOS } from './controlReceivingScenario';
import { GOALKEEPER_SCENARIOS } from './goalkeeperScenario';
import { TEAM_CONTROL_SCENARIOS } from './teamControlScenario';
import { AI_CANDIDATE_SCENARIOS } from './aiCandidateScenario';

export const DETERMINISTIC_TICK_SCENARIO_ID = 'deterministic-tick';

export const deterministicTickScenario: ScenarioDefinition<GameState, RoutedPlayerIntent> = {
  id: DETERMINISTIC_TICK_SCENARIO_ID,
  name: 'Deterministic tick',
  automatedRunTicks: 1,
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
>[] = [
  deterministicTickScenario,
  ...PLAYER_MOVEMENT_SCENARIOS,
  ...BALL_SCENARIOS,
  ...THROW_SCENARIOS,
  ...RECEIVING_SCENARIOS,
  ...SCORING_SCENARIOS,
  ...PLAYER_ATTRIBUTE_SCENARIOS,
  ...PLAYER_CONTACT_SCENARIOS,
  ...CHECK_SCENARIOS,
  ...CONTROL_RECEIVING_SCENARIOS,
  ...GOALKEEPER_SCENARIOS,
  ...TEAM_CONTROL_SCENARIOS,
  ...AI_CANDIDATE_SCENARIOS
];

export function getScenario(
  id: string
): ScenarioDefinition<GameState, RoutedPlayerIntent> {
  const scenario = DEFAULT_SCENARIOS.find((candidate) => candidate.id === id);
  if (!scenario) {
    throw new Error(`Unknown scenario '${id}'.`);
  }

  return scenario;
}
