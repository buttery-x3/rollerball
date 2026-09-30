import type { RoutedPlayerIntent } from '../control/types';
import {
  createFieldPlayerState,
  createLooseBallState,
  createPossessedBallState,
  type GameState
} from '../sim/gameState';
import { createCheckIntent } from './checkScenario';
import { createReceivingIntent } from './receivingScenario';
import type { ScenarioDefinition } from './scenario';

export const CONTROL_RECEIVER_ID = 'player-1';
export const CONTROL_CHECKER_ID = 'checker';

export interface ControlReceiveSetup {
  readonly control: number;
  readonly easy?: boolean;
  readonly height?: number;
  readonly source?: 'low' | 'high' | 'right-stick';
  readonly teamId?: string;
  readonly contested?: boolean;
  readonly misaligned?: boolean;
}

const assertions = [{
  id: 'finite-control-interaction-and-single-owner',
  check(state: GameState) {
    for (const player of state.players) {
      if (![player.position.x, player.position.y, player.velocity.x, player.velocity.y]
        .every(Number.isFinite)) throw new Error('Control interaction player state is invalid.');
    }
    const ball = state.ball;
    if (ball.mode === 'possessed') {
      if (!state.players.some((player) => player.definition.id === ball.holderId)) {
        throw new Error('Control interaction ball holder is missing.');
      }
    } else if (![ball.position.x, ball.position.y, ball.velocity.x, ball.velocity.y,
      ball.height, ball.verticalVelocity].every(Number.isFinite)) {
      throw new Error('Control interaction ball state is invalid.');
    }
  }
}];

export function createControlReceiveScenario(
  setup: ControlReceiveSetup
): ScenarioDefinition<GameState, RoutedPlayerIntent> {
  const kind = setup.easy ? 'easy-pickup' : setup.source ? `${setup.source}-redirect`
    : (setup.height ?? 0.5) > 1 ? 'high-receive' : 'difficult-receive';
  const held = { held: true, pressed: true, released: false };
  return {
    id: `control-${setup.control}-${kind}${setup.contested ? '-contested' : ''}${setup.misaligned ? '-misaligned' : ''}${setup.teamId === 'opponent' ? '-opponent' : ''}`,
    name: `Control ${setup.control} · ${kind}${setup.contested ? ' · contested' : ''}${setup.misaligned ? ' · misaligned' : ''}`,
    automatedRunTicks: 1,
    createInitialState: () => ({
      tick: 0,
      players: [
        createFieldPlayerState({
          id: CONTROL_RECEIVER_ID,
          teamId: setup.teamId ?? 'human',
          facing: { x: 0, y: setup.misaligned ? 1 : -1 },
          attributes: { control: setup.control }
        }),
        ...(setup.contested ? [createFieldPlayerState({
          id: 'contender',
          teamId: setup.teamId === 'opponent' ? 'human' : 'opponent',
          position: { x: 1.5, y: 0 }
        })] : [])
      ],
      ball: createLooseBallState({
        position: { x: 0, y: setup.easy ? -0.5 : -1.2 },
        velocity: { x: 0, y: setup.easy ? 1 : 30 },
        height: setup.easy ? 0 : setup.height ?? 0.5
      })
    }),
    scriptedInputs: [{
      tick: 1,
      input: createReceivingIntent(setup.source === 'right-stick'
        ? { rightStickThrow: { direction: { x: 0, y: -1 }, magnitude: 0.8 } }
        : setup.source ? { [setup.source]: held } : {})
    }],
    interactiveActionContext: 'receiving',
    diagnosticLayerOverrides: [
      { key: 'receive', enabled: true },
      { key: 'ball', enabled: true },
      { key: 'playerMovement', enabled: true }
    ],
    assertions
  };
}

export function createControlRetentionScenario(
  control: number,
  severe = false
): ScenarioDefinition<GameState, RoutedPlayerIntent> {
  return {
    id: `control-${control}-${severe ? 'severe' : 'marginal'}-retention`,
    name: `Control ${control} · ${severe ? 'severe check turnover' : 'marginal check retention'}`,
    automatedRunTicks: 1,
    createInitialState: () => ({
      tick: 0,
      players: [
        createFieldPlayerState({
          id: CONTROL_CHECKER_ID,
          teamId: 'opponent',
          position: { x: -1.3, y: 0 },
          velocity: { x: severe ? 11 : 7, y: 0 },
          facing: { x: 1, y: 0 }
        }),
        createFieldPlayerState({ id: CONTROL_RECEIVER_ID, attributes: { control } })
      ],
      ball: createPossessedBallState(CONTROL_RECEIVER_ID)
    }),
    scriptedInputs: [{ tick: 1, input: createCheckIntent(CONTROL_CHECKER_ID) }],
    interactiveActionContext: 'defending',
    diagnosticLayerOverrides: [
      { key: 'checking', enabled: true },
      { key: 'playerContact', enabled: true },
      { key: 'ball', enabled: true }
    ],
    assertions
  };
}

export const CONTROL_RECEIVING_SCENARIOS: readonly ScenarioDefinition<GameState, RoutedPlayerIntent>[] = [
  ...[0, 100].flatMap((control) => [
    createControlReceiveScenario({ control, easy: true }),
    createControlReceiveScenario({ control }),
    createControlReceiveScenario({ control, height: 1.2 }),
    createControlReceiveScenario({ control, source: 'low' }),
    createControlReceiveScenario({ control, source: 'high' }),
    createControlReceiveScenario({ control, source: 'right-stick' }),
    createControlRetentionScenario(control)
  ]),
  createControlRetentionScenario(100, true),
  createControlReceiveScenario({ control: 50, contested: true }),
  createControlReceiveScenario({ control: 50, misaligned: true })
];
