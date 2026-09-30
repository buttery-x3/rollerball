import type { SpatialCandidateOptions } from '../ai/tacticalCandidates';
import type { RoutedPlayerIntent } from '../control/types';
import { createPossessedBallState, type GameState } from '../sim/gameState';
import { createMatchState } from '../sim/match';
import { createTeamGameState } from '../sim/teams';
import type { ScenarioDefinition } from './scenario';

type CandidateSetup = 'open-support' | 'invalid-options' | 'stable-support';

function candidateState(setup: CandidateSetup): GameState {
  const state = createTeamGameState();
  const positions: Record<string, { x: number; y: number }> = {
    'player-1': { x: 0, y: -5 },
    'player-2': { x: 0, y: 0 },
    'player-3': { x: 4, y: 5 },
    'player-4': { x: 6, y: 3 },
    'opponent-1': { x: -7, y: 9 },
    'opponent-2': { x: 7, y: 9 },
    'opponent-3': { x: -7, y: -9 },
    'opponent-4': { x: 7, y: -9 },
    'human-keeper': { x: 0, y: -13 },
    'opponent-keeper': { x: 0, y: 13 }
  };
  if (setup === 'invalid-options') positions['opponent-1'] = { x: 0, y: -0.5 };
  if (setup === 'stable-support') {
    positions['player-3'] = { x: -7, y: 6 };
    positions['player-4'] = { x: 7, y: 6 };
  }
  for (const player of state.players) {
    player.position = positions[player.definition.id];
    player.velocity = { x: 0, y: 0 };
    player.facing = { x: 0, y: player.definition.teamId === 'human' ? 1 : -1 };
  }
  state.ball = createPossessedBallState('player-1');
  state.match = createMatchState(state.players);
  return state;
}

function candidateScenario(setup: CandidateSetup, label: string): ScenarioDefinition<GameState, RoutedPlayerIntent> {
  return {
    id: `ai-candidates-${setup}`,
    name: `AI candidates · ${label}`,
    automatedRunTicks: 30,
    createInitialState: () => candidateState(setup),
    interactiveActionContext: 'possessed',
    diagnosticLayerOverrides: [{ key: 'ai', enabled: true }, { key: 'aiScores', enabled: true }],
    assertions: [{
      id: 'candidate-preview-preserves-team-state',
      check: (state) => state.players.length === 10 &&
        state.players.every((player) => [player.position.x, player.position.y].every(Number.isFinite))
    }]
  };
}

export const aiOpenSupportScenario = candidateScenario('open-support', 'open support beats crowding');
export const aiInvalidOptionsScenario = candidateScenario('invalid-options', 'invalid and blocked options');
export const aiStableSupportScenario = candidateScenario('stable-support', 'retain a near-equal prior target');

export const AI_CANDIDATE_SCENARIOS: readonly ScenarioDefinition<GameState, RoutedPlayerIntent>[] = [
  aiOpenSupportScenario, aiInvalidOptionsScenario, aiStableSupportScenario
];

/** Workbench/test setup metadata, deliberately outside authoritative GameState. */
export function getCandidatePreviewRequest(scenarioId: string): {
  readonly playerId: string;
  readonly options: SpatialCandidateOptions;
} | undefined {
  if (scenarioId === aiOpenSupportScenario.id) {
    return { playerId: 'player-2', options: { candidates: [
      { id: 'open', position: { x: -4, y: 3 } },
      { id: 'crowded', position: { x: 4, y: 3 } }
    ] } };
  }
  if (scenarioId === aiInvalidOptionsScenario.id) {
    return { playerId: 'player-2', options: { candidates: [
      { id: 'outside', position: { x: 20, y: 2 } },
      { id: 'occupied', position: { x: 4, y: 5 } },
      { id: 'blocked', position: { x: 0, y: 4 } },
      { id: 'open', position: { x: -4, y: 3 } }
    ] } };
  }
  if (scenarioId === aiStableSupportScenario.id) {
    return { playerId: 'player-2', options: { previousId: 'right', candidates: [
      { id: 'left', position: { x: -3, y: 3 } },
      { id: 'right', position: { x: 3.03, y: 3 } }
    ] } };
  }
  return undefined;
}
