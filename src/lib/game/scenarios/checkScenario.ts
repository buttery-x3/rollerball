import type { RoutedPlayerIntent } from '../control/types';
import type { Vec2 } from '../physics/geometry';
import {
  createFieldPlayerState,
  createLooseBallState,
  createPossessedBallState,
  type GameState
} from '../sim/gameState';
import type { ScenarioDefinition, ScenarioInputFrame } from './scenario';

const EMPTY_BUTTON = { held: false, pressed: false, released: false } as const;
export const CHECKER_ID = 'checker';
export const CHECK_TARGET_ID = 'target';

export function createCheckIntent(
  playerId = CHECKER_ID,
  pressed = true,
  movement: Vec2 = { x: 0, y: 0 }
): RoutedPlayerIntent {
  return {
    playerId,
    intent: {
      movement,
      desiredFacing: undefined,
      actionContext: 'defending',
      lowThrow: EMPTY_BUTTON,
      highThrow: EMPTY_BUTTON,
      check: { held: true, pressed, released: false },
      rightStickThrow: undefined,
      receive: { low: EMPTY_BUTTON, high: EMPTY_BUTTON, rightStickThrow: undefined }
    }
  };
}

interface CheckSetup {
  readonly speed: number;
  readonly checkerStrength?: number;
  readonly targetStrength?: number;
  readonly carrier?: boolean;
  readonly repeated?: boolean;
  readonly glancing?: boolean;
}

function initialCheckState(setup: CheckSetup): GameState {
  const checker = createFieldPlayerState({
    id: CHECKER_ID,
    teamId: 'human',
    position: { x: setup.speed < 2 ? -1.205 : -1.3, y: setup.glancing ? -0.8 : 0 },
    velocity: { x: setup.speed, y: 0 },
    facing: { x: 1, y: 0 },
    attributes: { strength: setup.checkerStrength ?? 50 }
  });
  const target = createFieldPlayerState({
    id: CHECK_TARGET_ID,
    teamId: 'opponent',
    attributes: { strength: setup.targetStrength ?? 50 }
  });
  const players = [checker, target];
  if (setup.repeated) {
    players.push(createFieldPlayerState({
      id: 'second-checker',
      teamId: 'human',
      position: { x: 0.5, y: -1.6 },
      velocity: { x: 0, y: 11 },
      facing: { x: 0, y: 1 }
    }));
  }
  return {
    tick: 0,
    players,
    ball: setup.carrier
      ? createPossessedBallState(CHECK_TARGET_ID)
      : createLooseBallState({ position: { x: 6, y: 8 } })
  };
}

function checkScenario(
  id: string,
  name: string,
  setup: CheckSetup
): ScenarioDefinition<GameState, RoutedPlayerIntent> {
  const scriptedInputs: ScenarioInputFrame<RoutedPlayerIntent>[] = [
    { tick: 1, input: createCheckIntent() }
  ];
  if (setup.repeated) {
    scriptedInputs.push({ tick: 2, input: createCheckIntent('second-checker') });
  }
  return {
    id,
    name,
    automatedRunTicks: setup.repeated ? 100 : 60,
    createInitialState: () => initialCheckState(setup),
    scriptedInputs,
    interactiveActionContext: 'defending',
    diagnosticLayerOverrides: [
      { key: 'checking', enabled: true },
      { key: 'playerContact', enabled: true }
    ],
    assertions: [{
      id: 'finite-check-state-and-single-ball-owner',
      check: (state) => {
        for (const player of state.players) {
          if (![
            player.position.x, player.position.y, player.velocity.x, player.velocity.y,
            player.contact.checkTicksRemaining, player.contact.checkRecoveryTicksRemaining,
            player.contact.stumbleTicksRemaining, player.contact.immunityTicksRemaining
          ].every(Number.isFinite)) {
            throw new Error(`Invalid check state for ${player.definition.id}.`);
          }
          if ([player.contact.checkTicksRemaining, player.contact.checkRecoveryTicksRemaining,
            player.contact.stumbleTicksRemaining, player.contact.immunityTicksRemaining]
            .some((value) => value < 0 || !Number.isInteger(value))) {
            throw new Error(`Invalid contact timer for ${player.definition.id}.`);
          }
        }
        const ball = state.ball;
        if (ball.mode === 'possessed' && !state.players.some((player) => player.definition.id === ball.holderId)) {
          throw new Error('Checking scenario ball owner is missing.');
        }
      }
    }]
  };
}

export const lowSpeedCheckScenario = checkScenario(
  'check-low-speed', 'Checking · low-speed contact', { speed: 1 }
);
export const highSpeedCheckScenario = checkScenario(
  'check-high-speed', 'Checking · high-speed contact', { speed: 11 }
);
export const glancingCheckScenario = checkScenario(
  'check-glancing', 'Checking · glancing contact', { speed: 11, glancing: true }
);
export const weakStrengthCheckScenario = checkScenario(
  'check-weaker-against-stronger', 'Checking · weaker against stronger',
  { speed: 7, checkerStrength: 0, targetStrength: 100 }
);
export const strongStrengthCheckScenario = checkScenario(
  'check-stronger-against-weaker', 'Checking · stronger against weaker',
  { speed: 7, checkerStrength: 100, targetStrength: 0 }
);
export const carrierTurnoverCheckScenario = checkScenario(
  'check-carrier-turnover', 'Checking · carrier forced turnover', { speed: 11, carrier: true }
);
export const repeatedCheckImmunityScenario = checkScenario(
  'check-repeated-contact-immunity', 'Checking · repeated contact immunity',
  { speed: 11, repeated: true }
);

export const checkFreePlayScenario: ScenarioDefinition<GameState, RoutedPlayerIntent> = {
  id: 'check-free-play',
  name: 'Checking · free play against a carrier',
  automatedRunTicks: 1,
  interactiveActionContext: 'defending',
  createInitialState: () => ({
    tick: 0,
    players: [
      createFieldPlayerState({ id: 'player-1', teamId: 'human', position: { x: -2, y: 0 }, facing: { x: 1, y: 0 } }),
      createFieldPlayerState({ id: CHECK_TARGET_ID, teamId: 'opponent', position: { x: 2, y: 0 } })
    ],
    ball: createPossessedBallState(CHECK_TARGET_ID)
  }),
  diagnosticLayerOverrides: highSpeedCheckScenario.diagnosticLayerOverrides,
  assertions: highSpeedCheckScenario.assertions
};

export const CHECK_SCENARIOS: readonly ScenarioDefinition<GameState, RoutedPlayerIntent>[] = [
  checkFreePlayScenario,
  lowSpeedCheckScenario,
  highSpeedCheckScenario,
  glancingCheckScenario,
  weakStrengthCheckScenario,
  strongStrengthCheckScenario,
  carrierTurnoverCheckScenario,
  repeatedCheckImmunityScenario
];
