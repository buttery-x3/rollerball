import { describe, expect, it } from 'vitest';
import {
  MOVEMENT_MAX_SPEED_KEY,
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
