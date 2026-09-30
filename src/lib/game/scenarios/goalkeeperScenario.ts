import type { RoutedPlayerIntent } from '../control/types';
import type { Vec2 } from '../physics/geometry';
import {
  createFieldPlayerState,
  createGoalkeeperState,
  createLooseBallState,
  createPossessedBallState,
  type GameState
} from '../sim/gameState';
import { createMatchState } from '../sim/match';
import { createRoutedMovementIntent } from './playerMovementScenario';
import { createReceivingIntent } from './receivingScenario';
import type { ScenarioDefinition } from './scenario';

export const POSITIVE_KEEPER_ID = 'keeper-positive';
export const NEGATIVE_KEEPER_ID = 'keeper-negative';
export const KEEPER_REDIRECTOR_ID = 'redirector';

const layers = ['keeper', 'receive', 'ball', 'match', 'playerMovement'].map((key) => ({ key, enabled: true }));
const assertions = [{
  id: 'finite-keeper-state-and-valid-possession',
  check(state: GameState) {
    for (const player of state.players) {
      if (![player.position.x, player.position.y, player.velocity.x, player.velocity.y]
        .every(Number.isFinite)) throw new Error('Keeper scenario contains non-finite movement.');
      if (player.goalkeeper && ![player.goalkeeper.commitTicksRemaining, player.goalkeeper.recoveryTicksRemaining]
        .every((value) => Number.isInteger(value) && value >= 0)) throw new Error('Invalid keeper action timer.');
    }
    const ball = state.ball;
    if (ball.mode === 'possessed' && !state.players.some((player) => player.definition.id === ball.holderId)) {
      throw new Error('Keeper scenario possession holder is missing.');
    }
  }
}];

export function keeperMovementIntent(movement: Vec2, save = false): RoutedPlayerIntent {
  const routed = createRoutedMovementIntent(movement);
  return {
    playerId: POSITIVE_KEEPER_ID,
    intent: {
      ...routed.intent,
      desiredFacing: { x: 0, y: -1 },
      actionContext: 'defending',
      save: { held: save, pressed: save, released: false }
    }
  };
}

interface KeeperShotSetup {
  readonly speed?: number;
  readonly control?: number;
  readonly ballX?: number;
  readonly ballY?: number;
  readonly height?: number;
  readonly verticalVelocity?: number;
  readonly keeperPosition?: Vec2;
}

export function createKeeperShotState(setup: KeeperShotSetup = {}): GameState {
  const players = [
    createGoalkeeperState({
      id: POSITIVE_KEEPER_ID,
      teamId: 'opponent',
      defendingEnd: 'positiveY',
      position: setup.keeperPosition ?? { x: 0, y: 13 },
      facing: { x: 0, y: -1 },
      attributes: { control: setup.control ?? 50 }
    }),
    createGoalkeeperState({
      id: NEGATIVE_KEEPER_ID,
      teamId: 'human',
      defendingEnd: 'negativeY',
      position: { x: 0, y: -13 },
      facing: { x: 0, y: 1 }
    })
  ];
  return {
    tick: 0,
    players,
    ball: createLooseBallState({
      position: { x: setup.ballX ?? 0, y: setup.ballY ?? 11.5 },
      velocity: { x: 0, y: setup.speed ?? 8 },
      height: setup.height ?? 0,
      verticalVelocity: setup.verticalVelocity ?? 0
    }),
    match: createMatchState(players)
  };
}

function shotScenario(id: string, name: string, setup: KeeperShotSetup, ticks = 60): ScenarioDefinition<GameState, RoutedPlayerIntent> {
  return {
    id: `keeper-${id}`,
    name: `Goalkeeper · ${name}`,
    automatedRunTicks: ticks,
    createInitialState: () => createKeeperShotState(setup),
    scriptedInputs: [],
    diagnosticLayerOverrides: layers,
    assertions
  };
}

export const keeperEasyCatchScenario = shotScenario('easy-catch', 'easy controlled catch', { speed: 8 });
export const keeperHardParryScenario = shotScenario('hard-parry', 'hard shot parry', { speed: 40 });
export const keeperLowControlScenario = shotScenario('low-control', 'low Control difficult save', { speed: 15, control: 0 });
export const keeperHighControlScenario = shotScenario('high-control', 'high Control difficult save', { speed: 15, control: 100 });
export const keeperLowCornerScenario = shotScenario('low-corner', 'released low corner threat', {
  keeperPosition: { x: 1.2, y: 13 }, ballX: 2.6, ballY: 8, speed: 28
});
export const keeperAggressiveLobScenario = shotScenario('aggressive-lob', 'lob above advanced keeper', {
  keeperPosition: { x: 0, y: 11.6 }, ballY: 11.2,
  height: 2.2, verticalVelocity: 3, speed: 18
}, 30);

export const keeperCreaseMovementScenario: ScenarioDefinition<GameState, RoutedPlayerIntent> = {
  id: 'keeper-crease-movement',
  name: 'Goalkeeper · lateral, outward, retreat and reversal movement',
  automatedRunTicks: 240,
  createInitialState: () => {
    const state = createKeeperShotState();
    state.ball = createPossessedBallState(POSITIVE_KEEPER_ID);
    return state;
  },
  scriptedInputs: Array.from({ length: 240 }, (_, index) => ({
    tick: index + 1,
    input: keeperMovementIntent(index < 60 ? { x: 1, y: 0 }
      : index < 120 ? { x: -1, y: -1 }
      : index < 180 ? { x: 0, y: 1 } : { x: -1, y: 0 })
  })),
  diagnosticLayerOverrides: layers,
  assertions
};

export const keeperCommittedRedirectScenario: ScenarioDefinition<GameState, RoutedPlayerIntent> = {
  id: 'keeper-commit-redirect',
  name: 'Goalkeeper · committed parry followed by one-touch return',
  automatedRunTicks: 90,
  createInitialState: () => {
    const state = createKeeperShotState({ ballX: 1.6, ballY: 11.2, speed: 40 });
    state.players.push(createFieldPlayerState({
      id: KEEPER_REDIRECTOR_ID, teamId: 'human', position: { x: 4.3, y: 12.43 },
      facing: { x: -0.7, y: Math.sqrt(0.51) }, attributes: { control: 100, power: 0 }
    }));
    state.match = createMatchState(state.players);
    return state;
  },
  scriptedInputs: [
    { tick: 1, input: keeperMovementIntent({ x: 0, y: 0 }, true) },
    ...Array.from({ length: 89 }, (_, index) => ({
      tick: index + 2,
      input: createReceivingIntent({
        playerId: KEEPER_REDIRECTOR_ID,
        low: { held: true, pressed: index === 0, released: false }
      })
    }))
  ],
  diagnosticLayerOverrides: layers,
  assertions
};

export const GOALKEEPER_SCENARIOS: readonly ScenarioDefinition<GameState, RoutedPlayerIntent>[] = [
  keeperCreaseMovementScenario,
  keeperEasyCatchScenario,
  keeperHardParryScenario,
  keeperLowControlScenario,
  keeperHighControlScenario,
  keeperLowCornerScenario,
  keeperAggressiveLobScenario,
  keeperCommittedRedirectScenario
];
