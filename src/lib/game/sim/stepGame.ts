import type { GameState } from './gameState';
import { RUNTIME_DIAGNOSTIC_LAYER, type SimulationStepContext } from './diagnostics';

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
        type: 'line',
        start: { x: -1, y: 0 },
        end: { x: 1, y: 0 },
        color: '#7aa2f7'
      }
    });
    context.diagnostics.publish({
      layer: RUNTIME_DIAGNOSTIC_LAYER,
      source: 'stepGame',
      primitive: {
        type: 'vector',
        origin: { x: 0, y: 0 },
        direction: { x: 0.75, y: 0.45 },
        color: '#f6c177'
      }
    });
    context.diagnostics.publish({
      layer: RUNTIME_DIAGNOSTIC_LAYER,
      source: 'stepGame',
      primitive: {
        type: 'circle',
        center: { x: 0, y: 0 },
        radius: 0.75,
        color: '#eb6f92'
      }
    });
    context.diagnostics.publish({
      layer: RUNTIME_DIAGNOSTIC_LAYER,
      source: 'stepGame',
      primitive: {
        type: 'region',
        center: { x: 0, y: 0 },
        width: 2.5,
        height: 1.5,
        color: '#9ccfd8'
      }
    });
    context.diagnostics.publish({
      layer: RUNTIME_DIAGNOSTIC_LAYER,
      source: 'stepGame',
      primitive: {
        type: 'label',
        position: { x: 1.1, y: 0.9 },
        text: `Fixed tick ${state.tick}`,
        color: '#e7ecff'
      }
    });
  }
}
