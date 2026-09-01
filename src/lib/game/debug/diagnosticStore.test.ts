import { describe, expect, it } from 'vitest';
import {
  ARENA_DIAGNOSTIC_LAYER,
  BALL_DIAGNOSTIC_LAYER,
  createDiagnosticStore,
  RUNTIME_DIAGNOSTIC_LAYER
} from './diagnosticStore';
import { createFixedStepRuntime, DEFAULT_FIXED_STEP_SECONDS } from '../runtime/fixedStepRuntime';
import { createArenaDefinition } from '../physics/arena';
import { createTuningRegistry } from '../config/tuning';
import { createGameState } from '../sim/gameState';
import { stepGame } from '../sim/stepGame';

describe('structured diagnostic store', () => {
  it('collects simulation primitives by fixed tick', () => {
    const diagnostics = createDiagnosticStore();
    diagnostics.setLayerEnabled(BALL_DIAGNOSTIC_LAYER, false);
    diagnostics.setLayerEnabled(ARENA_DIAGNOSTIC_LAYER, false);
    const tuning = createTuningRegistry();
    const runtime = createFixedStepRuntime({
      state: createGameState(),
      step: stepGame,
      diagnostics,
      tuning,
      getArena: () => createArenaDefinition(tuning)
    });

    runtime.advance(DEFAULT_FIXED_STEP_SECONDS);

    const frame = diagnostics.getFrame();

    expect(frame.tick).toBe(1);
    expect(frame.records.map((record) => record.primitive.type)).toEqual(['label']);
    expect(frame.records.every((record) => record.layer === RUNTIME_DIAGNOSTIC_LAYER)).toBe(
      true
    );
  });

  it('publishes the shared arena geometry through its own debug layer', () => {
    const diagnostics = createDiagnosticStore();
    const tuning = createTuningRegistry();
    const arena = createArenaDefinition(tuning);
    const runtime = createFixedStepRuntime({
      state: createGameState(),
      step: stepGame,
      diagnostics,
      tuning,
      getArena: () => arena
    });

    runtime.advance(DEFAULT_FIXED_STEP_SECONDS);

    const arenaRecords = diagnostics
      .getFrame()
      .records.filter((record) => record.layer === ARENA_DIAGNOSTIC_LAYER);

    expect(arenaRecords).toHaveLength(10);
    expect(arenaRecords.filter((record) => record.primitive.type === 'region')).toHaveLength(2);
    expect(arenaRecords.filter((record) => record.primitive.type === 'label')).toHaveLength(2);
  });

  it('filters disabled layers while still advancing the diagnostic frame', () => {
    const diagnostics = createDiagnosticStore();
    diagnostics.setLayerEnabled(BALL_DIAGNOSTIC_LAYER, false);
    diagnostics.setLayerEnabled(ARENA_DIAGNOSTIC_LAYER, false);
    const tuning = createTuningRegistry();
    const state = createGameState();
    const runtime = createFixedStepRuntime({
      state,
      step: stepGame,
      diagnostics,
      tuning,
      getArena: () => createArenaDefinition(tuning)
    });

    diagnostics.setLayerEnabled(RUNTIME_DIAGNOSTIC_LAYER, false);
    runtime.advance(DEFAULT_FIXED_STEP_SECONDS);

    expect(diagnostics.getFrame()).toEqual({ tick: 1, records: [] });
  });

  it('applies layer changes immediately to the current frame', () => {
    const diagnostics = createDiagnosticStore();
    diagnostics.setLayerEnabled(BALL_DIAGNOSTIC_LAYER, false);
    diagnostics.setLayerEnabled(ARENA_DIAGNOSTIC_LAYER, false);
    const tuning = createTuningRegistry();
    const runtime = createFixedStepRuntime({
      state: createGameState(),
      step: stepGame,
      diagnostics,
      tuning,
      getArena: () => createArenaDefinition(tuning)
    });

    runtime.advance(DEFAULT_FIXED_STEP_SECONDS);
    expect(diagnostics.getFrame().records).toHaveLength(1);

    diagnostics.setLayerEnabled(RUNTIME_DIAGNOSTIC_LAYER, false);
    expect(diagnostics.getFrame().records).toHaveLength(0);

    diagnostics.setLayerEnabled(RUNTIME_DIAGNOSTIC_LAYER, true);
    expect(diagnostics.getFrame().records).toHaveLength(1);
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
