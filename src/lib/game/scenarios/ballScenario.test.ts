import { describe, expect, it } from 'vitest';
import { BALL_RADIUS_KEY } from '../config/tuning';
import { createArenaDefinition } from '../physics/arena';
import { BALL_DIAGNOSTIC_LAYER } from '../sim/diagnostics';
import type { GameState } from '../sim/gameState';
import { stepGame } from '../sim/stepGame';
import { DEFAULT_SCENARIOS } from './defaultScenarios';
import {
  BALL_DIAGONAL_NEAR_POST_SCENARIO_ID,
  BALL_LOB_FLIGHT_SCENARIO_ID,
  BALL_MAX_SPEED_SWEEP_SCENARIO_ID,
  BALL_OVER_CROSSBAR_SCENARIO_ID,
  BALL_RISING_NEAR_CROSSBAR_SCENARIO_ID,
  BALL_SCENARIOS,
  BALL_VALID_LOW_APERTURE_SCENARIO_ID,
  BALL_VALID_SLOW_APERTURE_SCENARIO_ID,
  ballDiagonalNearPostScenario,
  ballLobFlightScenario,
  ballMaximumSpeedSweepScenario,
  ballOverCrossbarScenario,
  ballRisingNearCrossbarScenario,
  ballValidLowApertureScenario,
  ballValidSlowApertureScenario,
  ballLowWallReboundScenario
} from './ballScenario';
import { runScenario, type ScenarioDefinition } from './scenario';
import type { RoutedPlayerIntent } from '../control/types';

function runBallScenario(
  definition: ScenarioDefinition<GameState, RoutedPlayerIntent>
) {
  const initialState = definition.createInitialState();
  if (initialState.ball.mode !== 'loose') {
    throw new Error('Ball scenario must start with a loose ball.');
  }
  let maximumHeight = initialState.ball.height;
  const run = runScenario({
    definition,
    step: stepGame,
    getArena: (tuning) => createArenaDefinition(tuning),
    ticks: definition.automatedRunTicks,
    onStep: (state) => {
      if (state.ball.mode === 'loose') {
        maximumHeight = Math.max(maximumHeight, state.ball.height);
      }
    }
  });

  return { run, maximumHeight };
}

function ballStateRecord(run: ReturnType<typeof runBallScenario>) {
  return run.run.diagnostics
    ?.getFrame()
    .records.find(
      (record) =>
        record.layer === BALL_DIAGNOSTIC_LAYER && record.entityId === 'ball-state'
    );
}

describe('loose-ball scenarios', () => {
  it('registers all required reusable scenario definitions', () => {
    expect(BALL_SCENARIOS).toHaveLength(8);
    expect(DEFAULT_SCENARIOS.filter((scenario) => scenario.id.startsWith('ball-'))).toHaveLength(
      8
    );
  });

  it('runs a low side-wall rebound scenario', () => {
    const result = runBallScenario(ballLowWallReboundScenario);
    const data = ballStateRecord(result)?.data as { contacts: Array<{ boundary: string }> };

    expect(data.contacts.map((contact) => contact.boundary)).toContain('right');
    expect(result.run.state.ball.mode).toBe('loose');
    if (result.run.state.ball.mode === 'loose') {
      expect(result.run.state.ball.velocity.x).toBeLessThan(0);
    }
  });

  it('runs the maximum-speed sweep scenario without escaping a solid wall', () => {
    const result = runBallScenario(ballMaximumSpeedSweepScenario);
    const arena = createArenaDefinition(result.run.tuning);

    expect(result.run.state.ball.mode).toBe('loose');
    if (result.run.state.ball.mode === 'loose') {
      expect(result.run.state.ball.position.x).toBeLessThanOrEqual(
        arena.bounds.maxX - result.run.tuning.getNumber(BALL_RADIUS_KEY) + 1e-7
      );
      expect(result.run.state.ball.velocity.x).toBeLessThan(0);
    }
  });

  it('passes the centred low aperture scenario through the end boundary', () => {
    const result = runBallScenario(ballValidLowApertureScenario);
    const data = ballStateRecord(result)?.data as {
      contacts: unknown[];
      goalAperture: { crossed: boolean };
    };

    expect(data.goalAperture.crossed).toBe(true);
    expect(data.contacts).toEqual([]);
    expect(result.run.state.ball.mode).toBe('loose');
    if (result.run.state.ball.mode === 'loose') {
      expect(result.run.state.ball.position.y).toBeGreaterThan(
        createArenaDefinition(result.run.tuning).bounds.maxY -
          result.run.tuning.getNumber(BALL_RADIUS_KEY)
      );
    }
  });

  it('rebound scenarios report invalid aperture decisions', () => {
    const nearPost = runBallScenario(ballDiagonalNearPostScenario);
    const nearPostData = ballStateRecord(nearPost)?.data as {
      goalAperture: { horizontalFit: boolean; crossed: boolean };
      contacts: Array<{ boundary: string }>;
    };
    expect(nearPostData.goalAperture.horizontalFit).toBe(false);
    expect(nearPostData.goalAperture.crossed).toBe(false);
    expect(nearPostData.contacts.map((contact) => contact.boundary)).toContain('top');

    const nearCrossbar = runBallScenario(ballRisingNearCrossbarScenario);
    const nearCrossbarData = ballStateRecord(nearCrossbar)?.data as {
      goalAperture: { verticalFit: boolean; crossed: boolean };
      contacts: Array<{ boundary: string }>;
    };
    expect(nearCrossbarData.goalAperture.verticalFit).toBe(false);
    expect(nearCrossbarData.goalAperture.crossed).toBe(false);
    expect(nearCrossbarData.contacts.map((contact) => contact.boundary)).toContain('top');
  });

  it('passes the valid slow aperture scenario without a false rebound', () => {
    const result = runBallScenario(ballValidSlowApertureScenario);
    const data = ballStateRecord(result)?.data as {
      contacts: unknown[];
      goalAperture: { crossed: boolean };
    };

    expect(data.goalAperture.crossed).toBe(true);
    expect(data.contacts).toEqual([]);
    expect(result.run.state.ball.mode).toBe('loose');
    if (result.run.state.ball.mode === 'loose') {
      expect(result.run.state.ball.velocity.y).toBeGreaterThan(0);
    }
  });

  it('shows a lob arc and keeps the scenario deterministic', () => {
    const first = runBallScenario(ballLobFlightScenario);
    const second = runBallScenario(ballLobFlightScenario);

    expect(first.maximumHeight).toBeGreaterThan(5);
    expect(first.run.state.ball.mode).toBe('loose');
    if (first.run.state.ball.mode === 'loose') {
      expect(first.run.state.ball.height).toBeGreaterThanOrEqual(0);
    }
    expect(second.run.state).toEqual(first.run.state);
  });

  it('rebound above the crossbar in the over-crossbar scenario', () => {
    const result = runBallScenario(ballOverCrossbarScenario);
    const data = ballStateRecord(result)?.data as {
      goalAperture: { verticalFit: boolean; crossed: boolean };
      contacts: Array<{ boundary: string }>;
    };

    expect(data.goalAperture.verticalFit).toBe(false);
    expect(data.goalAperture.crossed).toBe(false);
    expect(data.contacts.map((contact) => contact.boundary)).toContain('top');
  });

  it('keeps the named scenario identifiers available for workbench selection', () => {
    const ids = new Set(BALL_SCENARIOS.map((scenario) => scenario.id));

    expect(ids).toEqual(
      new Set([
        BALL_MAX_SPEED_SWEEP_SCENARIO_ID,
        BALL_VALID_LOW_APERTURE_SCENARIO_ID,
        BALL_DIAGONAL_NEAR_POST_SCENARIO_ID,
        BALL_RISING_NEAR_CROSSBAR_SCENARIO_ID,
        BALL_VALID_SLOW_APERTURE_SCENARIO_ID,
        BALL_LOB_FLIGHT_SCENARIO_ID,
        BALL_OVER_CROSSBAR_SCENARIO_ID,
        'ball-low-wall-rebound'
      ])
    );
  });
});
