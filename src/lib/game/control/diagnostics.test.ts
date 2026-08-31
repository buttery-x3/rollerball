import { describe, expect, it } from 'vitest';
import { createTuningRegistry } from '../config/tuning';
import {
  createFixedStepRuntime,
  DEFAULT_FIXED_STEP_SECONDS
} from '../runtime/fixedStepRuntime';
import { createDiagnosticStore } from '../debug/diagnosticStore';
import {
  CONTROL_DIAGNOSTIC_LAYER,
  type DiagnosticRecord
} from '../sim/diagnostics';
import { createGameState } from '../sim/gameState';
import { createControlRouter } from './controlRouter';
import { publishControlDiagnostics } from './diagnostics';
import { stepGame } from '../sim/stepGame';
import type { InputSnapshot } from './types';

function inputSnapshot(): InputSnapshot {
  return {
    movement: { x: 0.5, y: 0 },
    rightStick: { x: 0, y: 0 },
    buttons: { low: true, high: false, switch: false }
  };
}

describe('control diagnostics', () => {
  it('publishes the normalized input, intent, assignment, and capture state', () => {
    const diagnostics = createDiagnosticStore();
    const router = createControlRouter({
      tuning: createTuningRegistry(),
      initialPlayerId: 'player-a'
    });
    const state = createGameState();
    const runtime = createFixedStepRuntime({
      state,
      diagnostics,
      getInput: (tick, context) => {
        const result = router.consumeTick(inputSnapshot(), 'possessed');
        publishControlDiagnostics(tick, result, context.diagnostics);
        return result.routedIntent;
      },
      step: (stepState, fixedStepSeconds, context) => {
        stepGame(stepState, fixedStepSeconds, context);
      }
    });

    runtime.advance(DEFAULT_FIXED_STEP_SECONDS);

    const records = diagnostics
      .getFrame()
      .records.filter((record) => record.layer === CONTROL_DIAGNOSTIC_LAYER);
    const stateRecord = records.find((record) => record.entityId === 'control-state') as
      | DiagnosticRecord
      | undefined;

    expect(records).toHaveLength(3);
    expect(stateRecord?.data).toMatchObject({
      assignment: { playerId: 'player-a', reason: 'initial' },
      input: {
        buttons: {
          low: { held: true, pressed: true, released: false }
        }
      },
      routedIntent: {
        playerId: 'player-a',
        intent: {
          actionContext: 'possessed',
          movement: { x: 0.5, y: 0 }
        }
      },
      capture: { phase: 'neutral' }
    });
  });

  it('suppresses control records when the control layer is disabled', () => {
    const diagnostics = createDiagnosticStore();
    diagnostics.setLayerEnabled(CONTROL_DIAGNOSTIC_LAYER, false);
    const router = createControlRouter({ tuning: createTuningRegistry() });
    const runtime = createFixedStepRuntime({
      state: createGameState(),
      diagnostics,
      getInput: (tick, context) => {
        const result = router.consumeTick(inputSnapshot());
        publishControlDiagnostics(tick, result, context.diagnostics);
        return result.routedIntent;
      },
      step: stepGame
    });

    runtime.advance(DEFAULT_FIXED_STEP_SECONDS);

    expect(
      diagnostics.getFrame().records.some((record) => record.layer === CONTROL_DIAGNOSTIC_LAYER)
    ).toBe(false);
  });
});
