import { goalkeeperIntent } from '../ai/goalkeeperController';
import { planTeams } from '../ai/teamPlanner';
import { fieldPlayerIntent } from '../ai/fieldController';
import { createNeutralPlayerIntent } from '../control/intent';
import { routedInputs, type SimulationInput } from '../control/types';
import type { GameState } from '../sim/gameState';
import type { SimulationStepContext } from '../sim/diagnostics';
import { stepGame } from '../sim/stepGame';
import { applyTacticalPlan } from '../sim/tactics';

/** Runtime assembles controllers; simulation only consumes source-neutral intents. */
export function stepControlledGame(state: GameState, seconds: number, context: SimulationStepContext, external?: SimulationInput): void {
  const inputs = [...routedInputs(external)];
  if (state.tactics && context.tuning && context.arena) {
    const plan = planTeams(state, context.tuning, context.arena, context.diagnostics);
    if (plan) applyTacticalPlan(state, plan);
  }
  if (context.tuning && context.arena && (!state.match || state.match.phase === 'playing')) {
    for (const team of state.tactics?.teams ?? []) {
      for (const assignment of team.assignments) {
        if (!inputs.some(input => input.playerId === assignment.playerId)) {
          inputs.push(fieldPlayerIntent(state, assignment, context.tuning, context.arena, context.diagnostics));
        }
      }
    }
    for (const player of state.players) {
      if (player.definition.role !== 'goalkeeper' || inputs.some(input => input.playerId === player.definition.id) ||
          (state.ball.mode === 'possessed' && state.ball.holderId === player.definition.id)) continue;
      inputs.push(goalkeeperIntent(state, player, context.tuning, context.arena, context.diagnostics));
    }
  }
  // Isolated subsystem scenes may deliberately omit tactical planning.
  for (const player of state.players) {
    if (!inputs.some(input => input.playerId === player.definition.id)) {
      inputs.push({ playerId: player.definition.id, intent: createNeutralPlayerIntent() });
    }
  }
  stepGame(state, seconds, context, inputs);
}
