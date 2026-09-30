import { goalkeeperIntent } from '../ai/goalkeeperController';
import { createNeutralPlayerIntent } from '../control/intent';
import { routedInputs, type SimulationInput } from '../control/types';
import type { GameState } from '../sim/gameState';
import type { SimulationStepContext } from '../sim/diagnostics';
import { stepGame } from '../sim/stepGame';

/** Runtime assembles controllers; simulation only consumes source-neutral intents. */
export function stepControlledGame(state: GameState, seconds: number, context: SimulationStepContext, external?: SimulationInput): void {
  const inputs = [...routedInputs(external)];
  if (context.tuning && context.arena && (!state.match || state.match.phase === 'playing')) {
    for (const player of state.players) {
      if (player.definition.role !== 'goalkeeper' || inputs.some(input => input.playerId === player.definition.id) ||
          (state.ball.mode === 'possessed' && state.ball.holderId === player.definition.id)) continue;
      inputs.push(goalkeeperIntent(state, player, context.tuning, context.arena, context.diagnostics));
    }
  }
  // Ten-player execution uses the same interface before tactical AI is enabled.
  for (const player of state.players) {
    if (!inputs.some(input => input.playerId === player.definition.id)) {
      inputs.push({ playerId: player.definition.id, intent: createNeutralPlayerIntent() });
    }
  }
  stepGame(state, seconds, context, inputs);
}
