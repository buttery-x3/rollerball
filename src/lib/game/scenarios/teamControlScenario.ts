import { createControlRouter } from '../control/controlRouter';
import { publishControlDiagnostics } from '../control/diagnostics';
import type { ControlStepResult, InputSnapshot, RoutedPlayerIntent } from '../control/types';
import { stepControlledGame } from '../runtime/stepControlledGame';
import { createLooseBallState, createPossessedBallState, type GameState } from '../sim/gameState';
import { createMatchState } from '../sim/match';
import { createTeamGameState } from '../sim/teams';
import { inputSnapshot } from './controlScenario';
import type { ScenarioDefinition, ScenarioStep } from './scenario';

export type TeamControlSetup = 'possession' | 'pass' | 'receiver' | 'ambiguous' | 'defence' | 'manual' | 'keeper';

const assertions = [{
  id: 'stable-ten-player-teams',
  check(state: GameState) {
    if (state.players.length !== 10 || new Set(state.players.map((player) => player.definition.id)).size !== 10) {
      throw new Error('The team scenario must retain ten unique player identities.');
    }
    for (const teamId of ['human', 'opponent']) {
      const members = state.players.filter((player) => player.definition.teamId === teamId);
      if (members.length !== 5 || members.filter((player) => player.definition.role === 'goalkeeper').length !== 1) {
        throw new Error(`Invalid roster for ${teamId}.`);
      }
    }
    if (state.players.some((player) => ![player.position.x, player.position.y, player.velocity.x, player.velocity.y].every(Number.isFinite))) {
      throw new Error('Team simulation contains non-finite player state.');
    }
  }
}];

export function createTeamControlState(setup: TeamControlSetup): GameState {
  const state = createTeamGameState();
  const positions: Record<string, { x: number; y: number }> = {
    'player-1': { x: 0, y: -4 },
    'player-2': { x: 0, y: 2 },
    'player-3': { x: -6, y: -8 },
    'player-4': { x: 6, y: -8 },
    'opponent-1': { x: 6, y: 6 },
    'opponent-2': { x: -6, y: 6 },
    'opponent-3': { x: -6, y: 10 },
    'opponent-4': { x: 6, y: 10 },
    'human-keeper': { x: 0, y: -13 },
    'opponent-keeper': { x: 0, y: 13 }
  };
  if (setup === 'ambiguous') {
    positions['player-1'] = { x: -2, y: 0 };
    positions['player-2'] = { x: 2, y: 0 };
  }
  if (setup === 'defence' || setup === 'manual') {
    positions['opponent-1'] = { x: 0, y: 1 };
    positions['player-1'] = { x: 0, y: 2.5 };
    positions['player-2'] = { x: 0, y: -1 };
  }
  if (setup === 'keeper') {
    positions['player-1'] = { x: -5, y: -7 };
    positions['player-2'] = { x: 0, y: -8 };
  }
  for (const player of state.players) {
    player.position = positions[player.definition.id];
    player.velocity = { x: 0, y: 0 };
    player.facing = { x: 0, y: player.definition.teamId === 'human' ? 1 : -1 };
  }
  state.ball = setup === 'possession' ? createPossessedBallState('player-2')
    : setup === 'pass' ? createPossessedBallState('player-1')
    : setup === 'defence' || setup === 'manual' ? createPossessedBallState('opponent-1')
    : setup === 'keeper' ? createPossessedBallState('human-keeper')
    : createLooseBallState(setup === 'receiver' ? {
      position: { x: 0, y: -2 }, velocity: { x: 0, y: 12 },
      release: { releasedById: 'player-1', reacquisitionLockoutTicksRemaining: 6 }
    } : { position: { x: 0, y: 0 }, velocity: { x: 0, y: 4 } });
  state.match = createMatchState(state.players);
  return state;
}

function teamControlScenario(setup: TeamControlSetup, label: string): ScenarioDefinition<GameState, RoutedPlayerIntent> {
  return {
    id: `team-control-${setup}`, name: `Teams and control · ${label}`,
    automatedRunTicks: 60,
    createInitialState: () => createTeamControlState(setup),
    // Workbench input and automated snapshots use the same router over this setup.
    interactiveActionContext: 'receiving',
    diagnosticLayerOverrides: [{ key: 'control', enabled: true }, { key: 'receive', enabled: true }, { key: 'keeper', enabled: true }],
    assertions
  };
}

export const teamFreePlayScenario: ScenarioDefinition<GameState, RoutedPlayerIntent> = {
  id: 'team-free-play', name: 'Teams · 5v5 free play', automatedRunTicks: 60,
  createInitialState: createTeamGameState,
  interactiveActionContext: 'receiving',
  diagnosticLayerOverrides: [{ key: 'control', enabled: true }, { key: 'receive', enabled: true }],
  assertions
};
export const teamPossessionScenario = teamControlScenario('possession', 'established teammate possession');
export const teamPassScenario = teamControlScenario('pass', 'throw and follow receiver');
export const teamReceiverScenario = teamControlScenario('receiver', 'clear incoming receiver');
export const teamAmbiguousScenario = teamControlScenario('ambiguous', 'ambiguous loose ball');
export const teamDefensiveScenario = teamControlScenario('defence', 'opponent possession transition');
export const teamManualSwitchScenario = teamControlScenario('manual', 'manual field defender switch');
export const teamKeeperPossessionScenario = teamControlScenario('keeper', 'keeper possession and distribution');

export const TEAM_CONTROL_SCENARIOS: readonly ScenarioDefinition<GameState, RoutedPlayerIntent>[] = [
  teamFreePlayScenario, teamPossessionScenario, teamPassScenario, teamReceiverScenario,
  teamAmbiguousScenario, teamDefensiveScenario, teamManualSwitchScenario, teamKeeperPossessionScenario
];

/** Input-driven variant of the same workbench setup; no alternate gameplay path. */
export function createTeamControlScenarioStep(
  onControl?: (result: ControlStepResult, state: GameState) => void,
  initialPlayerId = 'player-1'
): ScenarioStep<GameState, InputSnapshot> {
  let router: ReturnType<typeof createControlRouter> | undefined;
  return (state, seconds, context, snapshot) => {
    if (!context.tuning || !context.arena) throw new Error('Team control requires tuning and arena.');
    router ??= createControlRouter({ tuning: context.tuning, initialPlayerId, humanTeamId: 'human' });
    const result = router.consumeTick(snapshot ?? inputSnapshot(), undefined, {
      state, arena: context.arena, diagnostics: context.diagnostics
    });
    publishControlDiagnostics(state.tick + 1, result, context.diagnostics);
    onControl?.(result, state);
    stepControlledGame(state, seconds, context, result.routedIntent);
  };
}
