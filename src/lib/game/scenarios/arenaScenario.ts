import { PLAYER_RADIUS_KEY } from '../config/tuning';
import {
  constrainCircleToBounds,
  type CircleBoundaryContact,
  type Vec2
} from '../physics/geometry';
import type { GameState } from '../sim/gameState';
import type { ScenarioDefinition, ScenarioStep } from './scenario';

export interface ArenaConstraintObservation {
  readonly position: Vec2;
  readonly contacts: readonly CircleBoundaryContact[];
}

export interface ArenaConstraintScenarioState extends GameState {
  position: Vec2;
  radius: number;
  contacts: readonly CircleBoundaryContact[];
  observations: ArenaConstraintObservation[];
}

export const ARENA_CONSTRAINT_SCENARIO_ID = 'arena-circle-constraint';

export const arenaConstraintScenario: ScenarioDefinition<
  ArenaConstraintScenarioState,
  Vec2
> = {
  id: ARENA_CONSTRAINT_SCENARIO_ID,
  name: 'Arena circle constraint',
  createInitialState: () => ({
    tick: 0,
    players: [],
    position: { x: 0, y: 0 },
    radius: 0.75,
    contacts: [],
    observations: []
  }),
  scriptedInputs: [
    { tick: 1, input: { x: -20, y: 0 } },
    { tick: 2, input: { x: 20, y: 20 } },
    { tick: 3, input: { x: 0, y: 0 } }
  ],
  tuningOverrides: [{ key: PLAYER_RADIUS_KEY, value: 1 }],
  assertions: [
    {
      id: 'position-remains-finite',
      check: (state) => Number.isFinite(state.position.x) && Number.isFinite(state.position.y)
    }
  ]
};

export const stepArenaConstraintScenario: ScenarioStep<
  ArenaConstraintScenarioState,
  Vec2
> = (state, _fixedStepSeconds, context, input) => {
  if (!context.arena) {
    throw new Error('The arena circle constraint scenario requires an arena definition.');
  }

  const target = input ?? state.position;
  const radius = context.tuning?.getNumber(PLAYER_RADIUS_KEY) ?? state.radius;
  const result = constrainCircleToBounds(target, radius, context.arena.bounds);

  state.tick += 1;
  state.radius = radius;
  state.position = result.position;
  state.contacts = result.contacts;
  state.observations.push({
    position: result.position,
    contacts: result.contacts
  });
};
