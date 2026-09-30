import type { GameState } from '../sim/gameState';
import type { FixedStepFrame, FixedStepRuntime } from './fixedStepRuntime';

export interface BrowserGameLoop {
  start(): void;
  stop(): void;
}

export interface BrowserGameLoopOptions {
  readonly beforeAdvance?: () => void;
  readonly onError?: (error: unknown) => void;
}

export function createBrowserGameLoop<TState extends GameState, TInput = unknown>(
  runtime: FixedStepRuntime<TState, TInput>,
  render: (frame: FixedStepFrame<TState>) => void,
  options: BrowserGameLoopOptions = {}
): BrowserGameLoop {
  let animationFrame: number | null = null;
  let previousTimestamp: number | null = null;
  let running = false;

  const frame = (timestamp: number): void => {
    if (!running) {
      return;
    }

    const frameDeltaSeconds =
      previousTimestamp === null
        ? 0
        : Math.max(0, (timestamp - previousTimestamp) / 1000);

    previousTimestamp = timestamp;
    try {
      options.beforeAdvance?.();
      render(runtime.advance(frameDeltaSeconds));
    } catch (error) {
      runtime.pause();
      if (!options.onError) throw error;
      options.onError(error);
    }
    animationFrame = requestAnimationFrame(frame);
  };

  return {
    start(): void {
      if (running) {
        return;
      }

      running = true;
      previousTimestamp = null;
      animationFrame = requestAnimationFrame(frame);
    },

    stop(): void {
      running = false;

      if (animationFrame !== null) {
        cancelAnimationFrame(animationFrame);
      }

      animationFrame = null;
      previousTimestamp = null;
    }
  };
}
