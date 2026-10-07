import { createNeutralPlayerIntent } from '../control/intent';
import type { RoutedPlayerIntent } from '../control/types';
import { createAiActionState } from '../sim/actionState';
import { createFieldPlayerState, createLooseBallState, createPossessedBallState, type GameState } from '../sim/gameState';
import { createMatchState } from '../sim/match';
import { createTacticalState } from '../sim/tactics';
import { createTeamGameState } from '../sim/teams';
import type { ScenarioDefinition } from './scenario';

type ActionSetup = 'advance' | 'low-pass' | 'lob-pass' | 'shot' | 'ordinary-receive' | 'one-touch-low' |
  'one-touch-high' | 'check' | 'keeper-recovery' | 'keeper-distribution' | 'exchange';

function actionState(setup: ActionSetup): GameState {
  const state = createTeamGameState();
  state.tactics = createTacticalState();
  state.aiActions = createAiActionState();
  if (setup === 'exchange') return state;
  const positions: Record<string, { x: number; y: number }> = {
    'player-1': { x: 0, y: -6 },
    'player-2': { x: 0, y: 0 },
    'player-3': { x: -7, y: -10 },
    'player-4': { x: 7, y: -10 },
    'opponent-1': { x: -8, y: 7 },
    'opponent-2': { x: 8, y: 7 },
    'opponent-3': { x: -7, y: 11 },
    'opponent-4': { x: 7, y: 11 },
    'human-keeper': { x: 0, y: -13 },
    'opponent-keeper': { x: 0, y: 13 }
  };
  if (setup === 'advance') {
    positions['player-1'] = { x: 0, y: -2 };
    positions['player-2'] = { x: 0, y: -11 };
  }
  if (setup === 'lob-pass') {
    positions['player-1'] = { x: 0, y: -8 };
    positions['player-2'] = { x: 0, y: 3 };
    positions['opponent-1'] = { x: 0, y: -3 };
  }
  if (setup === 'shot') {
    positions['player-1'] = { x: 0, y: 9 };
    positions['player-2'] = { x: -6, y: 7 };
    positions['opponent-keeper'] = { x: -2.4, y: 12.8 };
  }
  if (setup === 'one-touch-low' || setup === 'one-touch-high' || setup === 'keeper-recovery') {
    positions['player-1'] = { x: -6, y: 8 };
    positions['player-2'] = { x: 2, y: setup === 'one-touch-high' ? 8 : 10 };
    positions['opponent-keeper'] = setup === 'one-touch-high' ? { x: 2, y: 11.6 } : { x: -2, y: 13 };
    if (setup === 'one-touch-high') {
      positions['player-1'] = { x: -6, y: 12 };
      positions['player-2'] = { x: 2, y: 7 };
      positions['player-4'] = { x: 7, y: 7 };
      positions['opponent-1'] = { x: -2, y: 9.5 };
      positions['opponent-2'] = { x: 8, y: -4 };
      positions['opponent-3'] = { x: -8, y: -5 };
      positions['opponent-4'] = { x: 7, y: -8 };
      positions['opponent-keeper'] = { x: 0, y: 13 };
    }
  }
  if (setup === 'check') {
    positions['player-1'] = { x: 0, y: 0 };
    positions['player-2'] = { x: 5, y: -5 };
    positions['opponent-1'] = { x: -2, y: 0 };
  }
  if (setup === 'keeper-distribution') {
    positions['player-1'] = { x: -6, y: -8 };
    positions['player-2'] = { x: 0, y: -6 };
    positions['player-3'] = { x: -7, y: 0 };
    positions['player-4'] = { x: 7, y: 0 };
  }
  state.players = state.players.map((player) => {
    const needsControl = player.definition.id === 'player-2' &&
      ['one-touch-low', 'one-touch-high', 'keeper-recovery'].includes(setup);
    const needsContactStats = setup === 'check' && ['player-1', 'opponent-1'].includes(player.definition.id);
    const positioned = needsControl || needsContactStats ? createFieldPlayerState({
      id: player.definition.id, teamId: player.definition.teamId,
      attributes: needsControl ? { control: 100 } : player.definition.id === 'player-1'
        ? { control: 0, strength: 0 } : { strength: 100 }
    }) : player;
    positioned.position = positions[player.definition.id];
    positioned.velocity = setup === 'check' && player.definition.id === 'opponent-1' ? { x: 8, y: 0 } : { x: 0, y: 0 };
    positioned.facing = setup === 'check' && player.definition.id === 'opponent-1' ? { x: 1, y: 0 }
      : { x: 0, y: player.definition.teamId === 'human' ? 1 : -1 };
    if (setup === 'one-touch-high' && player.definition.id === 'player-2') {
      const length = Math.hypot(-8, 5);
      positioned.facing = { x: -8 / length, y: 5 / length };
    }
    if (setup === 'keeper-recovery' && positioned.goalkeeper && player.definition.id === 'opponent-keeper') {
      positioned.goalkeeper.recoveryTicksRemaining = 18;
    }
    return positioned;
  });
  state.ball = setup === 'ordinary-receive'
    ? createLooseBallState({ position: { x: 0, y: -3 }, velocity: { x: 0, y: 10 },
      release: { releasedById: 'player-1', reacquisitionLockoutTicksRemaining: 12 } })
    : setup === 'one-touch-low' || setup === 'one-touch-high' || setup === 'keeper-recovery'
      ? createLooseBallState({ position: { x: setup === 'one-touch-high' ? 6 : -2, y: positions['player-2'].y },
        velocity: { x: setup === 'one-touch-high' ? -12 : 12, y: 0 },
        release: { releasedById: setup === 'one-touch-high' ? 'player-4' : 'player-1', reacquisitionLockoutTicksRemaining: 12 } })
      : createPossessedBallState(setup === 'keeper-distribution' ? 'human-keeper' : 'player-1');
  state.match = createMatchState(state.players);
  return state;
}

function actionScenario(setup: ActionSetup, name: string, ticks = 120): ScenarioDefinition<GameState, RoutedPlayerIntent> {
  return {
    id: `ai-actions-${setup}`, name: `AI actions · ${name}`, automatedRunTicks: ticks,
    createInitialState: () => actionState(setup),
    scriptedInputs: setup === 'check' ? Array.from({ length: ticks }, (_, index) => ({
      tick: index + 1, input: { playerId: 'player-1', intent: createNeutralPlayerIntent() }
    })) : [],
    diagnosticLayerOverrides: ['ai', 'throw', 'receive', 'checking', 'keeper', 'match'].map((key) => ({ key, enabled: true })),
    assertions: [{ id: 'ten-stable-players-and-one-valid-owner', check(state) {
      return state.players.length === 10 && new Set(state.players.map((player) => player.definition.id)).size === 10 &&
        state.players.every((player) => [player.position.x, player.position.y].every(Number.isFinite)) &&
        (state.ball.mode === 'loose' || state.players.some((player) => state.ball.mode === 'possessed' && player.definition.id === state.ball.holderId));
    } }]
  };
}

export const aiAdvanceScenario = actionScenario('advance', 'carrier advances into useful space', 60);
export const aiLowPassScenario = actionScenario('low-pass', 'obvious low pass');
export const aiLobPassScenario = actionScenario('lob-pass', 'lob over blocked ground lane');
export const aiShotChoiceScenario = actionScenario('shot', 'open shot versus supporting pass');
export const aiOrdinaryReceiveScenario = actionScenario('ordinary-receive', 'ordinary controlled reception', 60);
export const aiLowOneTouchScenario = actionScenario('one-touch-low', 'cross-goal low one-touch', 60);
export const aiHighOneTouchScenario = actionScenario('one-touch-high', 'cross-goal high one-touch', 90);
export const aiDefensiveCheckScenario = actionScenario('check', 'pressure check creates a turnover', 30);
export const aiKeeperRecoveryScenario = actionScenario('keeper-recovery', 'keeper lateral recovery after cross-goal pass', 90);
export const aiKeeperDistributionScenario = actionScenario('keeper-distribution', 'keeper distribution to a field receiver');
export const aiPossessionExchangeScenario = actionScenario('exchange', 'sustained 5v5 possession exchange', 900);

export const AI_ACTION_SCENARIOS: readonly ScenarioDefinition<GameState, RoutedPlayerIntent>[] = [
  aiAdvanceScenario, aiLowPassScenario, aiLobPassScenario, aiShotChoiceScenario, aiOrdinaryReceiveScenario,
  aiLowOneTouchScenario, aiHighOneTouchScenario, aiDefensiveCheckScenario,
  aiKeeperRecoveryScenario, aiKeeperDistributionScenario, aiPossessionExchangeScenario
];
