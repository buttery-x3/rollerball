import { describe, expect, it } from 'vitest';
import { DEFAULT_PLAYER_RADIUS } from '../config/tuning';
import { createArenaDefinition } from '../physics/arena';
import type { PlayerContact } from '../physics/playerContact';
import { isCircleWithinBounds } from '../physics/geometry';
import { PLAYER_CONTACT_DIAGNOSTIC_LAYER } from '../sim/diagnostics';
import type { GameState } from '../sim/gameState';
import { stepGame } from '../sim/stepGame';
import { DEFAULT_SCENARIOS } from './defaultScenarios';
import { PLAYER_CONTACT_SCENARIOS, playerCrowdedContactScenario } from './playerContactScenario';
import { createScenarioRun, runScenario } from './scenario';
import { stableStateHash } from './replay';

function kineticEnergy(state: GameState): number {
  return state.players.reduce((sum, player) => sum +
    player.velocity.x ** 2 + player.velocity.y ** 2, 0);
}

describe('incidental player contact scenarios', () => {
  for (const definition of PLAYER_CONTACT_SCENARIOS) {
    it(`${definition.id} separates without adding energy and exposes reusable contact data`, () => {
      expect(DEFAULT_SCENARIOS).toContain(definition);
      const run = createScenarioRun({ definition, step: stepGame, getArena: createArenaDefinition });
      run.runtime.pause();
      let energy = kineticEnergy(run.state);
      let sawContact = false;
      for (let tick = 0; tick < definition.automatedRunTicks; tick += 1) {
        run.runtime.stepOnce();
        const nextEnergy = kineticEnergy(run.state);
        expect(nextEnergy).toBeLessThanOrEqual(energy + 1e-7);
        energy = nextEnergy;
        for (let index = 0; index < run.state.players.length; index += 1) {
          const player = run.state.players[index];
          expect(isCircleWithinBounds(player.position, DEFAULT_PLAYER_RADIUS, run.getArena!().bounds)).toBe(true);
          for (const other of run.state.players.slice(index + 1)) {
            expect(Math.hypot(player.position.x - other.position.x, player.position.y - other.position.y))
              .toBeGreaterThanOrEqual(DEFAULT_PLAYER_RADIUS * 2 - 1e-6);
          }
        }
        const records = run.diagnostics!.getFrame().records;
        expect(records.filter((record) => record.layer === PLAYER_CONTACT_DIAGNOSTIC_LAYER && record.primitive.type === 'circle'))
          .toHaveLength(run.state.players.length);
        const contactRecord = records.find((record) => record.entityId === 'contact-state');
        for (const contact of contactRecord!.data!.contacts as readonly PlayerContact[]) {
          sawContact = true;
          expect(Math.hypot(contact.normal.x, contact.normal.y)).toBeCloseTo(1, 8);
          expect(contact.closingSpeed).toBeGreaterThanOrEqual(0);
          expect(contact.separation).toBeGreaterThanOrEqual(0);
          expect(contact.velocityResponse).toBeGreaterThanOrEqual(0);
          expect(contact.relativeVelocity.x).toBeCloseTo(contact.secondVelocity.x - contact.firstVelocity.x, 8);
        }
      }
      expect(sawContact).toBe(true);
      const disabled = runScenario({
        definition, step: stepGame, getArena: createArenaDefinition,
        diagnosticsEnabled: false, ticks: definition.automatedRunTicks
      });
      expect(stableStateHash(disabled.state)).toBe(stableStateHash(run.state));
    });
  }

  it('produces the same crowded-contact state under different render frame schedules', () => {
    const run = (frameSeconds: number) => {
      const result = createScenarioRun({
        definition: playerCrowdedContactScenario, step: stepGame,
        getArena: createArenaDefinition, diagnosticsEnabled: false
      });
      for (let frame = 0; frame < Math.round(2 / frameSeconds); frame += 1) {
        result.runtime.advance(frameSeconds);
      }
      return result.state;
    };
    expect(stableStateHash(run(1 / 30))).toBe(stableStateHash(run(1 / 120)));
  });
});
