import type { GameState } from './gameState';

export function stepGame(state: GameState, fixedStepSeconds: number): void {
  if (!Number.isFinite(fixedStepSeconds) || fixedStepSeconds <= 0) {
    throw new RangeError('The simulation step must be a finite positive duration.');
  }

  state.tick += 1;
}
