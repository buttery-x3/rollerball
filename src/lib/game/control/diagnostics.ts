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
    capture: result.capture,
    routing: result.routing ?? null
  };
}

export function createControlDiagnosticRecords(
  tick: number,
  result: ControlStepResult
): readonly DiagnosticRecord[] {
  const data = controlData(result);
  const assignmentLabel = result.assignment?.playerId ?? 'unassigned';

  const records: DiagnosticRecord[] = [
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
  if (result.routing) {
    records.push({
      layer: CONTROL_DIAGNOSTIC_LAYER,
      source: 'controlRouter',
      entityId: 'control-routing',
      primitive: { type: 'label', position: result.routing.receiverClaim?.position ?? { x: 0, y: 0 },
        text: result.routing.reason, color: INPUT_COLOR },
      data: { ...result.routing, assignment: result.assignment ?? null }
    });
    for (const candidate of result.routing.receiverCandidates) {
      records.push({
        layer: CONTROL_DIAGNOSTIC_LAYER, source: 'receiverClaim', entityId: `${candidate.playerId}-receiver-candidate`,
        primitive: { type: 'circle', center: candidate.position, radius: 0.3,
          color: candidate.contested ? '#eb6f92' : candidate.playerId === result.routing.receiverClaim?.playerId ? '#f6c177' : '#9ccfd8' },
        data: { tick, ...candidate, selected: candidate.playerId === result.routing.receiverClaim?.playerId }
      });
    }
    for (const candidate of result.routing.defensiveCandidates) {
      records.push({
        layer: CONTROL_DIAGNOSTIC_LAYER, source: 'defensiveSwitch', entityId: `${candidate.playerId}-defensive-candidate`,
        primitive: { type: 'label', position: candidate.position,
          text: `${candidate.playerId} · ${candidate.score.toFixed(2)}`, color: INPUT_COLOR },
        data: { tick, ...candidate, selected: candidate.playerId === result.assignment?.playerId }
      });
    }
  }
  return records;
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
