import { describe, expect, it } from 'vitest';
import type { RoutedPlayerIntent } from '../control/types';
import { createTuningRegistry } from '../config/tuning';
import { createArenaDefinition } from '../physics/arena';
import { stepControlledGame } from '../runtime/stepControlledGame';
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
      step: (state, seconds, context, input) =>
        (state.tactics ? stepControlledGame : stepGame)(state, seconds, context, input),
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
  it.each(createTuningRegistry().list())('$key rejects boundaries atomically or runs every scenario', (definition) => {
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
  }, 120_000); // Each parameter still exercises both boundaries against the complete scenario list.
});

function expectUnchanged<T>(actual: T, expected: T): void {
  expect(actual).toEqual(expected);
}
