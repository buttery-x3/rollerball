import type { GameState } from '../sim/gameState';

export const DEFAULT_FIXED_STEP_SECONDS = 1 / 60;
export const DEFAULT_MAX_CATCH_UP_STEPS = 5;

export interface FixedStepFrame<TState extends GameState> {
  readonly state: TState;
  readonly alpha: number;
  readonly simulationSteps: number;
}

export interface FixedStepRuntime<TState extends GameState> {
  advance(frameDeltaSeconds: number): FixedStepFrame<TState>;
}

export interface FixedStepRuntimeOptions<TState extends GameState> {
  state: TState;
  step: (state: TState, fixedStepSeconds: number) => void;
  fixedStepSeconds?: number;
  maxCatchUpSteps?: number;
}

export function createFixedStepRuntime<TState extends GameState>(
  options: FixedStepRuntimeOptions<TState>
): FixedStepRuntime<TState> {
  const fixedStepSeconds = options.fixedStepSeconds ?? DEFAULT_FIXED_STEP_SECONDS;
  const maxCatchUpSteps = options.maxCatchUpSteps ?? DEFAULT_MAX_CATCH_UP_STEPS;

  if (!Number.isFinite(fixedStepSeconds) || fixedStepSeconds <= 0) {
    throw new RangeError('The fixed simulation step must be a finite positive duration.');
  }

  if (!Number.isInteger(maxCatchUpSteps) || maxCatchUpSteps <= 0) {
    throw new RangeError('The maximum catch-up step count must be a positive integer.');
  }

  let accumulator = 0;
  const stepEpsilon = fixedStepSeconds * 1e-9;
  const maxCatchUpSeconds = fixedStepSeconds * maxCatchUpSteps;

  return {
    advance(frameDeltaSeconds: number): FixedStepFrame<TState> {
      if (!Number.isFinite(frameDeltaSeconds) || frameDeltaSeconds < 0) {
        throw new RangeError('The render-frame delta must be a finite non-negative duration.');
      }

      accumulator = Math.min(accumulator + frameDeltaSeconds, maxCatchUpSeconds);

      let simulationSteps = 0;
      while (
        accumulator + stepEpsilon >= fixedStepSeconds &&
        simulationSteps < maxCatchUpSteps
      ) {
        options.step(options.state, fixedStepSeconds);
        accumulator = Math.max(0, accumulator - fixedStepSeconds);
        simulationSteps += 1;
      }

      return {
        state: options.state,
        alpha: Math.min(1, Math.max(0, accumulator / fixedStepSeconds)),
        simulationSteps
      };
    }
  };
}
