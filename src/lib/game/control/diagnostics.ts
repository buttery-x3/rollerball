import {
  CONTROL_DIAGNOSTIC_LAYER,
  type DiagnosticRecord,
  type DiagnosticSink
} from '../sim/diagnostics';
import type { ControlStepResult } from './types';

const INPUT_COLOR = '#9ccfd8';
const RIGHT_STICK_COLOR = '#f6c177';

function controlData(result: ControlStepResult): Readonly<Record<string, unknown>> {
  return {
    input: result.input,
    assignment: result.assignment ?? null,
    routedIntent: result.routedIntent ?? null,
    capture: result.capture
  };
}

export function createControlDiagnosticRecords(
  tick: number,
  result: ControlStepResult
): readonly DiagnosticRecord[] {
  const data = controlData(result);
  const assignmentLabel = result.assignment?.playerId ?? 'unassigned';

  return [
    {
      layer: CONTROL_DIAGNOSTIC_LAYER,
      source: 'controlRouter',
      entityId: 'control-state',
      primitive: {
        type: 'label',
        position: { x: 0, y: 0 },
        text: `Control · ${assignmentLabel} · tick ${tick}`,
        color: INPUT_COLOR
      },
      data
    },
    {
      layer: CONTROL_DIAGNOSTIC_LAYER,
      source: 'controlRouter',
      entityId: 'control-movement',
      primitive: {
        type: 'vector',
        origin: { x: 0, y: 0 },
        direction: result.input.movement,
        color: INPUT_COLOR
      },
      data: {
        tick,
        vector: result.input.movement,
        intent: result.routedIntent?.intent ?? null
      }
    },
    {
      layer: CONTROL_DIAGNOSTIC_LAYER,
      source: 'controlRouter',
      entityId: 'control-right-stick',
      primitive: {
        type: 'vector',
        origin: { x: 0, y: 0 },
        direction: result.input.rightStick,
        color: RIGHT_STICK_COLOR
      },
      data: {
        tick,
        vector: result.input.rightStick,
        capture: result.capture,
        pulse: result.routedIntent?.intent.rightStickThrow ?? null
      }
    }
  ];
}

export function publishControlDiagnostics(
  tick: number,
  result: ControlStepResult,
  diagnostics: DiagnosticSink | undefined
): void {
  if (!diagnostics?.isLayerEnabled(CONTROL_DIAGNOSTIC_LAYER)) {
    return;
  }

  for (const record of createControlDiagnosticRecords(tick, result)) {
    diagnostics.publish(record);
  }
}
