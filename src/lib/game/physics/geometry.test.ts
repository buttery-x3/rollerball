import { describe, expect, it } from 'vitest';
import {
  constrainCircleToBounds,
  isCircleWithinBounds,
  sweepCircleAgainstBounds,
  type AxisAlignedBounds
} from './geometry';

const BOUNDS: AxisAlignedBounds = {
  minX: -9,
  maxX: 9,
  minY: -15,
  maxY: 15
};

describe('planar circle constraints', () => {
  it('leaves an interior circle unchanged', () => {
    const result = constrainCircleToBounds({ x: 0, y: 0 }, 0.75, BOUNDS);

    expect(result).toEqual({
      position: { x: 0, y: 0 },
      correction: { x: 0, y: 0 },
      contacts: []
    });
  });

  it('insets each boundary by the circle radius', () => {
    expect(constrainCircleToBounds({ x: -20, y: 0 }, 1, BOUNDS)).toEqual({
      position: { x: -8, y: 0 },
      correction: { x: 12, y: 0 },
      contacts: ['left']
    });
    expect(constrainCircleToBounds({ x: 20, y: 0 }, 1, BOUNDS).contacts).toEqual(['right']);
    expect(constrainCircleToBounds({ x: 0, y: -20 }, 1, BOUNDS).contacts).toEqual(['bottom']);
    expect(constrainCircleToBounds({ x: 0, y: 20 }, 1, BOUNDS).contacts).toEqual(['top']);
  });

  it('reports both contacts deterministically at a corner', () => {
    const result = constrainCircleToBounds({ x: -20, y: 20 }, 1, BOUNDS);

    expect(result.position).toEqual({ x: -8, y: 14 });
    expect(result.contacts).toEqual(['left', 'top']);
    expect(isCircleWithinBounds(result.position, 1, BOUNDS)).toBe(true);
  });

  it('is idempotent after the circle has been constrained', () => {
    const first = constrainCircleToBounds({ x: -20, y: 20 }, 1, BOUNDS);
    const second = constrainCircleToBounds(first.position, 1, BOUNDS);

    expect(second.position).toEqual(first.position);
    expect(second.contacts).toEqual(first.contacts);
    expect(second.correction).toEqual({ x: 0, y: 0 });
  });

  it('rejects a circle that cannot fit inside the bounds', () => {
    expect(() => constrainCircleToBounds({ x: 0, y: 0 }, 10, BOUNDS)).toThrow(
      'Circle radius must fit inside the bounds.'
    );
    expect(() => constrainCircleToBounds({ x: 0, y: 0 }, -1, BOUNDS)).toThrow(
      'Circle radius must be non-negative.'
    );
  });
});

describe('swept circle boundaries', () => {
  it('finds the earliest solid boundary contact instead of tunnelling', () => {
    expect(sweepCircleAgainstBounds({ x: 0, y: 0 }, { x: 20, y: 0 }, 1, BOUNDS)).toEqual([
      {
        boundary: 'right',
        time: 0.4,
        position: { x: 8, y: 0 },
        normal: { x: -1, y: 0 }
      }
    ]);
  });

  it('returns simultaneous corner contacts in stable boundary order', () => {
    expect(sweepCircleAgainstBounds({ x: 0, y: 0 }, { x: 16, y: 28 }, 1, BOUNDS)).toEqual([
      {
        boundary: 'right',
        time: 0.5,
        position: { x: 8, y: 14 },
        normal: { x: -1, y: 0 }
      },
      {
        boundary: 'top',
        time: 0.5,
        position: { x: 8, y: 14 },
        normal: { x: 0, y: -1 }
      }
    ]);
  });

  it('reports an outward sweep immediately when already touching a boundary', () => {
    expect(
      sweepCircleAgainstBounds({ x: 8, y: 0 }, { x: 1, y: 0 }, 1, BOUNDS)
    ).toEqual([
      {
        boundary: 'right',
        time: 0,
        position: { x: 8, y: 0 },
        normal: { x: -1, y: 0 }
      }
    ]);
  });
});
