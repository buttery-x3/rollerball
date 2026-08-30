import type { TuningRegistry } from '../config/tuning';
import type { GameState } from '../sim/gameState';
import {
  createScenarioRun,
  type ScenarioDefinition,
  type ScenarioInputFrame,
  type ScenarioRun,
  type ScenarioRunOptions,
  type ScenarioStep,
  type ScenarioTuningOverride
} from './scenario';

export const REPLAY_FORMAT_VERSION = 1 as const;

export interface ReplayCheckpoint {
  readonly tick: number;
  readonly stateHash: string;
}

export interface ReplayRecord<TInput> {
  readonly formatVersion: typeof REPLAY_FORMAT_VERSION;
  readonly scenarioId: string;
  readonly initialTick: number;
  readonly initialStateHash: string;
  readonly tuningIdentity: string;
  readonly tuningOverrides: readonly ScenarioTuningOverride[];
  readonly inputs: readonly ScenarioInputFrame<TInput>[];
  readonly checkpoints: readonly ReplayCheckpoint[];
  readonly finalTick: number;
  readonly finalStateHash: string;
}

export type StateHasher<TState extends GameState> = (state: TState) => string;

export interface ReplayRecorder<TState extends GameState, TInput> {
  recordStep(tick: number, input: TInput | undefined, state: TState): void;
  finish(state: TState): ReplayRecord<TInput>;
}

export interface CreateReplayRecorderOptions<TState extends GameState> {
  readonly scenarioId: string;
  readonly initialState: TState;
  readonly tuning: TuningRegistry;
  readonly hashState?: StateHasher<TState>;
  readonly checkpointIntervalTicks?: number;
}

export class ReplayConfigurationError extends Error {
  readonly scenarioId: string;

  constructor(scenarioId: string, reason: string) {
    super(`Replay for scenario '${scenarioId}' cannot run: ${reason}`);
    this.name = 'ReplayConfigurationError';
    this.scenarioId = scenarioId;
  }
}

export class ReplayDivergenceError extends Error {
  readonly scenarioId: string;
  readonly tick: number;
  readonly expectedHash: string;
  readonly actualHash: string;

  constructor(scenarioId: string, tick: number, expectedHash: string, actualHash: string) {
    super(
      `Replay for scenario '${scenarioId}' diverged at tick ${tick}: ` +
        `expected hash ${expectedHash}, received ${actualHash}.`
    );
    this.name = 'ReplayDivergenceError';
    this.scenarioId = scenarioId;
    this.tick = tick;
    this.expectedHash = expectedHash;
    this.actualHash = actualHash;
  }
}

function stableValueString(value: unknown, ancestors: Set<object> = new Set()): string {
  if (value === null) {
    return 'null';
  }

  if (value === undefined) {
    return 'undefined';
  }

  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'string':
      return JSON.stringify(value);
    case 'number':
      if (!Number.isFinite(value)) {
        throw new TypeError('State hashing only supports finite numbers.');
      }

      return Object.is(value, -0) ? '-0' : String(value);
    case 'bigint':
      return `${value}n`;
    case 'function':
    case 'symbol':
      throw new TypeError('State hashing does not support functions or symbols.');
  }

  if (ancestors.has(value)) {
    throw new TypeError('State hashing does not support cyclic values.');
  }

  const nextAncestors = new Set(ancestors);
  nextAncestors.add(value);

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableValueString(item, nextAncestors)).join(',')}]`;
  }

  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableValueString(record[key], nextAncestors)}`)
    .join(',')}}`;
}

function fnv1a32(value: string): string {
  let hash = 0x811c9dc5;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(16).padStart(8, '0');
}

function compareKeys(left: { key: string }, right: { key: string }): number {
  if (left.key < right.key) {
    return -1;
  }

  if (left.key > right.key) {
    return 1;
  }

  return 0;
}

export function stableStateHash<TState extends GameState>(state: TState): string {
  return `fnv1a32:${fnv1a32(stableValueString(state))}`;
}

function tuningSnapshot(tuning: TuningRegistry): {
  identity: string;
  overrides: readonly ScenarioTuningOverride[];
} {
  const entries = tuning
    .list()
    .map((entry) => ({
      key: entry.key,
      domain: entry.domain,
      defaultValue: entry.defaultValue,
      min: entry.min,
      max: entry.max,
      step: entry.step
    }))
    .sort(compareKeys);
  const overrides = tuning
    .list()
    .filter((entry) => entry.overrideValue !== undefined)
    .map((entry) => ({ key: entry.key, value: entry.overrideValue as number }))
    .sort(compareKeys);

  return {
    identity: `fnv1a32:${fnv1a32(stableValueString(entries))}`,
    overrides
  };
}

function snapshotInput<TInput>(input: TInput): TInput {
  if (input === null || typeof input !== 'object') {
    return input;
  }

  return structuredClone(input);
}

export function createReplayRecorder<TState extends GameState, TInput>(
  options: CreateReplayRecorderOptions<TState>
): ReplayRecorder<TState, TInput> {
  const hashState = options.hashState ?? stableStateHash;
  const checkpointIntervalTicks = options.checkpointIntervalTicks ?? 0;

  if (!options.scenarioId.trim()) {
    throw new RangeError('A replay recorder must have a non-empty scenario ID.');
  }

  if (
    !Number.isInteger(checkpointIntervalTicks) ||
    checkpointIntervalTicks < 0
  ) {
    throw new RangeError('Replay checkpoint interval must be a non-negative integer.');
  }

  const tuning = tuningSnapshot(options.tuning);
  const initialTick = options.initialState.tick;

  if (!Number.isInteger(initialTick) || initialTick < 0) {
    throw new RangeError('A replay recorder must start from a non-negative integer tick.');
  }

  const initialStateHash = hashState(options.initialState);
  const inputs: ScenarioInputFrame<TInput>[] = [];
  const checkpoints: ReplayCheckpoint[] = [];
  let previousTick = initialTick;
  let finished = false;

  const ensureActive = (): void => {
    if (finished) {
      throw new Error('A replay recorder cannot be used after finish().');
    }
  };

  return {
    recordStep(tick, input, state): void {
      ensureActive();

      if (!Number.isInteger(tick) || tick <= previousTick || state.tick !== tick) {
        throw new RangeError('Replay steps must be recorded at strictly increasing ticks.');
      }

      if (input !== undefined) {
        inputs.push({ tick, input: snapshotInput(input) });
      }

      if (checkpointIntervalTicks > 0 && tick % checkpointIntervalTicks === 0) {
        checkpoints.push({ tick, stateHash: hashState(state) });
      }

      previousTick = tick;
    },

    finish(state): ReplayRecord<TInput> {
      ensureActive();

      if (!Number.isInteger(state.tick) || state.tick !== previousTick) {
        throw new RangeError('Replay final state must match the last recorded simulation tick.');
      }

      finished = true;

      return {
        formatVersion: REPLAY_FORMAT_VERSION,
        scenarioId: options.scenarioId,
        initialTick,
        initialStateHash,
        tuningIdentity: tuning.identity,
        tuningOverrides: tuning.overrides,
        inputs,
        checkpoints,
        finalTick: state.tick,
        finalStateHash: hashState(state)
      };
    }
  };
}

export interface ReplayScenarioOptions<TState extends GameState, TInput>
  extends Omit<ScenarioRunOptions<TState, TInput>, 'definition' | 'inputFrames' | 'tuningOverrides'> {
  readonly scenario: ScenarioDefinition<TState, TInput>;
  readonly replay: ReplayRecord<TInput>;
  readonly step: ScenarioStep<TState, TInput>;
  readonly hashState?: StateHasher<TState>;
}

export interface ReplayScenarioResult<TState extends GameState, TInput> {
  readonly run: ScenarioRun<TState, TInput>;
  readonly finalStateHash: string;
}

function compareHash<TState extends GameState>(
  scenarioId: string,
  tick: number,
  expectedHash: string,
  state: TState,
  hashState: StateHasher<TState>
): void {
  const actualHash = hashState(state);
  if (actualHash !== expectedHash) {
    throw new ReplayDivergenceError(scenarioId, tick, expectedHash, actualHash);
  }
}

export function replayScenario<TState extends GameState, TInput>(
  options: ReplayScenarioOptions<TState, TInput>
): ReplayScenarioResult<TState, TInput> {
  const { replay, scenario } = options;
  const hashState = options.hashState ?? stableStateHash;

  if (replay.formatVersion !== REPLAY_FORMAT_VERSION) {
    throw new ReplayConfigurationError(
      scenario.id,
      `unsupported format version ${replay.formatVersion}`
    );
  }

  if (replay.scenarioId !== scenario.id) {
    throw new ReplayConfigurationError(
      scenario.id,
      `the record belongs to scenario '${replay.scenarioId}'`
    );
  }

  if (!Number.isInteger(replay.finalTick) || replay.finalTick < replay.initialTick) {
    throw new ReplayConfigurationError(
      scenario.id,
      `final tick ${replay.finalTick} is not after initial tick ${replay.initialTick}`
    );
  }

  let previousCheckpointTick = replay.initialTick;
  for (const checkpoint of replay.checkpoints) {
    if (
      !Number.isInteger(checkpoint.tick) ||
      checkpoint.tick <= previousCheckpointTick ||
      checkpoint.tick > replay.finalTick
    ) {
      throw new ReplayConfigurationError(
        scenario.id,
        `checkpoint at tick ${checkpoint.tick} is not ordered between ` +
          `${replay.initialTick} and ${replay.finalTick}`
      );
    }

    previousCheckpointTick = checkpoint.tick;
  }

  const expectedCheckpoints = new Map(
    replay.checkpoints.map((checkpoint) => [checkpoint.tick, checkpoint.stateHash])
  );
  const onStep = options.onStep;
  const run = createScenarioRun({
    ...options,
    definition: scenario,
    inputFrames: replay.inputs,
    tuningOverrides: replay.tuningOverrides,
    onStep: (state, tick, input) => {
      void input;
      const expectedHash = expectedCheckpoints.get(tick);
      if (expectedHash !== undefined) {
        compareHash(scenario.id, tick, expectedHash, state, hashState);
      }
      onStep?.(state, tick, input);
    }
  });

  if (run.state.tick !== replay.initialTick) {
    throw new ReplayConfigurationError(
      scenario.id,
      `expected initial tick ${replay.initialTick}, received ${run.state.tick}`
    );
  }

  compareHash(scenario.id, replay.initialTick, replay.initialStateHash, run.state, hashState);

  if (replay.finalTick < run.state.tick) {
    throw new ReplayConfigurationError(
      scenario.id,
      `final tick ${replay.finalTick} precedes initial tick ${run.state.tick}`
    );
  }

  for (const input of replay.inputs) {
    if (input.tick > replay.finalTick) {
      throw new ReplayConfigurationError(
        scenario.id,
        `input at tick ${input.tick} is after final tick ${replay.finalTick}`
      );
    }
  }

  const actualTuning = tuningSnapshot(run.tuning);
  if (actualTuning.identity !== replay.tuningIdentity) {
    throw new ReplayConfigurationError(
      scenario.id,
      `tuning identity ${actualTuning.identity} does not match recorded ${replay.tuningIdentity}`
    );
  }

  run.runtime.pause();
  for (let tick = run.state.tick; tick < replay.finalTick; tick += 1) {
    run.runtime.stepOnce();
  }

  compareHash(scenario.id, replay.finalTick, replay.finalStateHash, run.state, hashState);

  return { run, finalStateHash: hashState(run.state) };
}
