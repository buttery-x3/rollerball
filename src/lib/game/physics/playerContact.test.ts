import { describe, expect, it } from 'vitest';
import { resolvePlayerCircleContacts, type ContactBody } from './playerContact';
import type { Vec2 } from './geometry';

const bounds = { minX: -9, maxX: 9, minY: -15, maxY: 15 };
function body(id: string, position: Vec2, velocity: Vec2 = { x: 0, y: 0 }): ContactBody {
  return { id, position, previousPosition: position, velocity, radius: 0.6, bounds };
}

describe('player circle response', () => {
  it('converges overlapping players against a wall without outward motion', () => {
    const result = resolvePlayerCircleContacts([
      body('a', { x: 7.7, y: 0 }, { x: 8, y: 0 }),
      body('b', { x: 8.4, y: 0 })
    ], 0);
    expect(result.bodies[0].position.x).toBeCloseTo(7.2, 6);
    expect(result.bodies[1].position.x).toBe(8.4);
    expect(result.bodies[0].velocity.x).toBeCloseTo(0, 6);
    expect(result.bodies[1].velocity.x).toBe(0);
  });

  it('separates coincident players deterministically independent of array order', () => {
    const inputs = Array.from({ length: 10 }, (_, index) => body(`player-${index}`, { x: 0, y: 0 }));
    const result = resolvePlayerCircleContacts(inputs, 0);
    expect(resolvePlayerCircleContacts([...inputs].reverse(), 0)).toEqual(result);
    for (let index = 0; index < result.bodies.length; index += 1) {
      const current = result.bodies[index];
      for (const other of result.bodies.slice(index + 1)) {
        expect(Math.hypot(current.position.x - other.position.x, current.position.y - other.position.y))
          .toBeGreaterThanOrEqual(1.2 - 1e-6);
      }
      expect(current.velocity).toEqual({ x: 0, y: 0 });
    }
    expect(inputs.every((input) => input.position.x === 0 && input.position.y === 0)).toBe(true);
  });

  it('sweeps crossing circles at maximum movement speed and minimum player radius', () => {
    const first = { ...body('a', { x: 0.03, y: 0 }, { x: 20, y: 0 }), radius: 0.25, previousPosition: { x: -0.3, y: 0 } };
    const second = { ...body('b', { x: -0.03, y: 0 }, { x: -20, y: 0 }), radius: 0.25, previousPosition: { x: 0.3, y: 0 } };
    const result = resolvePlayerCircleContacts([first, second], 0);
    expect(result.bodies[0].position.x).toBeCloseTo(-0.25, 8);
    expect(result.bodies[1].position.x).toBeCloseTo(0.25, 8);
    expect(result.contacts[0].closingSpeed).toBe(40);
    expect(result.contacts[0].time).toBeGreaterThan(0);
    expect(result.contacts[0].time).toBeLessThan(1);
    expect(result.bodies[0].velocity.x).toBe(0);
    expect(result.bodies[1].velocity.x).toBe(0);
  });

  it('preserves tangential motion and never adds a bounce to separating bodies', () => {
    const result = resolvePlayerCircleContacts([
      body('a', { x: -0.5, y: 0 }, { x: -2, y: 3 }),
      body('b', { x: 0.5, y: 0 }, { x: 2, y: -1 })
    ], 0.3);
    expect(result.bodies.map((item) => item.velocity)).toEqual([{ x: -2, y: 3 }, { x: 2, y: -1 }]);
    expect(result.contacts[0].velocityResponse).toBe(0);
  });
});
