import { createDiagnosticStore, type DiagnosticStore } from '../debug/diagnosticStore';
import {
  createFixedStepRuntime,
  DEFAULT_FIXED_STEP_SECONDS,
  type FixedStepRuntime,
  type FixedStepStepContext
} from '../runtime/fixedStepRuntime';
import type { DiagnosticLayerDefinition } from '../sim/diagnostics';
import type { GameState } from '../sim/gameState';
import type { ArenaDefinition } from '../physics/arena';
import {
  createTuningRegistry,
  type NumericTuningDefinition,
  type TuningRegistry
} from '../config/tuning';

export interface ScenarioInputFrame<TInput> {
  readonly tick: number;
  readonly input: TInput;
}

export interface ScenarioTuningOverride {
  readonly key: string;
  readonly value: number;
}

export interface ScenarioDiagnosticLayerOverride {
  readonly key: string;
  readonly enabled: boolean;
}

export interface ScenarioAssertion<TState extends GameState> {
  readonly id: string;
  readonly check: (state: TState, tick: number) => void | boolean;
}

export interface ScenarioDefinition<
  TState extends GameState = GameState,
  TInput = unknown
> {
  readonly id: string;
  readonly name: string;
  readonly createInitialState: () => TState;
  readonly scriptedInputs?: readonly ScenarioInputFrame<TInput>[];
  readonly tuningOverrides?: readonly ScenarioTuningOverride[];
  readonly diagnosticLayerOverrides?: readonly ScenarioDiagnosticLayerOverride[];
  readonly assertions?: readonly ScenarioAssertion<TState>[];
}

export type ScenarioStep<TState extends GameState, TInput> = (
  state: TState,
  fixedStepSeconds: number,
  context: FixedStepStepContext,
  input: TInput | undefined
) => void;

export interface ScenarioRunOptions<TState extends GameState, TInput> {
  readonly definition: ScenarioDefinition<TState, TInput>;
  readonly step: ScenarioStep<TState, TInput>;
  readonly fixedStepSeconds?: number;
  readonly maxCatchUpSteps?: number;
  readonly tuningDefinitions?: readonly NumericTuningDefinition[];
  readonly diagnosticDefinitions?: readonly DiagnosticLayerDefinition[];
  readonly getArena?: (tuning: TuningRegistry) => ArenaDefinition;
  readonly inputFrames?: readonly ScenarioInputFrame<TInput>[];
  readonly inputProvider?: (
    tick: number,
    context: FixedStepStepContext
  ) => TInput | undefined;
  readonly tuningOverrides?: readonly ScenarioTuningOverride[];
  readonly onStep?: (state: TState, tick: number, input: TInput | undefined) => void;
}

export interface ScenarioRun<TState extends GameState, TInput> {
  readonly definition: ScenarioDefinition<TState, TInput>;
  readonly state: TState;
  readonly runtime: FixedStepRuntime<TState, TInput>;
  readonly tuning: TuningRegistry;
  readonly diagnostics: DiagnosticStore;
  readonly getArena?: () => ArenaDefinition;
  readonly inputFrames: readonly ScenarioInputFrame<TInput>[];
}

export interface RunScenarioOptions<TState extends GameState, TInput>
  extends ScenarioRunOptions<TState, TInput> {
  readonly ticks: number;
}

export class ScenarioAssertionError extends Error {
  readonly scenarioId: string;
  readonly scenarioName: string;
  readonly tick: number;
  readonly assertionId: string;

  constructor(
    scenario: { readonly id: string; readonly name: string },
    tick: number,
    assertionId: string,
    reason: string
  ) {
    super(
      `Scenario '${scenario.id}' (${scenario.name}) failed invariant '${assertionId}' ` +
        `at tick ${tick}: ${reason}`
    );
    this.name = 'ScenarioAssertionError';
    this.scenarioId = scenario.id;
    this.scenarioName = scenario.name;
    this.tick = tick;
    this.assertionId = assertionId;
  }
}

function assertNonEmpty(value: string, description: string): void {
  if (!value.trim()) {
    throw new RangeError(`${description} must have a non-empty value.`);
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function validateInputFrames<TInput>(
  frames: readonly ScenarioInputFrame<TInput>[],
  initialTick: number
): Map<number, TInput> {
  const inputs = new Map<number, TInput>();
  let previousTick = initialTick;

  for (const frame of frames) {
    if (!Number.isInteger(frame.tick) || frame.tick <= initialTick) {
      throw new RangeError(
        `Scenario input ticks must be integers after the initial tick ${initialTick}.`
      );
    }

    if (frame.tick <= previousTick) {
      throw new RangeError('Scenario input frames must be ordered by strictly increasing tick.');
    }

    inputs.set(frame.tick, frame.input);
    previousTick = frame.tick;
  }

  return inputs;
}

function validateScenario<TState extends GameState, TInput>(
  definition: ScenarioDefinition<TState, TInput>,
  state: TState
): void {
  assertNonEmpty(definition.id, 'A scenario ID');
  assertNonEmpty(definition.name, `Scenario '${definition.id}' name`);

  if (!Number.isInteger(state.tick) || state.tick < 0) {
    throw new RangeError(`Scenario '${definition.id}' must create a non-negative integer tick.`);
  }

  for (const assertion of definition.assertions ?? []) {
    assertNonEmpty(assertion.id, `Scenario '${definition.id}' assertion ID`);
  }

  for (const override of definition.tuningOverrides ?? []) {
    assertNonEmpty(override.key, `Scenario '${definition.id}' tuning key`);
  }

  for (const override of definition.diagnosticLayerOverrides ?? []) {
    assertNonEmpty(override.key, `Scenario '${definition.id}' diagnostic layer key`);
  }
}

function applyTuningOverrides(
  tuning: TuningRegistry,
  overrides: readonly ScenarioTuningOverride[]
): void {
  for (const override of overrides) {
    tuning.setOverride(override.key, override.value);
  }
}

function applyDiagnosticLayerOverrides(
  diagnostics: DiagnosticStore,
  overrides: readonly ScenarioDiagnosticLayerOverride[]
): void {
  for (const override of overrides) {
    diagnostics.setLayerEnabled(override.key, override.enabled);
  }
}

function runAssertions<TState extends GameState, TInput>(
  definition: ScenarioDefinition<TState, TInput>,
  state: TState,
  tick: number
): void {
  for (const assertion of definition.assertions ?? []) {
    try {
      if (assertion.check(state, tick) === false) {
        throw new Error('The assertion returned false.');
      }
    } catch (error) {
      throw new ScenarioAssertionError(definition, tick, assertion.id, errorMessage(error));
    }
  }
}

export function createScenarioRun<TState extends GameState, TInput>(
  options: ScenarioRunOptions<TState, TInput>
): ScenarioRun<TState, TInput> {
  const state = options.definition.createInitialState();
  validateScenario(options.definition, state);

  const inputFrames = options.inputFrames ?? options.definition.scriptedInputs ?? [];
  const inputByTick = validateInputFrames(inputFrames, state.tick);
  const tuning = createTuningRegistry(options.tuningDefinitions);
  const diagnostics = createDiagnosticStore(options.diagnosticDefinitions);

  applyTuningOverrides(
    tuning,
    options.tuningOverrides ?? options.definition.tuningOverrides ?? []
  );
  applyDiagnosticLayerOverrides(diagnostics, options.definition.diagnosticLayerOverrides ?? []);

  const arenaFactory = options.getArena;
  const getArena = arenaFactory ? () => arenaFactory(tuning) : undefined;
  const inputProvider =
    options.inputProvider ?? ((tick: number): TInput | undefined => inputByTick.get(tick));

  const runtime = createFixedStepRuntime<TState, TInput>({
    state,
    getInput: inputProvider,
    step: (stepState, fixedStepSeconds, context, input) => {
      const tick = stepState.tick + 1;
      options.step(stepState, fixedStepSeconds, context, input);
      options.onStep?.(stepState, tick, input);
      runAssertions(options.definition, stepState, tick);
    },
    fixedStepSeconds: options.fixedStepSeconds ?? DEFAULT_FIXED_STEP_SECONDS,
    maxCatchUpSteps: options.maxCatchUpSteps,
    tuning,
    diagnostics,
    getArena
  });

  return {
    definition: options.definition,
    state,
    runtime,
    tuning,
    diagnostics,
    getArena,
    inputFrames
  };
}

export function runScenario<TState extends GameState, TInput>(
  options: RunScenarioOptions<TState, TInput>
): ScenarioRun<TState, TInput> {
  if (!Number.isInteger(options.ticks) || options.ticks < 0) {
    throw new RangeError('A scenario run must use a non-negative integer tick count.');
  }

  const run = createScenarioRun(options);
  run.runtime.pause();

  for (let index = 0; index < options.ticks; index += 1) {
    run.runtime.stepOnce();
  }

  return run;
}
