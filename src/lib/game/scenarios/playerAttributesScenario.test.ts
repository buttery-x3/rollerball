import { describe, expect, it } from 'vitest';
import {
  createPlayerAttributes,
  DEFAULT_PLAYER_ATTRIBUTES,
  type PlayerDerivedValue
} from '../config/playerAttributes';
import {
  ATTRIBUTES_SPEED_SPREAD_KEY,
  MOVEMENT_MAX_SPEED_KEY
} from '../config/tuning';
import { createArenaDefinition } from '../physics/arena';
import { createFieldPlayerState, type GameState } from '../sim/gameState';
import { stepGame } from '../sim/stepGame';
import type { RoutedPlayerIntent } from '../control/types';
import { DEFAULT_SCENARIOS } from './defaultScenarios';
import {
  createAttributeMovementScenario,
  createAttributeThrowScenario,
  PLAYER_ATTRIBUTE_SCENARIOS
} from './playerAttributesScenario';
import { createScenarioRun, runScenario, type ScenarioDefinition } from './scenario';
import { createReplayRecorder, replayScenario, type ReplayRecorder } from './replay';

type Definition = ScenarioDefinition<GameState, RoutedPlayerIntent>;

function run(definition: Definition, ticks = definition.automatedRunTicks, diagnosticsEnabled = true) {
  return runScenario({ definition, ticks, diagnosticsEnabled, step: stepGame, getArena: createArenaDefinition });
}

function movementSamples(value: number) {
  const samples = new Map<number, GameState['players'][number]>();
  const definition = createAttributeMovementScenario('agility', value);
  runScenario({
    definition, ticks: definition.automatedRunTicks, step: stepGame,
    getArena: createArenaDefinition, diagnosticsEnabled: false,
    onStep: (state, tick) => samples.set(tick, structuredClone(state.players[0]))
  });
  return samples;
}

function velocityChange(samples: ReturnType<typeof movementSamples>, tick: number) {
  const before = samples.get(tick - 1)!.velocity;
  const after = samples.get(tick)!.velocity;
  return Math.hypot(after.x - before.x, after.y - before.y);
}

describe('player attributes through shared scenarios', () => {
  it('keeps bounded baseline attributes in immutable player definition data', () => {
    const player = createFieldPlayerState();
    expect(player.definition.attributes).toEqual(DEFAULT_PLAYER_ATTRIBUTES);
    expect(Object.isFrozen(player.definition)).toBe(true);
    expect(Object.isFrozen(player.definition.attributes)).toBe(true);
    for (const key of Object.keys(DEFAULT_PLAYER_ATTRIBUTES)) {
      for (const value of [-1, 101, NaN, Infinity]) {
        expect(() => createPlayerAttributes({ [key]: value })).toThrow(RangeError);
      }
    }
  });

  it('shows Speed differences at maximum speed through unchanged movement intents', () => {
    const slow = run(createAttributeMovementScenario('speed', 0), 30).state.players[0];
    const baseline = run(createAttributeMovementScenario('speed', 50), 30).state.players[0];
    const fast = run(createAttributeMovementScenario('speed', 100), 30).state.players[0];
    expect(slow.velocity.y).toBeCloseTo(8.25);
    expect(baseline.velocity.y).toBeCloseTo(11);
    expect(fast.velocity.y).toBeCloseTo(13.75);
    expect(fast.position.y).toBeGreaterThan(slow.position.y);
  });

  it('changes acceleration, turning, facing, reversal and braking through Agility', () => {
    const low = movementSamples(0);
    const high = movementSamples(100);
    expect(high.get(4)!.velocity.y).toBeCloseTo(6);
    expect(low.get(4)!.velocity.y).toBeCloseTo(2);
    expect(high.get(31)!.facing.x).toBeGreaterThan(low.get(31)!.facing.x);
    for (const tick of [31, 61, 121]) {
      expect(velocityChange(high, tick)).toBeGreaterThan(velocityChange(low, tick));
    }
  });

  it.each(['low', 'high', 'right-stick'] as const)(
    'scales ordinary and one-touch %s launches with the same Power curve', (source) => {
      for (const oneTouch of [false, true]) {
        const family = source === 'high' ? 'high' : 'low';
        const rightStick = source === 'right-stick';
        const low = run(createAttributeThrowScenario(0, family, oneTouch, rightStick));
        const high = run(createAttributeThrowScenario(100, family, oneTouch, rightStick));
        expect(low.state.ball.mode).toBe('loose');
        expect(high.state.ball.mode).toBe('loose');
        const launch = (result: typeof low) => {
          const records = result.diagnostics!.getFrame().records;
          if (oneTouch) {
            const summary = records.find((record) => record.entityId === 'receive-state');
            return summary?.data?.interaction as { outcome: string; velocity: { y: number }; verticalVelocity: number };
          }
          return records.find((record) => record.entityId === 'throw-release')?.data as
            { velocity: { y: number }; verticalVelocity: number };
        };
        expect(launch(low)).toBeDefined();
        expect(launch(high).velocity.y / launch(low).velocity.y).toBeCloseTo(1.25 / 0.75);
        if (family === 'high') {
          expect(launch(high).verticalVelocity / launch(low).verticalVelocity).toBeCloseTo(1.25 / 0.75);
        } else {
          expect(launch(high).verticalVelocity).toBe(0);
        }
      }
    });

  it('combines global overrides with stat mappings and publishes base/effective diagnostics', () => {
    const definition = createAttributeMovementScenario('speed', 100);
    const result = runScenario({
      definition, step: stepGame, getArena: createArenaDefinition, ticks: 30,
      tuningOverrides: [
        { key: MOVEMENT_MAX_SPEED_KEY, value: 8 },
        { key: ATTRIBUTES_SPEED_SPREAD_KEY, value: 0.5 }
      ]
    });
    expect(result.state.players[0].velocity.y).toBeCloseTo(12);
    expect(result.tuning.get(MOVEMENT_MAX_SPEED_KEY)).toMatchObject({
      defaultValue: 11, overrideValue: 8, effectiveValue: 8
    });
    const data = result.diagnostics!.getFrame().records
      .find((record) => record.entityId === 'player-1-state')!.data!;
    expect(data.attributes).toMatchObject({ speed: 100, agility: 50 });
    const derived = data.derivedValues as PlayerDerivedValue[];
    expect(derived.find((value) => value.key === MOVEMENT_MAX_SPEED_KEY)).toMatchObject({
      baseValue: 8, multiplier: 1.5, effectiveValue: 12
    });
    expect(result.state.players[0].definition.attributes.speed).toBe(100);
  });

  it('registers contrasts for the workbench and preserves outcomes with diagnostics disabled', () => {
    for (const definition of PLAYER_ATTRIBUTE_SCENARIOS) {
      expect(DEFAULT_SCENARIOS).toContain(definition);
      expect(run(definition).state).toEqual(run(definition, definition.automatedRunTicks, false).state);
    }
  });

  it('preserves attribute definitions and results across render schedules and replay', () => {
    const definition = createAttributeMovementScenario('agility', 100);
    const atFrameRate = (fps: number) => {
      const result = createScenarioRun({ definition, step: stepGame, getArena: createArenaDefinition });
      for (let index = 0; index < fps * 2.5; index++) result.runtime.advance(1 / fps);
      return result.state;
    };
    expect(atFrameRate(30)).toEqual(atFrameRate(120));
    let recorder: ReplayRecorder<GameState, RoutedPlayerIntent>;
    const result = createScenarioRun({
      definition, step: stepGame, getArena: createArenaDefinition,
      onStep: (state, tick, input) => recorder.recordStep(tick, input, state)
    });
    const definitionBefore = result.state.players[0].definition;
    recorder = createReplayRecorder({
      scenarioId: definition.id, initialState: result.state,
      tuning: result.tuning, checkpointIntervalTicks: 30
    });
    result.runtime.pause();
    for (let tick = 0; tick < definition.automatedRunTicks; tick++) result.runtime.stepOnce();
    expect(result.state.players[0].definition).toBe(definitionBefore);
    const replay = replayScenario({
      scenario: definition, replay: recorder.finish(result.state), step: stepGame,
      getArena: createArenaDefinition
    });
    expect(replay.run.state).toEqual(result.state);
  });
});
