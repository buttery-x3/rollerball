export interface NumericTuningDefinition {
  readonly key: string;
  readonly domain: string;
  readonly label: string;
  readonly defaultValue: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
}

export interface NumericTuningEntry extends NumericTuningDefinition {
  readonly overrideValue: number | undefined;
  readonly effectiveValue: number;
}

export interface TuningReader {
  getNumber(key: string): number;
}

export interface TuningRegistry extends TuningReader {
  register(definition: NumericTuningDefinition): void;
  get(key: string): NumericTuningEntry;
  list(): readonly NumericTuningEntry[];
  setOverride(key: string, value: number): void;
  resetOverride(key: string): void;
  resetAllOverrides(): void;
  subscribe(listener: () => void): () => void;
}

export const RUNTIME_MAX_CATCH_UP_STEPS_KEY = 'runtime.maxCatchUpSteps';
export const DEFAULT_RUNTIME_MAX_CATCH_UP_STEPS = 5;

export const DEFAULT_TUNING_DEFINITIONS: readonly NumericTuningDefinition[] = [
  {
    key: RUNTIME_MAX_CATCH_UP_STEPS_KEY,
    domain: 'runtime',
    label: 'Maximum catch-up steps',
    defaultValue: DEFAULT_RUNTIME_MAX_CATCH_UP_STEPS,
    min: 1,
    max: 12,
    step: 1
  }
];

function assertValidDefinition(definition: NumericTuningDefinition): void {
  if (!definition.key.trim()) {
    throw new RangeError('A tuning definition must have a non-empty key.');
  }

  if (!definition.domain.trim()) {
    throw new RangeError('A tuning definition must have a non-empty domain.');
  }

  if (!definition.label.trim()) {
    throw new RangeError('A tuning definition must have a non-empty label.');
  }

  if (
    !Number.isFinite(definition.defaultValue) ||
    !Number.isFinite(definition.min) ||
    !Number.isFinite(definition.max) ||
    !Number.isFinite(definition.step) ||
    definition.step <= 0 ||
    definition.min > definition.max ||
    definition.defaultValue < definition.min ||
    definition.defaultValue > definition.max
  ) {
    throw new RangeError(`Invalid tuning metadata for '${definition.key}'.`);
  }

  assertValidValue(definition, definition.defaultValue);
}

function assertValidValue(definition: NumericTuningDefinition, value: number): void {
  if (!Number.isFinite(value) || value < definition.min || value > definition.max) {
    throw new RangeError(
      `Tuning value for '${definition.key}' must be between ${definition.min} and ${definition.max}.`
    );
  }

  const stepIndex = (value - definition.min) / definition.step;
  const nearestStepIndex = Math.round(stepIndex);
  if (Math.abs(stepIndex - nearestStepIndex) > 1e-9) {
    throw new RangeError(`Tuning value for '${definition.key}' must use step ${definition.step}.`);
  }
}

export function createTuningRegistry(
  definitions: readonly NumericTuningDefinition[] = DEFAULT_TUNING_DEFINITIONS
): TuningRegistry {
  const registered = new Map<string, NumericTuningDefinition>();
  const overrides = new Map<string, number>();
  const listeners = new Set<() => void>();

  const notify = (): void => {
    for (const listener of listeners) {
      listener();
    }
  };

  const getDefinition = (key: string): NumericTuningDefinition => {
    const definition = registered.get(key);
    if (!definition) {
      throw new Error(`Unknown tuning key '${key}'.`);
    }

    return definition;
  };

  const getEntry = (key: string): NumericTuningEntry => {
    const definition = getDefinition(key);
    const overrideValue = overrides.get(key);

    return {
      ...definition,
      overrideValue,
      effectiveValue: overrideValue ?? definition.defaultValue
    };
  };

  for (const definition of definitions) {
    assertValidDefinition(definition);
    if (registered.has(definition.key)) {
      throw new Error(`Tuning key '${definition.key}' is already registered.`);
    }

    registered.set(definition.key, { ...definition });
  }

  return {
    register(definition: NumericTuningDefinition): void {
      assertValidDefinition(definition);
      if (registered.has(definition.key)) {
        throw new Error(`Tuning key '${definition.key}' is already registered.`);
      }

      registered.set(definition.key, { ...definition });
      notify();
    },

    get(key: string): NumericTuningEntry {
      return getEntry(key);
    },

    getNumber(key: string): number {
      return getEntry(key).effectiveValue;
    },

    list(): readonly NumericTuningEntry[] {
      return Array.from(registered.keys(), getEntry);
    },

    setOverride(key: string, value: number): void {
      const definition = getDefinition(key);
      assertValidValue(definition, value);
      if (overrides.get(key) === value) {
        return;
      }

      overrides.set(key, value);
      notify();
    },

    resetOverride(key: string): void {
      getDefinition(key);
      if (!overrides.delete(key)) {
        return;
      }

      notify();
    },

    resetAllOverrides(): void {
      if (overrides.size === 0) {
        return;
      }

      overrides.clear();
      notify();
    },

    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };
}
