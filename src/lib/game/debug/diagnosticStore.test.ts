import { describe, expect, it } from 'vitest';
import { createDiagnosticStore, RUNTIME_DIAGNOSTIC_LAYER } from './diagnosticStore';
import { createFixedStepRuntime, DEFAULT_FIXED_STEP_SECONDS } from '../runtime/fixedStepRuntime';
import { createGameState } from '../sim/gameState';
import { stepGame } from '../sim/stepGame';

describe('structured diagnostic store', () => {
  it('collects simulation primitives by fixed tick', () => {
    const diagnostics = createDiagnosticStore();
    const runtime = createFixedStepRuntime({
      state: createGameState(),
      step: stepGame,
      diagnostics
    });

    runtime.advance(DEFAULT_FIXED_STEP_SECONDS);

    const frame = diagnostics.getFrame();

    expect(frame.tick).toBe(1);
    expect(frame.records.map((record) => record.primitive.type)).toEqual([
      'line',
      'vector',
      'circle',
      'region',
      'label'
    ]);
    expect(frame.records.every((record) => record.layer === RUNTIME_DIAGNOSTIC_LAYER)).toBe(
      true
    );
  });

  it('filters disabled layers while still advancing the diagnostic frame', () => {
    const diagnostics = createDiagnosticStore();
    const state = createGameState();
    const runtime = createFixedStepRuntime({
      state,
      step: stepGame,
      diagnostics
    });

    diagnostics.setLayerEnabled(RUNTIME_DIAGNOSTIC_LAYER, false);
    runtime.advance(DEFAULT_FIXED_STEP_SECONDS);

    expect(diagnostics.getFrame()).toEqual({ tick: 1, records: [] });
  });

  it('applies layer changes immediately to the current frame', () => {
    const diagnostics = createDiagnosticStore();
    const runtime = createFixedStepRuntime({
      state: createGameState(),
      step: stepGame,
      diagnostics
    });

    runtime.advance(DEFAULT_FIXED_STEP_SECONDS);
    expect(diagnostics.getFrame().records).toHaveLength(5);

    diagnostics.setLayerEnabled(RUNTIME_DIAGNOSTIC_LAYER, false);
    expect(diagnostics.getFrame().records).toHaveLength(0);

    diagnostics.setLayerEnabled(RUNTIME_DIAGNOSTIC_LAYER, true);
    expect(diagnostics.getFrame().records).toHaveLength(5);
  });

  it('notifies workbench subscribers for frames and layer changes', () => {
    const diagnostics = createDiagnosticStore();
    let notifications = 0;
    const unsubscribe = diagnostics.subscribe(() => {
      notifications += 1;
    });

    diagnostics.setLayerEnabled(RUNTIME_DIAGNOSTIC_LAYER, false);
    diagnostics.beginTick(1);
    diagnostics.endTick();
    unsubscribe();

    expect(notifications).toBe(2);
  });
});
