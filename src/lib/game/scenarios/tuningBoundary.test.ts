import { describe, expect, it } from 'vitest';
import type { RoutedPlayerIntent } from '../control/types';
import { createTuningRegistry } from '../config/tuning';
import { createArenaDefinition } from '../physics/arena';
import { stepGame } from '../sim/stepGame';
import type { GameState } from '../sim/gameState';
import { DEFAULT_SCENARIOS } from './defaultScenarios';
import { runScenario, type ScenarioDefinition } from './scenario';

type DefaultScenario = ScenarioDefinition<GameState, RoutedPlayerIntent>;

function runBoundaryScenarios(
  definition: DefaultScenario,
  tuningKey: string,
  tuningValue: number
): void {
  const tuningOverrides = [
    ...(definition.tuningOverrides ?? []),
    { key: tuningKey, value: tuningValue }
  ];

  try {
    runScenario({
      definition,
      step: stepGame,
      getArena: (tuning) => createArenaDefinition(tuning),
      tuningOverrides,
      diagnosticsEnabled: false,
      ticks: definition.automatedRunTicks
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Tuning boundary '${tuningKey}=${tuningValue}' failed in scenario '${definition.id}': ${message}`
    );
  }
}

describe('Workbench tuning boundaries', () => {
  it('either rejects each boundary atomically or runs every registered scenario', () => {
    const tuningDefinitions = createTuningRegistry().list();

    for (const definition of tuningDefinitions) {
      for (const boundary of ['min', 'max'] as const) {
        const tuning = createTuningRegistry();
        const before = tuning.list();
        const value = definition[boundary];

        try {
          tuning.setOverride(definition.key, value);
        } catch {
          expectUnchanged(tuning.list(), before);
          continue;
        }

        for (const scenario of DEFAULT_SCENARIOS) {
          runBoundaryScenarios(scenario, definition.key, value);
        }
      }
    }
  });
});

function expectUnchanged<T>(actual: T, expected: T): void {
  expect(actual).toEqual(expected);
}
