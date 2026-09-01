import { describe, expect, it } from 'vitest';
import {
  BALL_PREDICTION_HORIZON_STEPS_KEY,
  createTuningRegistry
} from '../config/tuning';
import { createArenaDefinition } from './arena';
import {
  advanceLooseBall,
  predictLooseBallTrajectory,
  type LooseBallMotion
} from './ballTrajectory';

const FIXED_STEP_SECONDS = 1 / 60;

function createMotion(overrides: Partial<LooseBallMotion> = {}): LooseBallMotion {
  return {
    position: overrides.position ?? { x: 0, y: 0 },
    velocity: overrides.velocity ?? { x: 0, y: 0 },
    height: overrides.height ?? 0,
    verticalVelocity: overrides.verticalVelocity ?? 0
  };
}

function createPhysics() {
  const tuning = createTuningRegistry();
  return { tuning, arena: createArenaDefinition(tuning) };
}

describe('loose-ball trajectory integration', () => {
  it('rebounds from a low side-wall contact with deterministic restitution', () => {
    const { tuning, arena } = createPhysics();
    const result = advanceLooseBall(
      createMotion({
        position: { x: 8.2, y: 0 },
        velocity: { x: 40, y: 2 }
      }),
      FIXED_STEP_SECONDS,
      tuning,
      arena
    );

    expect(result.contacts).toHaveLength(1);
    expect(result.contacts[0].boundary).toBe('right');
    expect(result.contacts[0].normal).toEqual({ x: -1, y: 0 });
    expect(result.nextState.velocity.x).toBeLessThan(0);
    expect(result.nextState.position.x).toBeLessThanOrEqual(arena.bounds.maxX - 0.35 + 1e-7);
  });

  it('sweeps a maximum-speed ball before it can pass through a solid wall', () => {
    const { tuning, arena } = createPhysics();
    const result = advanceLooseBall(
      createMotion({
        position: { x: 8, y: 0 },
        velocity: { x: 240, y: 0 }
      }),
      FIXED_STEP_SECONDS,
      tuning,
      arena
    );

    expect(result.contacts.some((contact) => contact.boundary === 'right')).toBe(true);
    expect(result.nextState.position.x).toBeLessThanOrEqual(arena.bounds.maxX - 0.35 + 1e-7);
    expect(result.nextState.velocity.x).toBeLessThan(0);
  });

  it('rebounds a low ball that is outside the post width', () => {
    const { tuning, arena } = createPhysics();
    const result = advanceLooseBall(
      createMotion({
        position: { x: 4.2, y: 14 },
        velocity: { x: 0, y: 60 }
      }),
      FIXED_STEP_SECONDS,
      tuning,
      arena
    );

    expect(result.goalAperture).toMatchObject({
      horizontalFit: false,
      verticalFit: true,
      crossed: false
    });
    expect(result.contacts.map((contact) => contact.boundary)).toEqual(['top']);
    expect(result.nextState.velocity.y).toBeLessThan(0);
  });

  it('crosses a centred low goal aperture without producing an end-wall contact', () => {
    const { tuning, arena } = createPhysics();
    const result = advanceLooseBall(
      createMotion({
        position: { x: 0, y: 14 },
        velocity: { x: 0, y: 60 }
      }),
      FIXED_STEP_SECONDS,
      tuning,
      arena
    );

    expect(result.goalAperture).toMatchObject({
      end: 'positiveY',
      horizontalFit: true,
      verticalFit: true,
      crossed: true
    });
    expect(result.contacts).toEqual([]);
    expect(result.nextState.position.y).toBeGreaterThan(arena.bounds.maxY - 0.35);
  });

  it('rebounded at a diagonal near-post miss when the full ball does not fit', () => {
    const { tuning, arena } = createPhysics();
    const result = advanceLooseBall(
      createMotion({
        position: { x: 3.4, y: 14 },
        velocity: { x: 30, y: 60 }
      }),
      FIXED_STEP_SECONDS,
      tuning,
      arena
    );

    expect(result.goalAperture).toMatchObject({
      horizontalFit: false,
      verticalFit: true,
      crossed: false
    });
    expect(result.contacts.map((contact) => contact.boundary)).toEqual(['top']);
    expect(result.nextState.velocity.y).toBeLessThan(0);
  });

  it('rebounded above the crossbar even when centred inside the posts', () => {
    const { tuning, arena } = createPhysics();
    const result = advanceLooseBall(
      createMotion({
        position: { x: 0, y: 14 },
        velocity: { x: 0, y: 60 },
        height: 2.5
      }),
      FIXED_STEP_SECONDS,
      tuning,
      arena
    );

    expect(result.goalAperture).toMatchObject({
      horizontalFit: true,
      verticalFit: false,
      crossed: false
    });
    expect(result.contacts.map((contact) => contact.boundary)).toEqual(['top']);
    expect(result.nextState.velocity.y).toBeLessThan(0);
  });

  it('evaluates a rising near-crossbar miss at the swept contact height', () => {
    const { tuning, arena } = createPhysics();
    const result = advanceLooseBall(
      createMotion({
        position: { x: 0, y: 14 },
        velocity: { x: 0, y: 60 },
        height: 2.2,
        verticalVelocity: 20
      }),
      FIXED_STEP_SECONDS,
      tuning,
      arena
    );

    expect(result.goalAperture?.height).toBeGreaterThan(2.25);
    expect(result.goalAperture).toMatchObject({
      horizontalFit: true,
      verticalFit: false,
      crossed: false
    });
    expect(result.contacts.map((contact) => contact.boundary)).toEqual(['top']);
  });

  it('allows a valid slow shot to reach the aperture without a false rebound', () => {
    const { tuning, arena } = createPhysics();
    let motion = createMotion({
      position: { x: 0, y: 14 },
      velocity: { x: 0, y: 20 }
    });

    const first = advanceLooseBall(motion, FIXED_STEP_SECONDS, tuning, arena);
    motion = first.nextState;
    const second = advanceLooseBall(motion, FIXED_STEP_SECONDS, tuning, arena);

    expect(first.goalAperture).toBeUndefined();
    expect(second.goalAperture?.crossed).toBe(true);
    expect(second.contacts).toEqual([]);
    expect(second.nextState.velocity.y).toBeGreaterThan(0);
  });

  it('lands, bounces, and eventually settles a lob on the ground', () => {
    const { tuning, arena } = createPhysics();
    let motion = createMotion({
      position: { x: -3, y: 0 },
      velocity: { x: 2, y: 6 },
      verticalVelocity: 18
    });
    let maximumHeight = motion.height;
    let landing: number | undefined;

    for (let tick = 0; tick < 150; tick += 1) {
      const result = advanceLooseBall(motion, FIXED_STEP_SECONDS, tuning, arena);
      motion = result.nextState;
      maximumHeight = Math.max(maximumHeight, motion.height);
      landing ??= result.landing?.timeSeconds;
    }

    expect(maximumHeight).toBeGreaterThan(5);
    expect(landing).toBeDefined();
    expect(motion.height).toBe(0);
    expect(motion.verticalVelocity).toBe(0);
  });
});

describe('loose-ball prediction', () => {
  it('matches authoritative integration for a wall rebound and does not mutate input', () => {
    const { tuning, arena } = createPhysics();
    const motion = createMotion({
      position: { x: 8.2, y: 0 },
      velocity: { x: 40, y: 2 }
    });
    const original = structuredClone(motion);
    const authoritative = advanceLooseBall(motion, FIXED_STEP_SECONDS, tuning, arena);
    const prediction = predictLooseBallTrajectory(motion, tuning, arena, {
      fixedStepSeconds: FIXED_STEP_SECONDS,
      maxSteps: 1
    });

    expect(motion).toEqual(original);
    expect(prediction.finalState).toEqual(authoritative.nextState);
    expect(prediction.contacts).toEqual(authoritative.contacts);
  });

  it('matches authoritative integration for a valid aperture crossing exactly once', () => {
    const { tuning, arena } = createPhysics();
    const motion = createMotion({
      position: { x: 0, y: 14 },
      velocity: { x: 0, y: 60 }
    });
    const authoritative = advanceLooseBall(motion, FIXED_STEP_SECONDS, tuning, arena);
    const prediction = predictLooseBallTrajectory(motion, tuning, arena, {
      fixedStepSeconds: FIXED_STEP_SECONDS,
      maxSteps: 5
    });

    expect(prediction.goalApertures).toHaveLength(1);
    expect(prediction.goalApertures[0]).toEqual(authoritative.goalAperture);
    expect(prediction.contacts).toEqual([]);
    expect(prediction.finalState).toEqual(authoritative.nextState);
  });

  it('includes the representative lob first landing within the default horizon', () => {
    const { tuning, arena } = createPhysics();
    const prediction = predictLooseBallTrajectory(
      createMotion({
        position: { x: -3, y: 0 },
        velocity: { x: 2, y: 6 },
        verticalVelocity: 18
      }),
      tuning,
      arena
    );

    expect(tuning.getNumber(BALL_PREDICTION_HORIZON_STEPS_KEY)).toBeGreaterThanOrEqual(120);
    expect(prediction.landing).toBeDefined();
    expect(prediction.landing?.timeSeconds).toBeGreaterThan(1);
    expect(prediction.landing?.timeSeconds).toBeLessThan(2.5);
  });
});
