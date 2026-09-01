import type { RoutedPlayerIntent } from '../control/types';
import type { GameState } from './gameState';
import {
  BALL_DIAGNOSTIC_LAYER,
  ARENA_DIAGNOSTIC_LAYER,
  PLAYER_MOVEMENT_DIAGNOSTIC_LAYER,
  RUNTIME_DIAGNOSTIC_LAYER,
  type SimulationStepContext,
} from './diagnostics';
import { createArenaDiagnosticRecords } from './arenaDiagnostics';
import { createPlayerDiagnosticRecords } from './playerDiagnostics';
import { createBallDiagnosticRecords } from './ballDiagnostics';
import {
  advanceLooseBall,
  predictLooseBallTrajectory,
  type LooseBallStepResult
} from '../physics/ballTrajectory';
import { BALL_RADIUS_KEY } from '../config/tuning';
import {
  integrateFieldPlayer,
  type PlayerMovementObservation
} from './playerMovement';

export function stepGame(
  state: GameState,
  fixedStepSeconds: number,
  context: SimulationStepContext = {},
  input?: RoutedPlayerIntent
): void {
  if (!Number.isFinite(fixedStepSeconds) || fixedStepSeconds <= 0) {
    throw new RangeError('The simulation step must be a finite positive duration.');
  }

  if (!context.tuning) {
    throw new Error('Simulation requires a tuning registry.');
  }
  if (!context.arena) {
    throw new Error('Simulation requires an arena definition.');
  }

  const observations: PlayerMovementObservation[] = [];
  if (state.players.length > 0) {

    for (const player of state.players) {
      if (player.definition.role !== 'field') {
        continue;
      }

      const playerInput = input?.playerId === player.definition.id ? input.intent : undefined;
      observations.push(
        integrateFieldPlayer(
          player,
          playerInput,
          fixedStepSeconds,
          context.tuning,
          context.arena
        )
      );
    }
  }

  let ballStep: LooseBallStepResult | undefined;
  if (state.ball.mode === 'loose') {
    ballStep = advanceLooseBall(state.ball, fixedStepSeconds, context.tuning, context.arena);
    state.ball.position = ballStep.nextState.position;
    state.ball.velocity = ballStep.nextState.velocity;
    state.ball.height = ballStep.nextState.height;
    state.ball.verticalVelocity = ballStep.nextState.verticalVelocity;
  }

  state.tick += 1;

  if (context.diagnostics?.isLayerEnabled(RUNTIME_DIAGNOSTIC_LAYER)) {
    context.diagnostics.publish({
      layer: RUNTIME_DIAGNOSTIC_LAYER,
      source: 'stepGame',
      primitive: {
        type: 'label',
        position: { x: 0, y: 0 },
        text: `Fixed tick ${state.tick}`,
        color: '#e7ecff'
      }
    });
  }

  if (context.arena && context.diagnostics?.isLayerEnabled(ARENA_DIAGNOSTIC_LAYER)) {
    for (const record of createArenaDiagnosticRecords(context.arena)) {
      context.diagnostics.publish(record);
    }
  }

  if (
    context.diagnostics?.isLayerEnabled(PLAYER_MOVEMENT_DIAGNOSTIC_LAYER)
  ) {
    for (const observation of observations) {
      for (const record of createPlayerDiagnosticRecords(state.tick, observation)) {
        context.diagnostics.publish(record);
      }
    }
  }

  if (
    ballStep &&
    state.ball.mode === 'loose' &&
    context.diagnostics?.isLayerEnabled(BALL_DIAGNOSTIC_LAYER)
  ) {
    const prediction = predictLooseBallTrajectory(state.ball, context.tuning, context.arena);
    for (const record of createBallDiagnosticRecords(
      state.tick,
      state.ball,
      context.tuning.getNumber(BALL_RADIUS_KEY),
      ballStep,
      prediction
    )) {
      context.diagnostics.publish(record);
    }
  }
}
