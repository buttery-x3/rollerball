import type { RoutedPlayerIntent } from '../control/types';
import { createFieldPlayerState, createLooseBallState, type GameState } from '../sim/gameState';
import { createMatchState } from '../sim/match';
import type { ScenarioDefinition } from './scenario';

function scoringState(direction: number, x = 0, height = 0): GameState {
  const players = [createFieldPlayerState({ position: { x: -3, y: -4 } })];
  return { tick: 0, players, ball: createLooseBallState({ position: { x, y: 13 * direction }, velocity: { x: 0, y: 240 * direction }, height }), match: createMatchState(players) };
}

export const scoringFreePlayScenario: ScenarioDefinition<GameState, RoutedPlayerIntent> = {
  id: 'scoring-free-play', name: 'Scoring · collect, throw and restart', automatedRunTicks: 1,
  createInitialState: () => {
    const players = [createFieldPlayerState()];
    return { tick: 0, players, ball: createLooseBallState(), match: createMatchState(players) };
  },
  interactiveActionContext: 'receiving'
};

export const SCORING_SCENARIOS: readonly ScenarioDefinition<GameState, RoutedPlayerIntent>[] = [
  scoringFreePlayScenario,
  ...[
    ['goal-positive', 'Scoring · fast human goal and restart', 1, 0, 0],
    ['goal-negative', 'Scoring · fast opponent goal and restart', -1, 0, 0],
    ['goal-over-crossbar', 'Scoring · over crossbar rebound', 1, 0, 4],
    ['goal-outside-post', 'Scoring · outside post rebound', 1, 4.1, 0]
  ].map(([id, name, direction, x, height]) => ({
    id: String(id), name: String(name), automatedRunTicks: 100, scriptedInputs: [],
    createInitialState: () => scoringState(Number(direction), Number(x), Number(height)),
    diagnosticLayerOverrides: [{ key: 'match', enabled: true }],
    assertions: [{ id: 'finite-score-and-ball', check: (state: GameState) =>
      Object.values(state.match!.score).every(value => Number.isInteger(value) && value >= 0) &&
      (state.ball.mode === 'possessed' || Number.isFinite(state.ball.position.y)) }]
  }))
];
