import { describe, expect, it } from 'vitest';
import { createArenaDefinition } from '../physics/arena';
import { PLAYER_MOVEMENT_DIAGNOSTIC_LAYER } from '../sim/diagnostics';
import { stepGame } from '../sim/stepGame';
import {
  createReplayRecorder,
  replayScenario
} from './replay';
import {
  createScenarioRun,
  runScenario,
  type ScenarioDefinition
} from './scenario';
import type { ReplayRecorder } from './replay';
import type { RoutedPlayerIntent } from '../control/types';
import {
  MOVEMENT_REVERSAL_SCENARIO_ID,
  movementAccelerationScenario,
  movementArenaBoundaryScenario,
  movementMaximumSpeedTurnScenario,
  movementReversalScenario
} from './playerMovementScenario';
import {
  MOVEMENT_ACCELERATION_KEY,
  MOVEMENT_MAX_SPEED_KEY,
  MOVEMENT_REVERSAL_RESPONSE_KEY,
  MOVEMENT_TURNING_RESPONSE_KEY
} from '../config/tuning';
import type { GameState } from '../sim/gameState';

function runMovementScenario(
  definition: ScenarioDefinition<GameState, RoutedPlayerIntent>,
  ticks: number
) {
  return runScenario({
    definition,
    step: stepGame,
    getArena: (tuning) => createArenaDefinition(tuning),
    ticks
  });
}

function player(state: GameState) {
  const result = state.players.find((candidate) => candidate.definition.id === 'player-1');
  if (!result) {
    throw new Error('Movement test player is missing.');
  }

  return result;
}

describe('field-player movement scenarios', () => {
  it('covers acceleration, coast and stop through the shared scenario harness', () => {
    const speeds: number[] = [];
    const run = runScenario({
      definition: movementAccelerationScenario,
      step: stepGame,
      getArena: (tuning) => createArenaDefinition(tuning),
      ticks: 90,
      onStep: (state) => {
        const currentPlayer = player(state);
        speeds.push(Math.hypot(currentPlayer.velocity.x, currentPlayer.velocity.y));
      }
    });

    expect(speeds[0]).toBeGreaterThan(0);
    expect(speeds[29]).toBeCloseTo(8, 8);
    expect(speeds[30]).toBeGreaterThan(0);
    expect(speeds.at(-1)).toBe(0);
    expect(player(run.state).position.y).toBeGreaterThan(0);
  });

  it('covers a hard reversal without an instantaneous direction flip', () => {
    const speedsByTick = new Map<number, number>();
    const run = runScenario({
      definition: movementReversalScenario,
      step: stepGame,
      getArena: (tuning) => createArenaDefinition(tuning),
      ticks: 120,
      onStep: (state, tick) => {
        speedsByTick.set(tick, player(state).velocity.y);
      }
    });

    expect(speedsByTick.get(30)).toBeGreaterThan(0);
    expect(speedsByTick.get(31)).toBeGreaterThan(0);
    expect(speedsByTick.get(120)).toBeLessThan(0);
    expect(player(run.state).position.y).toBeLessThan(0);
  });

  it('covers a maximum-speed turn with facing ahead of momentum', () => {
    const observations: Array<{
      tick: number;
      speed: number;
      facingX: number;
      velocityX: number;
      velocityY: number;
    }> = [];
    const run = runScenario({
      definition: movementMaximumSpeedTurnScenario,
      step: stepGame,
      getArena: (tuning) => createArenaDefinition(tuning),
      ticks: 120,
      onStep: (state, tick) => {
        const currentPlayer = player(state);
        observations.push({
          tick,
          speed: Math.hypot(currentPlayer.velocity.x, currentPlayer.velocity.y),
          facingX: currentPlayer.facing.x,
          velocityX: currentPlayer.velocity.x,
          velocityY: currentPlayer.velocity.y
        });
      }
    });

    const turnStart = observations[60];
    expect(turnStart.facingX).toBeGreaterThan(0);
    expect(turnStart.velocityY).toBeGreaterThan(0);
    expect(turnStart.facingX).toBeGreaterThan(Math.abs(turnStart.velocityX) / 8);
    expect(Math.max(...observations.map(({ speed }) => speed))).toBeLessThanOrEqual(8);
    expect(player(run.state).velocity.x).toBeGreaterThan(0);
  });

  it('keeps the player circle inside the arena and exposes boundary diagnostics', () => {
    const run = runMovementScenario(movementArenaBoundaryScenario, 1);
    const currentPlayer = player(run.state);

    expect(currentPlayer.position).toEqual({ x: 8.25, y: 0 });
    expect(currentPlayer.velocity.x).toBe(0);

    const records = run.diagnostics?.getFrame().records ?? [];
    const collisionRecord = records.find(
      (record) =>
        record.layer === PLAYER_MOVEMENT_DIAGNOSTIC_LAYER &&
        record.entityId === 'player-1-collision'
    );
    expect(collisionRecord?.data).toMatchObject({ contacts: ['right'], radius: 0.75 });
  });

  it('produces identical results across render schedules and replay', () => {
    const runAtSchedule = (schedule: readonly number[]): GameState => {
      const run = createScenarioRun({
        definition: movementReversalScenario,
        step: stepGame,
        getArena: (tuning) => createArenaDefinition(tuning)
      });

      for (const frameDeltaSeconds of schedule) {
        run.runtime.advance(frameDeltaSeconds);
      }

      return run.state;
    };

    const atThirtyHz = runAtSchedule(Array.from({ length: 60 }, () => 1 / 30));
    const atSixtyHz = runAtSchedule(Array.from({ length: 120 }, () => 1 / 60));
    const atOneTwentyHz = runAtSchedule(Array.from({ length: 240 }, () => 1 / 120));

    expect(atThirtyHz).toEqual(atSixtyHz);
    expect(atOneTwentyHz).toEqual(atSixtyHz);

    let recorder: ReplayRecorder<GameState, RoutedPlayerIntent> | undefined;
    const run = createScenarioRun({
      definition: movementReversalScenario,
      step: stepGame,
      getArena: (tuning) => createArenaDefinition(tuning),
      onStep: (state, tick, input) => {
        recorder?.recordStep(tick, input, state);
      }
    });
    recorder = createReplayRecorder({
      scenarioId: MOVEMENT_REVERSAL_SCENARIO_ID,
      initialState: run.state,
      tuning: run.tuning,
      checkpointIntervalTicks: 30
    });

    run.runtime.pause();
    for (let tick = 0; tick < 120; tick += 1) {
      run.runtime.stepOnce();
    }

    const record = recorder.finish(run.state);
    const replay = replayScenario({
      scenario: movementReversalScenario,
      step: stepGame,
      getArena: (tuning) => createArenaDefinition(tuning),
      replay: record
    });

    expect(replay.run.state).toEqual(run.state);
    expect(replay.finalStateHash).toBe(record.finalStateHash);
  });

  it('exposes movement tuning through the scenario registry', () => {
    const run = runMovementScenario(movementAccelerationScenario, 1);

    expect(run.tuning.get(MOVEMENT_MAX_SPEED_KEY)).toMatchObject({
      domain: 'movement',
      defaultValue: 8,
      effectiveValue: 8
    });
    expect(run.tuning.get(MOVEMENT_ACCELERATION_KEY).domain).toBe('movement');
    expect(run.tuning.get(MOVEMENT_TURNING_RESPONSE_KEY).domain).toBe('movement');
    expect(run.tuning.get(MOVEMENT_REVERSAL_RESPONSE_KEY).domain).toBe('movement');
  });
});
