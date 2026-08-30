import type { GameState } from './gameState';
import {
  ARENA_DIAGNOSTIC_LAYER,
  RUNTIME_DIAGNOSTIC_LAYER,
  type SimulationStepContext
} from './diagnostics';
import { createArenaDiagnosticRecords } from './arenaDiagnostics';

export function stepGame(
  state: GameState,
  fixedStepSeconds: number,
  context: SimulationStepContext = {}
): void {
  if (!Number.isFinite(fixedStepSeconds) || fixedStepSeconds <= 0) {
    throw new RangeError('The simulation step must be a finite positive duration.');
  }

  state.tick += 1;

  if (context.diagnostics?.isLayerEnabled(RUNTIME_DIAGNOSTIC_LAYER)) {
    context.diagnostics.publish({
      layer: RUNTIME_DIAGNOSTIC_LAYER,
      source: 'stepGame',
      primitive: {
        type: 'label',
        position: { x: 0, y: 0 },
        text: `Fixed tick ${state.tick}`,
        color: '#e7ecff'
      }
    });
  }

  if (context.arena && context.diagnostics?.isLayerEnabled(ARENA_DIAGNOSTIC_LAYER)) {
    for (const record of createArenaDiagnosticRecords(context.arena)) {
      context.diagnostics.publish(record);
    }
  }
}
