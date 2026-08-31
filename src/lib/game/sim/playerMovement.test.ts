import { describe, expect, it } from 'vitest';
import {
  MOVEMENT_ACCELERATION_KEY,
  MOVEMENT_REVERSAL_RESPONSE_KEY,
  MOVEMENT_MAX_SPEED_KEY,
  MOVEMENT_TURNING_RESPONSE_KEY,
  createTuningRegistry
} from '../config/tuning';
import { createArenaDefinition } from '../physics/arena';
import { isCircleWithinBounds } from '../physics/geometry';
import { createFieldPlayerState } from './gameState';
import { integrateFieldPlayer } from './playerMovement';
import { createRoutedMovementIntent } from '../scenarios/playerMovementScenario';

const FIXED_STEP_SECONDS = 1 / 60;

function createMovementContext() {
  const tuning = createTuningRegistry();
  return { tuning, arena: createArenaDefinition(tuning) };
}

describe('field-player movement', () => {
  it('accelerates, carries momentum, then brakes to a stop', () => {
    const { tuning, arena } = createMovementContext();
    const player = createFieldPlayerState();

    integrateFieldPlayer(
      player,
      createRoutedMovementIntent({ x: 0, y: 1 }).intent,
      FIXED_STEP_SECONDS,
      tuning,
      arena
    );
    expect(player.velocity.y).toBeGreaterThan(0);
    expect(player.velocity.y).toBeLessThan(tuning.getNumber(MOVEMENT_MAX_SPEED_KEY));

    for (let tick = 0; tick < 29; tick += 1) {
      integrateFieldPlayer(
        player,
        createRoutedMovementIntent({ x: 0, y: 1 }).intent,
        FIXED_STEP_SECONDS,
        tuning,
        arena
      );
    }

    const coastPosition = player.position.y;
    const coast = integrateFieldPlayer(
      player,
      undefined,
      FIXED_STEP_SECONDS,
      tuning,
      arena
    );
    expect(coast.velocity.y).toBeGreaterThan(0);
    expect(player.position.y).toBeGreaterThan(coastPosition);

    for (let tick = 0; tick < 30; tick += 1) {
      integrateFieldPlayer(
        player,
        undefined,
        FIXED_STEP_SECONDS,
        tuning,
        arena
      );
    }

    expect(player.velocity).toEqual({ x: 0, y: 0 });
  });

  it('does not instantly reverse velocity and lets facing lead a turn', () => {
    const { tuning, arena } = createMovementContext();
    const player = createFieldPlayerState();
    const forward = createRoutedMovementIntent({ x: 0, y: 1 }).intent;

    for (let tick = 0; tick < 30; tick += 1) {
      integrateFieldPlayer(player, forward, FIXED_STEP_SECONDS, tuning, arena);
    }

    const speedBeforeReversal = player.velocity.y;
    const reversal = integrateFieldPlayer(
      player,
      createRoutedMovementIntent({ x: 0, y: -1 }).intent,
      FIXED_STEP_SECONDS,
      tuning,
      arena
    );
    expect(reversal.velocity.y).toBeGreaterThan(0);
    expect(reversal.velocity.y).toBeLessThan(speedBeforeReversal);

    const turn = integrateFieldPlayer(
      player,
      createRoutedMovementIntent({ x: 1, y: 0 }).intent,
      FIXED_STEP_SECONDS,
      tuning,
      arena
    );
    expect(turn.facing.x).toBeGreaterThan(0);
    expect(turn.velocity.y).toBeGreaterThan(turn.velocity.x);

    const facingBeforeNeutral = player.facing;
    const neutral = integrateFieldPlayer(
      player,
      undefined,
      FIXED_STEP_SECONDS,
      tuning,
      arena
    );
    expect(neutral.facing).toEqual(facingBeforeNeutral);
  });

  it('tunes acceleration, turning, and reversal responses independently', () => {
    const accelerationTuning = createTuningRegistry();
    accelerationTuning.setOverride(MOVEMENT_ACCELERATION_KEY, 6);
    const accelerationPlayer = createFieldPlayerState();

    integrateFieldPlayer(
      accelerationPlayer,
      createRoutedMovementIntent({ x: 0, y: 1 }).intent,
      FIXED_STEP_SECONDS,
      accelerationTuning,
      createArenaDefinition(accelerationTuning)
    );
    expect(accelerationPlayer.velocity.y).toBeCloseTo(0.1, 10);

    const slowTurningTuning = createTuningRegistry();
    slowTurningTuning.setOverride(MOVEMENT_ACCELERATION_KEY, 60);
    slowTurningTuning.setOverride(MOVEMENT_TURNING_RESPONSE_KEY, 6);
    slowTurningTuning.setOverride(MOVEMENT_REVERSAL_RESPONSE_KEY, 6);
    const slowTurningPlayer = createFieldPlayerState({ velocity: { x: 0, y: 8 } });

    integrateFieldPlayer(
      slowTurningPlayer,
      createRoutedMovementIntent({ x: 1, y: 0 }).intent,
      FIXED_STEP_SECONDS,
      slowTurningTuning,
      createArenaDefinition(slowTurningTuning)
    );

    const fastTurningTuning = createTuningRegistry();
    fastTurningTuning.setOverride(MOVEMENT_ACCELERATION_KEY, 6);
    fastTurningTuning.setOverride(MOVEMENT_TURNING_RESPONSE_KEY, 60);
    fastTurningTuning.setOverride(MOVEMENT_REVERSAL_RESPONSE_KEY, 6);
    const fastTurningPlayer = createFieldPlayerState({ velocity: { x: 0, y: 8 } });

    integrateFieldPlayer(
      fastTurningPlayer,
      createRoutedMovementIntent({ x: 1, y: 0 }).intent,
      FIXED_STEP_SECONDS,
      fastTurningTuning,
      createArenaDefinition(fastTurningTuning)
    );

    expect(fastTurningPlayer.velocity.x).toBeGreaterThan(slowTurningPlayer.velocity.x);

    const slowReversalTuning = createTuningRegistry();
    slowReversalTuning.setOverride(MOVEMENT_ACCELERATION_KEY, 60);
    slowReversalTuning.setOverride(MOVEMENT_TURNING_RESPONSE_KEY, 60);
    slowReversalTuning.setOverride(MOVEMENT_REVERSAL_RESPONSE_KEY, 6);
    const slowReversalPlayer = createFieldPlayerState({ velocity: { x: 0, y: 8 } });

    integrateFieldPlayer(
      slowReversalPlayer,
      createRoutedMovementIntent({ x: 0, y: -1 }).intent,
      FIXED_STEP_SECONDS,
      slowReversalTuning,
      createArenaDefinition(slowReversalTuning)
    );

    const fastReversalTuning = createTuningRegistry();
    fastReversalTuning.setOverride(MOVEMENT_ACCELERATION_KEY, 6);
    fastReversalTuning.setOverride(MOVEMENT_TURNING_RESPONSE_KEY, 6);
    fastReversalTuning.setOverride(MOVEMENT_REVERSAL_RESPONSE_KEY, 30);
    const fastReversalPlayer = createFieldPlayerState({ velocity: { x: 0, y: 8 } });

    integrateFieldPlayer(
      fastReversalPlayer,
      createRoutedMovementIntent({ x: 0, y: -1 }).intent,
      FIXED_STEP_SECONDS,
      fastReversalTuning,
      createArenaDefinition(fastReversalTuning)
    );

    expect(fastReversalPlayer.velocity.y).toBeLessThan(slowReversalPlayer.velocity.y);
    expect(fastReversalPlayer.velocity.y).toBeGreaterThan(0);
  });

  it('applies live maximum-speed tuning and constrains the circle at the boundary', () => {
    const { tuning, arena } = createMovementContext();
    tuning.setOverride(MOVEMENT_MAX_SPEED_KEY, 4);
    const player = createFieldPlayerState({
      position: { x: 8.2, y: 0 },
      velocity: { x: 8, y: 0 }
    });

    const result = integrateFieldPlayer(
      player,
      createRoutedMovementIntent({ x: 1, y: 0 }).intent,
      FIXED_STEP_SECONDS,
      tuning,
      arena
    );

    expect(result.contacts).toEqual(['right']);
    expect(player.position.x).toBe(8.25);
    expect(player.velocity.x).toBe(0);
    expect(isCircleWithinBounds(player.position, tuning.getNumber('player.radius'), arena.bounds)).toBe(
      true
    );
    expect(Math.hypot(player.velocity.x, player.velocity.y)).toBeLessThanOrEqual(4);
  });
});
