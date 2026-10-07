import { createNeutralPlayerIntent } from '../control/intent';
import type { RoutedPlayerIntent } from '../control/types';
import { createPossessedBallState, type GameState } from '../sim/gameState';
import { createMatchState } from '../sim/match';
import { createTacticalState } from '../sim/tactics';
import { createTeamGameState } from '../sim/teams';
import type { ScenarioDefinition, ScenarioInputFrame } from './scenario';

type TacticalSetup = 'support' | 'transition' | 'pressure' | 'coverage' | 'stability';

function tacticalState(setup: TacticalSetup): GameState {
  const state = createTeamGameState();
  const positions: Record<string, { x: number; y: number }> = {
    'player-1': { x: 0, y: -4 },
    'player-2': { x: -1.5, y: -5.5 },
    'player-3': { x: 1.5, y: -5.5 },
    'player-4': { x: 0, y: -7 },
    'opponent-1': { x: -7, y: 8 },
    'opponent-2': { x: 7, y: 8 },
    'opponent-3': { x: -6, y: 11 },
    'opponent-4': { x: 6, y: 11 },
    'human-keeper': { x: 0, y: -13 },
    'opponent-keeper': { x: 0, y: 13 }
  };
  if (setup === 'transition') {
    positions['player-2'] = { x: 0, y: 6 };
    positions['player-3'] = { x: -5, y: -7 };
    positions['player-4'] = { x: 5, y: -7 };
    positions['opponent-1'] = { x: 0, y: -1 };
  }
  if (setup === 'pressure' || setup === 'coverage' || setup === 'stability') {
    positions['opponent-1'] = { x: 0, y: 3 };
    positions['player-1'] = { x: 0, y: 0 };
    positions['player-2'] = { x: -5, y: -3 };
    positions['player-3'] = { x: 5, y: -3 };
    positions['player-4'] = { x: 0, y: -8 };
  }
  if (setup === 'coverage') {
    positions['player-2'] = { x: -6, y: -6 };
    positions['player-3'] = { x: 6, y: -6 };
  }
  if (setup === 'stability') {
    positions['player-1'] = { x: -2, y: 0 };
    positions['player-2'] = { x: 2.03, y: 0 };
    positions['player-3'] = { x: -6, y: -6 };
    positions['player-4'] = { x: 6, y: -6 };
  }
  for (const player of state.players) {
    player.position = positions[player.definition.id];
    player.velocity = { x: 0, y: 0 };
    player.facing = { x: 0, y: player.definition.teamId === 'human' ? 1 : -1 };
  }
  state.ball = createPossessedBallState(setup === 'support' || setup === 'transition' ? 'player-1' : 'opponent-1');
  state.match = createMatchState(state.players);
  state.tactics = createTacticalState();
  return state;
}

function transitionInputs(): readonly ScenarioInputFrame<RoutedPlayerIntent>[] {
  return Array.from({ length: 60 }, (_, index) => ({
    tick: index + 1,
    input: {
      playerId: 'player-1',
      intent: createNeutralPlayerIntent({
        actionContext: index < 2 ? 'possessed' : 'neutral',
        lowThrow: { pressed: index === 0, held: index === 0, released: index === 1 }
      })
    }
  }));
}

function tacticalScenario(setup: TacticalSetup, label: string): ScenarioDefinition<GameState, RoutedPlayerIntent> {
  return {
    id: `team-tactics-${setup}`,
    name: `Team tactics · ${label}`,
    automatedRunTicks: setup === 'transition' ? 60 : 30,
    createInitialState: () => tacticalState(setup),
    scriptedInputs: setup === 'transition' ? transitionInputs() : undefined,
    interactiveActionContext: setup === 'support' ? 'possessed' : 'defending',
    diagnosticLayerOverrides: [{ key: 'ai', enabled: true }],
    assertions: [{
      id: 'field-assignments-preserve-player-identities',
      check(state) {
        const assignments = state.tactics?.teams.flatMap((team) => team.assignments) ?? [];
        return state.players.length === 10 &&
          new Set(assignments.map((assignment) => assignment.playerId)).size === assignments.length &&
          assignments.every((assignment) => state.players.some((player) =>
            player.definition.id === assignment.playerId && player.definition.role === 'field') &&
            [assignment.target.x, assignment.target.y, assignment.score].every(Number.isFinite));
      }
    }]
  };
}

export const teamSupportSpacingScenario = tacticalScenario('support', 'attacking support, width and depth');
export const teamDefensiveTransitionScenario = tacticalScenario('transition', 'intercepted pass changes team shape');
export const teamPressureAssignmentScenario = tacticalScenario('pressure', 'one suitable pressure defender');
export const teamGoalSideCoverageScenario = tacticalScenario('coverage', 'goal-side and lane coverage');
export const teamRoleStabilityScenario = tacticalScenario('stability', 'near-equal pressure role stability');

export const TEAM_TACTICS_SCENARIOS: readonly ScenarioDefinition<GameState, RoutedPlayerIntent>[] = [
  teamSupportSpacingScenario, teamDefensiveTransitionScenario, teamPressureAssignmentScenario,
  teamGoalSideCoverageScenario, teamRoleStabilityScenario
];
