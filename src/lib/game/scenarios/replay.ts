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

export interface ReplayTuningChange {
  /** Complete override snapshot applied before this simulation tick. */
  readonly tick: number;
  readonly overrides: readonly ScenarioTuningOverride[];
}

export interface ReplayRecord<TInput> {
  readonly formatVersion: typeof REPLAY_FORMAT_VERSION;
  readonly scenarioId: string;
  readonly initialTick: number;
  readonly initialStateHash: string;
  readonly initialState?: GameState;
  readonly tuningIdentity: string;
  readonly tuningOverrides: readonly ScenarioTuningOverride[];
  readonly tuningChanges?: readonly ReplayTuningChange[];
  readonly inputs: readonly ScenarioInputFrame<TInput>[];
  readonly checkpoints: readonly ReplayCheckpoint[];
  readonly finalTick: number;
  readonly finalStateHash: string;
}

export type StateHasher<TState extends GameState> = (state: TState) => string;

export interface ReplayRecorder<TState extends GameState, TInput> {
  recordStep(tick: number, input: TInput | undefined, state: TState): void;
  recordTuningChange(tick: number, overrides: readonly ScenarioTuningOverride[]): void;
  finish(state: TState): ReplayRecord<TInput>;
}

export interface CreateReplayRecorderOptions<TState extends GameState> {
  readonly scenarioId: string;
  readonly initialState: TState;
  readonly tuning: TuningRegistry;
  readonly hashState?: StateHasher<TState>;
  readonly checkpointIntervalTicks?: number;
  readonly includeInitialState?: boolean;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateOverrides(value: unknown, scenarioId: string): asserts value is readonly ScenarioTuningOverride[] {
  if (!Array.isArray(value)) {
    throw new ReplayConfigurationError(scenarioId, 'tuning overrides must be an array');
  }
  const keys = new Set<string>();
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.key !== 'string' || !entry.key.trim() ||
        typeof entry.value !== 'number' || !Number.isFinite(entry.value) || keys.has(entry.key)) {
      throw new ReplayConfigurationError(scenarioId, 'tuning overrides must have unique keys and finite values');
    }
    keys.add(entry.key);
  }
}

function validateReplay<TInput>(value: unknown): asserts value is ReplayRecord<TInput> {
  const scenarioId = isRecord(value) && typeof value.scenarioId === 'string' ? value.scenarioId : 'unknown';
  const fail = (reason: string): never => { throw new ReplayConfigurationError(scenarioId, reason); };
  if (!isRecord(value)) fail('the record must be an object');
  const replay = value as Record<string, unknown>;
  if (replay.formatVersion !== REPLAY_FORMAT_VERSION) fail(`unsupported format version ${replay.formatVersion}`);
  for (const key of ['scenarioId', 'initialStateHash', 'finalStateHash', 'tuningIdentity']) {
    if (typeof replay[key] !== 'string' || !replay[key].trim()) fail(`${key} must be a non-empty string`);
  }
  if (!Number.isSafeInteger(replay.initialTick) || (replay.initialTick as number) < 0 ||
      !Number.isSafeInteger(replay.finalTick) || (replay.finalTick as number) < (replay.initialTick as number)) {
    fail('initial and final ticks must be ordered non-negative integers');
  }
  const initialTick = replay.initialTick as number;
  const finalTick = replay.finalTick as number;
  validateOverrides(replay.tuningOverrides, scenarioId);
  for (const key of ['inputs', 'checkpoints', 'tuningChanges']) {
    const frames = replay[key];
    if (key === 'tuningChanges' && frames === undefined) continue;
    if (!Array.isArray(frames)) fail(`${key} must be an array`);
    let previousTick = initialTick;
    for (const frame of frames as unknown[]) {
      if (!isRecord(frame) || !Number.isSafeInteger(frame.tick) ||
          (frame.tick as number) <= previousTick || (frame.tick as number) > finalTick) {
        fail(`${key} must be strictly ordered between ticks ${initialTick} and ${finalTick}`);
      }
      const entry = frame as Record<string, unknown>;
      previousTick = entry.tick as number;
      if (key === 'inputs' && !Object.hasOwn(entry, 'input')) fail('each input frame must contain input');
      if (key === 'checkpoints' && (typeof entry.stateHash !== 'string' || !entry.stateHash.trim())) {
        fail('each checkpoint must contain a state hash');
      }
      if (key === 'tuningChanges') validateOverrides(entry.overrides, scenarioId);
    }
  }
  if (replay.initialState !== undefined && (!isRecord(replay.initialState) ||
      replay.initialState.tick !== initialTick || !Array.isArray(replay.initialState.players) ||
      !isRecord(replay.initialState.ball))) {
    fail('the initial state snapshot must match the initial tick and contain players and ball');
  }
  // Validate imported data without changing the established v1 hash representation.
  stableValueString(replay);
}

const REPLAY_JSON_ENCODING = 'rollerball-replay-lossless-v1';
const JSON_VALUE_TAG = '$rollerballReplay';

function encodeJsonValue(value: unknown, ancestors = new Set<object>()): unknown {
  if (value === undefined) return { [JSON_VALUE_TAG]: 'undefined' };
  if (typeof value === 'number' && Object.is(value, -0)) return { [JSON_VALUE_TAG]: 'negative-zero' };
  if (typeof value === 'bigint') return { [JSON_VALUE_TAG]: 'bigint', value: String(value) };
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'function' || typeof value === 'symbol' ||
        (typeof value === 'number' && !Number.isFinite(value))) {
      throw new TypeError('Replay JSON only supports finite data values.');
    }
    return value;
  }
  if (ancestors.has(value)) throw new TypeError('Replay JSON does not support cyclic values.');
  const nextAncestors = new Set(ancestors).add(value);
  if (Array.isArray(value)) {
    if (Object.keys(value).length !== value.length) throw new TypeError('Replay JSON requires dense arrays.');
    return value.map((entry) => encodeJsonValue(entry, nextAncestors));
  }
  const entries = Object.entries(value).map(([key, entry]) => [key, encodeJsonValue(entry, nextAncestors)]);
  // Escape real user data with the reserved key, so it cannot be mistaken for a tag.
  return Object.hasOwn(value, JSON_VALUE_TAG)
    ? { [JSON_VALUE_TAG]: 'object', entries }
    : Object.fromEntries(entries);
}

function decodeJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decodeJsonValue);
  if (!isRecord(value)) return value;
  if (!Object.hasOwn(value, JSON_VALUE_TAG)) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, decodeJsonValue(entry)]));
  }
  const tag = value[JSON_VALUE_TAG];
  if (tag === 'undefined' && Object.keys(value).length === 1) return undefined;
  if (tag === 'negative-zero' && Object.keys(value).length === 1) return -0;
  if (tag === 'bigint' && Object.keys(value).length === 2 &&
      typeof value.value === 'string' && /^-?\d+$/.test(value.value)) return BigInt(value.value);
  if (tag === 'object' && Object.keys(value).length === 2 && Array.isArray(value.entries)) {
    const keys = new Set<string>();
    const entries = value.entries.map((entry: unknown) => {
      if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string' || keys.has(entry[0])) {
        throw new TypeError('Malformed escaped replay object.');
      }
      keys.add(entry[0]);
      return [entry[0], decodeJsonValue(entry[1])];
    });
    return Object.fromEntries(entries);
  }
  throw new TypeError('Unknown or malformed replay JSON value tag.');
}

/** JSON transport preserves undefined properties and negative zero used by v1 state hashes. */
export function serializeReplay<TInput>(replay: ReplayRecord<TInput>): string {
  validateReplay<TInput>(replay);
  return JSON.stringify({ encoding: REPLAY_JSON_ENCODING, replay: encodeJsonValue(replay) });
}

/** Plain v1 records remain accepted; new exports use an explicit lossless transport wrapper. */
export function parseReplay<TInput = unknown>(json: string): ReplayRecord<TInput> {
  const parsed: unknown = JSON.parse(json);
  const replay = isRecord(parsed) && parsed.encoding === REPLAY_JSON_ENCODING
    ? decodeJsonValue(parsed.replay) : parsed;
  validateReplay<TInput>(replay);
  return replay;
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
  const initialState = options.includeInitialState ? structuredClone(options.initialState) : undefined;
  const inputs: ScenarioInputFrame<TInput>[] = [];
  const checkpoints: ReplayCheckpoint[] = [];
  const tuningChanges: ReplayTuningChange[] = [];
  let previousTick = initialTick;
  let finished = false;

  const ensureActive = (): void => {
    if (finished) {
      throw new Error('A replay recorder cannot be used after finish().');
    }
  };

  return {
    recordTuningChange(tick, overrides): void {
      ensureActive();
      if (!Number.isInteger(tick) || tick <= previousTick ||
          (tuningChanges.length > 0 && tick < tuningChanges[tuningChanges.length - 1].tick)) {
        throw new RangeError('Tuning changes must target an ordered future simulation tick.');
      }
      validateOverrides(overrides, options.scenarioId);
      const change = { tick, overrides: overrides.map((entry) => ({ ...entry })) };
      if (tuningChanges.at(-1)?.tick === tick) tuningChanges[tuningChanges.length - 1] = change;
      else tuningChanges.push(change);
    },

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
        ...(initialState ? { initialState } : {}),
        tuningIdentity: tuning.identity,
        tuningOverrides: tuning.overrides,
        ...(tuningChanges.length ? { tuningChanges: tuningChanges.filter((change) => change.tick <= state.tick) } : {}),
        inputs,
        checkpoints,
        finalTick: state.tick,
        finalStateHash: hashState(state)
      };
    }
  };
}

export interface ReplayScenarioOptions<TState extends GameState, TInput>
  extends Omit<
    ScenarioRunOptions<TState, TInput>,
    'definition' | 'inputFrames' | 'inputProvider' | 'tuningOverrides'
  > {
  readonly scenario: ScenarioDefinition<TState, TInput>;
  readonly replay: ReplayRecord<TInput>;
  readonly step: ScenarioStep<TState, TInput>;
  readonly hashState?: StateHasher<TState>;
}

export interface ReplayScenarioResult<TState extends GameState, TInput> {
  readonly run: ScenarioRun<TState, TInput>;
  readonly finalStateHash: string;
}

export interface PreparedReplayRun<TState extends GameState, TInput> {
  readonly run: ScenarioRun<TState, TInput>;
  readonly complete: boolean;
  verifyFinal(): string;
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

/** Prepare a paused replay for the regular frame loop, slow motion, or manual stepping. */
export function prepareReplayRun<TState extends GameState, TInput>(
  options: ReplayScenarioOptions<TState, TInput>
): PreparedReplayRun<TState, TInput> {
  const { replay, scenario } = options;
  const hashState = options.hashState ?? stableStateHash;
  validateReplay<TInput>(replay);

  if (replay.scenarioId !== scenario.id) {
    throw new ReplayConfigurationError(
      scenario.id,
      `the record belongs to scenario '${replay.scenarioId}'`
    );
  }

  const expectedCheckpoints = new Map(
    replay.checkpoints.map((checkpoint) => [checkpoint.tick, checkpoint.stateHash])
  );
  const tuningChanges = new Map((replay.tuningChanges ?? []).map((change) => [change.tick, change.overrides]));
  const onStep = options.onStep;
  let complete = false;
  let run: ScenarioRun<TState, TInput>;
  const verifyFinal = (): string => {
    if (run.state.tick !== replay.finalTick) {
      throw new ReplayConfigurationError(scenario.id, `final verification requires tick ${replay.finalTick}`);
    }
    compareHash(scenario.id, replay.finalTick, replay.finalStateHash, run.state, hashState);
    return hashState(run.state);
  };
  const snapshot = replay.initialState;
  run = createScenarioRun({
    ...options,
    definition: snapshot ? { ...scenario, createInitialState: () => structuredClone(snapshot) as TState } : scenario,
    inputFrames: replay.inputs,
    tuningOverrides: replay.tuningOverrides,
    step: (state, seconds, context, input) => {
      if (complete) throw new ReplayConfigurationError(scenario.id, 'playback has already finished');
      const overrides = tuningChanges.get(state.tick + 1);
      if (overrides) run.tuning.replaceOverrides(overrides);
      // Runtime builds the context before invoking the step. An arena tuning edit must
      // also update derived geometry on this very tick, not one tick later.
      const replayContext = overrides && run.getArena ? { ...context, arena: run.getArena() } : context;
      options.step(state, seconds, replayContext, input);
    },
    onStep: (state, tick, input) => {
      try {
        const expectedHash = expectedCheckpoints.get(tick);
        if (expectedHash !== undefined) compareHash(scenario.id, tick, expectedHash, state, hashState);
        if (tick === replay.finalTick) {
          verifyFinal();
          complete = true;
          run.runtime.pause();
        }
        onStep?.(state, tick, input);
      } catch (error) {
        run.runtime.pause();
        throw error;
      }
    }
  });

  if (run.state.tick !== replay.initialTick) {
    throw new ReplayConfigurationError(
      scenario.id,
      `expected initial tick ${replay.initialTick}, received ${run.state.tick}`
    );
  }

  compareHash(scenario.id, replay.initialTick, replay.initialStateHash, run.state, hashState);

  const actualTuning = tuningSnapshot(run.tuning);
  if (actualTuning.identity !== replay.tuningIdentity) {
    throw new ReplayConfigurationError(
      scenario.id,
      `tuning identity ${actualTuning.identity} does not match recorded ${replay.tuningIdentity}`
    );
  }

  run.runtime.pause();
  if (run.state.tick === replay.finalTick) {
    verifyFinal();
    complete = true;
  }
  return { run, get complete(): boolean { return complete; }, verifyFinal };
}

export function replayScenario<TState extends GameState, TInput>(
  options: ReplayScenarioOptions<TState, TInput>
): ReplayScenarioResult<TState, TInput> {
  const playback = prepareReplayRun(options);
  while (!playback.complete) playback.run.runtime.stepOnce();
  return { run: playback.run, finalStateHash: playback.verifyFinal() };
}
