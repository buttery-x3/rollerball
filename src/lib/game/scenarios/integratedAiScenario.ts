import { createNeutralPlayerIntent } from '../control/intent';
import type { SimulationInput } from '../control/types';
import { createAiActionState } from '../sim/actionState';
import { createFieldPlayerState, createGoalkeeperState, createLooseBallState,
  createPossessedBallState, type GameState } from '../sim/gameState';
import { aiDefensiveCheckScenario } from './aiActionsScenario';
import type { ScenarioDefinition } from './scenario';

export const friendlyKeeperObstructionScenario: ScenarioDefinition<GameState, SimulationInput> = {
  id: 'friendly-keeper-obstruction', name: 'Integrated AI · friendly keeper blocks a field pass', automatedRunTicks: 15,
  createInitialState: () => ({ tick: 0, aiActions: createAiActionState(), players: [
    createFieldPlayerState({ id: 'thrower', teamId: 'human', position: { x: 4, y: -13 } }),
    createFieldPlayerState({ id: 'receiver', teamId: 'human', position: { x: -3, y: -13 } }),
    createGoalkeeperState({ id: 'keeper', teamId: 'human', defendingEnd: 'negativeY', position: { x: 0, y: -13 } })
  ], ball: createPossessedBallState('thrower') }),
  scriptedInputs: [{ tick: 1, input: { playerId: 'thrower', intent: createNeutralPlayerIntent({
    actionContext: 'possessed', rightStickThrow: { direction: { x: -1, y: 0 }, magnitude: 1 }
  }) } }], diagnosticLayerOverrides: ['ai', 'receive', 'keeper'].map(key => ({ key, enabled: true }))
};

export const pressureCheckFromRestScenario: ScenarioDefinition<GameState, SimulationInput> = {
  ...aiDefensiveCheckScenario, id: 'pressure-check-from-rest', name: 'Integrated AI · pressure accelerates through check contact',
  createInitialState() {
    const state = aiDefensiveCheckScenario.createInitialState();
    state.players = state.players.map(player => player.definition.id === 'opponent-1'
      ? createFieldPlayerState({ id: 'opponent-1', teamId: 'opponent', position: { x: -3, y: 0 }, facing: { x: 1, y: 0 } })
      : player.definition.id === 'player-1'
        ? createFieldPlayerState({ id: 'player-1', teamId: 'human', position: { x: 0, y: 0 } }) : player);
    return state;
  }
};

export const keeperUnreachableCrossingScenario: ScenarioDefinition<GameState, SimulationInput> = {
  id: 'keeper-unreachable-crossing', name: 'Integrated AI · keeper covers an unreachable far corner', automatedRunTicks: 30,
  createInitialState: () => ({ tick: 0,
    players: [createGoalkeeperState({ id: 'keeper', teamId: 'human', defendingEnd: 'negativeY',
      position: { x: -2.1266, y: -14.4 }, velocity: { x: -1.3652, y: 0 } })],
    ball: createLooseBallState({ position: { x: -3.298, y: -3.534 }, velocity: { x: 13.9738, y: -26.5468 } }) }),
  scriptedInputs: [], diagnosticLayerOverrides: [{ key: 'keeper', enabled: true }]
};

export const INTEGRATED_AI_SCENARIOS = [friendlyKeeperObstructionScenario, pressureCheckFromRestScenario,
  keeperUnreachableCrossingScenario] as const;
