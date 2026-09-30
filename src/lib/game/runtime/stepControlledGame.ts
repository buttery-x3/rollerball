import { goalkeeperIntent } from '../ai/goalkeeperController';
import { planTeams } from '../ai/teamPlanner';
import { fieldPlayerIntent } from '../ai/fieldController';
import { planActions, actionPlayerIntent } from '../ai/actionPlanner';
import { createNeutralPlayerIntent } from '../control/intent';
import { matchAction, routedInputs, type SimulationInput } from '../control/types';
import type { GameState } from '../sim/gameState';
import type { SimulationStepContext } from '../sim/diagnostics';
import { stepGame } from '../sim/stepGame';
import { applyTacticalPlan } from '../sim/tactics';
import { applyAiActionPlan } from '../sim/actionState';

/** Runtime assembles controllers; simulation only consumes source-neutral intents. */
export function stepControlledGame(state: GameState, seconds: number, context: SimulationStepContext, external?: SimulationInput): void {
  const inputs = [...routedInputs(external)];
  const controlledPlayerIds = inputs.map(input => input.playerId);
  const playing = !state.match || state.match.phase === 'playing';
  if (playing && state.tactics && context.tuning && context.arena) {
    const plan = planTeams(state, context.tuning, context.arena, context.diagnostics);
    if (plan) applyTacticalPlan(state, plan);
  }
  if (context.tuning && context.arena && playing) {
    if (state.aiActions) {
      const plan = planActions(state, context.tuning, context.arena, controlledPlayerIds, context.diagnostics);
      if (plan) applyAiActionPlan(state, plan);
    }
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
  if (state.aiActions && context.tuning && context.arena && playing) {
    for (let index = 0; index < inputs.length; index++) {
      const input = inputs[index];
      if (controlledPlayerIds.includes(input.playerId)) continue;
      inputs[index] = { playerId: input.playerId, intent: actionPlayerIntent(state, input.playerId,
        input.intent, context.tuning, context.arena, context.diagnostics) };
    }
  }
  stepGame(state, seconds, context, { playerIntents: inputs, matchAction: matchAction(external) });
}
