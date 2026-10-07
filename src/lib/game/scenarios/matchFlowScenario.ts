import { createNeutralPlayerIntent } from '../control/intent';
import type { RoutedPlayerIntent, SimulationInput } from '../control/types';
import { createAiActionState } from '../sim/actionState';
import { createLooseBallState, createPossessedBallState, type GameState } from '../sim/gameState';
import { createMatchState } from '../sim/match';
import { createTacticalState } from '../sim/tactics';
import { createTeamGameState } from '../sim/teams';
import type { ScenarioDefinition, ScenarioInputFrame } from './scenario';

function matchState(phase: 'ready' | 'playing' = 'ready'): GameState {
  const state = createTeamGameState();
  state.tactics = createTacticalState();
  state.aiActions = createAiActionState();
  state.match = createMatchState(state.players, 'human', 'opponent', phase);
  return state;
}

function neutralPlayers(state: GameState): readonly RoutedPlayerIntent[] {
  return state.players.map((player) => ({ playerId: player.definition.id, intent: createNeutralPlayerIntent() }));
}

const layers = ['match', 'ai', 'throw', 'receive', 'checking', 'keeper'].map((key) => ({ key, enabled: true }));
const assertions = [{ id: 'valid-match-clock-and-score', check(state: GameState) {
  return !!state.match && Number.isInteger(state.match.activeTicks) && state.match.activeTicks >= 0 &&
    state.match.activeTicks <= state.match.durationTicks &&
    Object.values(state.match.score).every((score) => Number.isInteger(score) && score >= 0);
} }];

export const fullMatchScenario: ScenarioDefinition<GameState, SimulationInput> = {
  id: 'match-ready', name: 'Match · ready for human vs AI 5v5', automatedRunTicks: 1,
  createInitialState: () => matchState(),
  interactiveActionContext: 'receiving', diagnosticLayerOverrides: layers, assertions
};

export const matchExactFullTimeScenario: ScenarioDefinition<GameState, SimulationInput> = {
  id: 'match-exact-full-time', name: 'Match · exact one-second full time', automatedRunTicks: 70,
  createInitialState: () => matchState(),
  tuningOverrides: [{ key: 'match.durationSeconds', value: 1 }],
  scriptedInputs: Array.from({ length: 70 }, (_, index) => ({ tick: index + 1,
    input: { matchAction: index === 0 ? 'start' as const : undefined, playerIntents: neutralPlayers(matchState()) } })),
  diagnosticLayerOverrides: layers, assertions
};

function nearFullTimeState(lastTick: boolean): GameState {
  const state = matchState('playing');
  state.players.find((player) => player.definition.id === 'opponent-keeper')!.position = { x: -3.2, y: 13 };
  state.ball = createLooseBallState({ position: { x: 2.8, y: 14.2 }, velocity: { x: 0, y: 60 } });
  state.match!.durationTicks = 60;
  state.match!.activeTicks = lastTick ? 59 : 58;
  return state;
}

export const matchFinalTickGoalScenario: ScenarioDefinition<GameState, SimulationInput> = {
  id: 'match-final-tick-goal', name: 'Match · valid goal on final active tick', automatedRunTicks: 10,
  createInitialState: () => nearFullTimeState(true), scriptedInputs: [],
  tuningOverrides: [{ key: 'match.durationSeconds', value: 1 }],
  diagnosticLayerOverrides: layers, assertions
};

export const matchNearFullTimeGoalScenario: ScenarioDefinition<GameState, SimulationInput> = {
  id: 'match-near-full-time-goal', name: 'Match · stoppage pauses the final second', automatedRunTicks: 10,
  createInitialState: () => nearFullTimeState(false), scriptedInputs: [],
  tuningOverrides: [{ key: 'match.durationSeconds', value: 1 }, { key: 'match.goalStoppageSeconds', value: 0.1 }],
  diagnosticLayerOverrides: layers, assertions
};

function repeatedGoalState(): GameState {
  const state = matchState();
  const positions = [
    { x: 0, y: 0 }, { x: -8, y: -6 }, { x: 8, y: -6 }, { x: -8, y: 7 },
    { x: -3.2, y: -13 }, { x: 8, y: 7 }, { x: -8, y: 10 }, { x: 8, y: 10 },
    { x: -8, y: 3 }, { x: -3.2, y: 13 }
  ];
  state.players.forEach((player, index) => { player.position = positions[index]; });
  state.match = createMatchState(state.players, 'human', 'opponent', 'ready');
  return state;
}

function repeatedGoalInputs(): readonly ScenarioInputFrame<SimulationInput>[] {
  const setup = repeatedGoalState();
  return Array.from({ length: 150 }, (_, index) => {
    const tick = index + 1;
    const shot = [3, 53, 103].includes(tick);
    return { tick, input: { matchAction: tick === 1 ? 'start' as const : undefined,
      playerIntents: setup.players.map((player) => ({ playerId: player.definition.id,
        intent: createNeutralPlayerIntent(player.definition.id === 'player-1' && shot
          ? { actionContext: 'possessed', rightStickThrow: { direction: { x: 0, y: 1 }, magnitude: 1 } }
          : player.definition.id === 'player-2' ? { actionContext: 'receiving', receive: {
            low: { held: true, pressed: true, released: false },
            high: { held: false, pressed: false, released: false }, rightStickThrow: undefined
          } }
          : player.definition.id === 'opponent-1' && [25, 75, 125].includes(tick)
            ? { check: { held: true, pressed: true, released: false } }
            : player.definition.role === 'goalkeeper' && shot
              ? { save: { held: true, pressed: true, released: false } } : {}) }))
    } };
  });
}

export const matchRepeatedRestartsScenario: ScenarioDefinition<GameState, SimulationInput> = {
  id: 'match-repeated-restarts', name: 'Match · three real goals and clean restarts', automatedRunTicks: 150,
  createInitialState: repeatedGoalState, scriptedInputs: repeatedGoalInputs(),
  tuningOverrides: [{ key: 'match.durationSeconds', value: 10 }, { key: 'match.goalStoppageSeconds', value: 0.1 }],
  diagnosticLayerOverrides: layers, assertions
};

function endedMatchState(): GameState {
  const state = matchState();
  state.tick = 42;
  const match = state.match!;
  match.phase = 'full-time';
  match.durationTicks = 120;
  match.activeTicks = 120;
  match.score.human = 3;
  match.score.opponent = 2;
  match.restartCount = 7;
  match.runRevision = 2;
  state.ball = createPossessedBallState('player-1');
  state.players.forEach((player, index) => {
    player.position = { x: player.position.x + 0.25, y: player.position.y + 0.25 };
    player.velocity = { x: 3, y: -2 };
    player.facing = { x: 1, y: 0 };
    player.throwCharge = { family: 'high', elapsedSeconds: 0.2, strength: 0.52, progress: 0.4 };
    player.oneTouch = { charge: { family: 'low', elapsedSeconds: 0.1, strength: 0.36, progress: 0.2 },
      buffer: { direction: { x: 1, y: 0 }, magnitude: 0.8, ticksRemaining: 5 } };
    player.contact = { checkTicksRemaining: 4, checkRecoveryTicksRemaining: 12,
      stumbleTicksRemaining: 8, immunityTicksRemaining: 10, hitPlayerIds: [state.players[(index + 1) % state.players.length].definition.id] };
    if (player.goalkeeper) player.goalkeeper = { commitTicksRemaining: 4, recoveryTicksRemaining: 12, saveDirection: { x: 1, y: 0 } };
  });
  state.tactics = { ...createTacticalState(), lastPossessionKey: 'held:player-1', teams: [{
    teamId: 'human', context: 'own-possession', plannedTick: 36, nextThinkTick: 48, reason: 'previous-match',
    assignments: [{ playerId: 'player-2', teamId: 'human', role: 'support', target: { x: 5, y: 5 },
      score: 2, reason: 'previous-match', assignedTick: 30, targetPlannedTick: 36, nextThinkTick: 48 }]
  }] };
  state.aiActions = { ...createAiActionState(), lastPossessionKey: 'held:player-1', decisions: [{
    playerId: 'player-1', kind: 'pass-high', candidateId: 'old-pass', target: { x: 5, y: 5 }, receiverId: 'player-2',
    strength: 0.6, score: 2, selectedTick: 30, plannedTick: 36, nextThinkTick: 48, reason: 'previous-match'
  }] };
  return state;
}

export const matchRematchResetScenario: ScenarioDefinition<GameState, SimulationInput> = {
  id: 'match-rematch-reset', name: 'Match · rematch clears the entire previous run', automatedRunTicks: 1,
  createInitialState: endedMatchState,
  scriptedInputs: [{ tick: 43, input: { matchAction: 'rematch' } }],
  tuningOverrides: [{ key: 'match.durationSeconds', value: 2 }, { key: 'movement.maxSpeed', value: 9 }],
  diagnosticLayerOverrides: layers, assertions
};

export const MATCH_FLOW_SCENARIOS: readonly ScenarioDefinition<GameState, SimulationInput>[] = [
  fullMatchScenario, matchExactFullTimeScenario, matchFinalTickGoalScenario,
  matchNearFullTimeGoalScenario, matchRepeatedRestartsScenario, matchRematchResetScenario
];
