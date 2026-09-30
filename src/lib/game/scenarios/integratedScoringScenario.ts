import type { SimulationInput } from '../control/types';
import type { Vec2 } from '../physics/geometry';
import { createPossessedBallState, type GameState } from '../sim/gameState';
import { createMatchState } from '../sim/match';
import { createTeamGameState } from '../sim/teams';
import { createReceivingIntent } from './receivingScenario';
import type { ScenarioDefinition, ScenarioInputFrame } from './scenario';
import { createThrowIntent } from './throwScenario';

type ScoringScenario = ScenarioDefinition<GameState, SimulationInput>;
interface ShotSetup {
  readonly id: string;
  readonly name: string;
  readonly origin: Vec2;
  readonly target: Vec2;
  readonly keeper?: Vec2;
  readonly magnitude?: number;
  readonly button?: 'low' | 'high';
  readonly holdTicks?: number;
}

function directionTo(origin: Vec2, target: Vec2): Vec2 {
  const length = Math.hypot(target.x - origin.x, target.y - origin.y);
  return { x: (target.x - origin.x) / length, y: (target.y - origin.y) / length };
}

/** Ten-player drills use external field actions and autonomous keepers.
 * Other field players remain behind the play to isolate the scoring choice.
 * Player attributes and tuning retain their committed defaults. */
function shotScenario(setup: ShotSetup): ScoringScenario {
  const direction = directionTo(setup.origin, setup.target);
  const holdTicks = setup.holdTicks ?? 1;
  const frames: ScenarioInputFrame<SimulationInput>[] = setup.button ? [
    ...Array.from({ length: holdTicks }, (_, index) => ({ tick: index + 1,
      input: createThrowIntent({ [setup.button === 'low' ? 'lowThrow' : 'highThrow']:
        { held: true, pressed: index === 0, released: false } }) })),
    { tick: holdTicks + 1, input: createThrowIntent({
      [setup.button === 'low' ? 'lowThrow' : 'highThrow']: { held: false, pressed: false, released: true }
    }) }
  ] : [{ tick: 1, input: createThrowIntent({ rightStickThrow: { direction, magnitude: setup.magnitude ?? 1 } }) }];
  return {
    id: `integrated-${setup.id}`, name: `Integrated scoring · ${setup.name}`, automatedRunTicks: 90,
    createInitialState: () => {
      const state = createTeamGameState();
      state.players.forEach((player, index) => {
        if (player.definition.id === 'player-1') {
          player.position = { ...setup.origin }; player.facing = { ...direction };
        } else if (player.definition.id === 'opponent-keeper') {
          player.position = { ...(setup.keeper ?? { x: 0, y: 13 }) };
        } else if (player.definition.role === 'field') {
          player.position = { x: index % 2 ? -7 : 7, y: -10 + index * 1.5 };
        }
      });
      state.ball = createPossessedBallState('player-1');
      state.match = createMatchState(state.players);
      return state;
    },
    scriptedInputs: frames,
    diagnosticLayerOverrides: ['throw', 'receive', 'keeper', 'ball', 'match', 'control'].map(key => ({ key, enabled: true })),
    assertions: [{ id: 'stable-rosters-finite-state-and-valid-owner', check(state) {
      return state.players.length === 10 && new Set(state.players.map(player => player.definition.id)).size === 10 &&
        state.players.every(player => [player.position.x, player.position.y, player.velocity.x, player.velocity.y].every(Number.isFinite)) &&
        (state.ball.mode === 'loose' || state.players.some(player => state.ball.mode === 'possessed' && player.definition.id === state.ball.holderId));
    } }]
  };
}

export const integratedPlacedLowScenario = shotScenario({
  id: 'placed-low', name: 'placed low corner', origin: { x: 3.5, y: 12 }, target: { x: 3.5, y: 14.65 }, button: 'low'
});
export const integratedPowerShotScenario = shotScenario({
  id: 'power-shot', name: 'distant power shot', origin: { x: 3.5, y: 7 }, target: { x: 3.5, y: 14.65 }, magnitude: 1
});
export const integratedLobScenario = shotScenario({
  id: 'lob', name: 'lob over an advanced keeper', origin: { x: 0, y: 8.5 }, target: { x: 0, y: 14.65 },
  keeper: { x: 0, y: 11.6 }, button: 'high', holdTicks: 8
});
export const integratedReboundScenario = shotScenario({
  id: 'rebound', name: 'side-board bank shot', origin: { x: 5, y: 7 },
  // A reflected target produces a real right-board sweep before the goal.
  target: { x: 14.3, y: 14.65 }, magnitude: 1
});
export const integratedCentreLowScenario = shotScenario({
  id: 'centre-low', name: 'set keeper against centre low shot', origin: { x: 0, y: 9 }, target: { x: 0, y: 14.65 }, button: 'low'
});
export const integratedCentrePowerScenario = shotScenario({
  id: 'centre-power', name: 'set keeper against centre power shot', origin: { x: 0, y: 9 }, target: { x: 0, y: 14.65 }, magnitude: 1
});

function combinationScenario(oneTouch: boolean, delayed = false): ScoringScenario {
  const scenario = shotScenario({
    id: oneTouch ? 'one-touch' : delayed ? 'lateral-delayed' : 'lateral-pass',
    name: oneTouch ? 'lateral one-touch redirect' : delayed ? 'keeper recovers against a delayed follow-up' : 'lateral pass and immediate shot',
    origin: { x: -3, y: 10 }, target: { x: 3, y: 10 }, keeper: { x: -2, y: 13 }, button: 'low', holdTicks: 4
  });
  const shotDirection = directionTo({ x: 3, y: 10 }, { x: 3.6, y: 14.65 });
  return {
    ...scenario,
    createInitialState: () => {
      const state = scenario.createInitialState();
      const receiver = state.players.find(player => player.definition.id === 'player-2')!;
      receiver.position = { x: 3, y: 10 };
      receiver.facing = { x: 0, y: 1 };
      state.match = createMatchState(state.players);
      return state;
    },
    scriptedInputs: [...scenario.scriptedInputs!, ...Array.from({ length: 85 }, (_, index) => ({
      tick: index + 6,
      input: oneTouch ? createReceivingIntent({
        playerId: 'player-2', low: { held: true, pressed: index === 0, released: false }
      }) : index + 6 === (delayed ? 50 : 37)
        ? { ...createThrowIntent({ rightStickThrow: { direction: shotDirection, magnitude: 0.8 } }), playerId: 'player-2' }
        : createReceivingIntent({ playerId: 'player-2' })
    }))]
  };
}

export const integratedLateralPassScenario = combinationScenario(false);
export const integratedOneTouchScenario = combinationScenario(true);
export const integratedDelayedShotScenario = combinationScenario(false, true);

export const INTEGRATED_SCORING_SCENARIOS: readonly ScoringScenario[] = [
  integratedPlacedLowScenario, integratedPowerShotScenario, integratedLobScenario,
  integratedLateralPassScenario, integratedOneTouchScenario, integratedReboundScenario,
  integratedCentreLowScenario, integratedCentrePowerScenario, integratedDelayedShotScenario
];
