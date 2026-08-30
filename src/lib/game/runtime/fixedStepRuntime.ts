import {
  DEFAULT_RUNTIME_MAX_CATCH_UP_STEPS,
  RUNTIME_MAX_CATCH_UP_STEPS_KEY,
  type TuningReader
} from '../config/tuning';
import type { GameState } from '../sim/gameState';
import type { DiagnosticSink } from '../sim/diagnostics';
import type { ArenaDefinition } from '../physics/arena';

export const DEFAULT_FIXED_STEP_SECONDS = 1 / 60;
export { DEFAULT_RUNTIME_MAX_CATCH_UP_STEPS as DEFAULT_MAX_CATCH_UP_STEPS } from '../config/tuning';

export interface FixedStepFrame<TState extends GameState> {
  readonly state: TState;
  readonly alpha: number;
  readonly simulationSteps: number;
}

export interface FixedStepRuntime<TState extends GameState> {
  readonly isPaused: boolean;
  advance(frameDeltaSeconds: number): FixedStepFrame<TState>;
  pause(): void;
  resume(): void;
  stepOnce(): FixedStepFrame<TState>;
}

export interface FixedStepRuntimeOptions<TState extends GameState> {
  state: TState;
  step: (state: TState, fixedStepSeconds: number, context: FixedStepStepContext) => void;
  fixedStepSeconds?: number;
  maxCatchUpSteps?: number;
  tuning?: TuningReader;
  diagnostics?: DiagnosticSink;
  getArena?: () => ArenaDefinition;
}

export interface FixedStepStepContext {
  readonly diagnostics?: DiagnosticSink;
  readonly tuning?: TuningReader;
  readonly arena?: ArenaDefinition;
}

export function createFixedStepRuntime<TState extends GameState>(
  options: FixedStepRuntimeOptions<TState>
): FixedStepRuntime<TState> {
  const fixedStepSeconds = options.fixedStepSeconds ?? DEFAULT_FIXED_STEP_SECONDS;

  if (!Number.isFinite(fixedStepSeconds) || fixedStepSeconds <= 0) {
    throw new RangeError('The fixed simulation step must be a finite positive duration.');
  }

  let accumulator = 0;
  let paused = false;

  const resolveMaxCatchUpSteps = (): number => {
    const maxCatchUpSteps =
      options.maxCatchUpSteps ??
      options.tuning?.getNumber(RUNTIME_MAX_CATCH_UP_STEPS_KEY) ??
      DEFAULT_RUNTIME_MAX_CATCH_UP_STEPS;

    if (!Number.isInteger(maxCatchUpSteps) || maxCatchUpSteps <= 0) {
      throw new RangeError('The maximum catch-up step count must be a positive integer.');
    }

    return maxCatchUpSteps;
  };

  if (options.maxCatchUpSteps !== undefined) {
    resolveMaxCatchUpSteps();
  }

  const runStep = (): void => {
    options.diagnostics?.beginTick(options.state.tick + 1);
    try {
      options.step(options.state, fixedStepSeconds, {
        diagnostics: options.diagnostics,
        tuning: options.tuning,
        arena: options.getArena?.()
      });
    } finally {
      options.diagnostics?.endTick();
    }
  };

  const createFrame = (simulationSteps: number): FixedStepFrame<TState> => ({
    state: options.state,
    alpha: Math.min(1, Math.max(0, accumulator / fixedStepSeconds)),
    simulationSteps
  });

  return {
    get isPaused(): boolean {
      return paused;
    },

    advance(frameDeltaSeconds: number): FixedStepFrame<TState> {
      if (!Number.isFinite(frameDeltaSeconds) || frameDeltaSeconds < 0) {
        throw new RangeError('The render-frame delta must be a finite non-negative duration.');
      }

      if (paused) {
        return createFrame(0);
      }

      const maxCatchUpSteps = resolveMaxCatchUpSteps();
      const stepEpsilon = fixedStepSeconds * 1e-9;
      const maxCatchUpSeconds = fixedStepSeconds * maxCatchUpSteps;

      accumulator = Math.min(accumulator + frameDeltaSeconds, maxCatchUpSeconds);

      let simulationSteps = 0;
      while (
        accumulator + stepEpsilon >= fixedStepSeconds &&
        simulationSteps < maxCatchUpSteps
      ) {
        runStep();
        accumulator = Math.max(0, accumulator - fixedStepSeconds);
        simulationSteps += 1;
      }

      return createFrame(simulationSteps);
    },

    pause(): void {
      paused = true;
    },

    resume(): void {
      paused = false;
    },

    stepOnce(): FixedStepFrame<TState> {
      if (!paused) {
        throw new Error('The fixed-step runtime must be paused before stepping manually.');
      }

      runStep();
      return createFrame(1);
    }
  };
}
