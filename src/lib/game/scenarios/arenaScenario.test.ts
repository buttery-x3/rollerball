import { describe, expect, it } from 'vitest';
import { createArenaDefinition } from '../physics/arena';
import { runScenario } from './scenario';
import {
  arenaConstraintScenario,
  stepArenaConstraintScenario
} from './arenaScenario';

function runArenaConstraintScenario() {
  return runScenario({
    definition: arenaConstraintScenario,
    step: stepArenaConstraintScenario,
    getArena: (tuning) => createArenaDefinition(tuning),
    ticks: arenaConstraintScenario.automatedRunTicks
  });
}

describe('arena constraint scenario', () => {
  it('runs boundary and corner cases through the shared headless scenario harness', () => {
    const run = runArenaConstraintScenario();

    expect(run.state.radius).toBe(1);
    expect(run.state.observations).toEqual([
      { position: { x: -8, y: 0 }, contacts: ['left'] },
      { position: { x: 8, y: 14 }, contacts: ['right', 'top'] },
      { position: { x: 0, y: 0 }, contacts: [] }
    ]);
  });

  it('produces the same constrained result on repeated runs', () => {
    const first = runArenaConstraintScenario();
    const second = runArenaConstraintScenario();

    expect(second.state).toEqual(first.state);
    expect(second.tuning.getNumber('player.radius')).toBe(1);
  });
});
