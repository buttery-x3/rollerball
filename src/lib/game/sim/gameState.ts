export interface GameState {
  tick: number;
}

export function createGameState(): GameState {
  return { tick: 0 };
}
