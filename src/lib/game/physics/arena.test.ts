import { describe, expect, it } from 'vitest';
import {
  ARENA_CREASE_DEPTH_KEY,
  ARENA_GOAL_WIDTH_KEY,
  ARENA_LENGTH_KEY,
  ARENA_WIDTH_KEY,
  createTuningRegistry,
  type TuningReader
} from '../config/tuning';
import { createArenaDefinition } from './arena';

describe('arena definition', () => {
  it('derives both end geometries from the central tuning registry', () => {
    const arena = createArenaDefinition(createTuningRegistry());

    expect(arena.width).toBe(18);
    expect(arena.length).toBe(30);
    expect(arena.bounds).toEqual({ minX: -9, maxX: 9, minY: -15, maxY: 15 });
    expect(arena.goals).toEqual([
      {
        end: 'negativeY',
        planeY: -15,
        minX: -4,
        maxX: 4,
        crossbarHeight: 3
      },
      {
        end: 'positiveY',
        planeY: 15,
        minX: -4,
        maxX: 4,
        crossbarHeight: 3
      }
    ]);
    expect(arena.keeperCreases).toEqual([
      {
        end: 'negativeY',
        bounds: { minX: -5, maxX: 5, minY: -15, maxY: -11 }
      },
      {
        end: 'positiveY',
        bounds: { minX: -5, maxX: 5, minY: 11, maxY: 15 }
      }
    ]);
    expect(arena.restartSpawns).toEqual({
      center: { x: 0, y: 0 },
      negativeEnd: { x: 0, y: -11 },
      positiveEnd: { x: 0, y: 11 }
    });
  });

  it('keeps the positive-Y and negative-Y definitions mirrored', () => {
    const arena = createArenaDefinition(createTuningRegistry());

    expect(arena.goals[0].minX).toBe(arena.goals[1].minX);
    expect(arena.goals[0].maxX).toBe(arena.goals[1].maxX);
    expect(arena.goals[0].planeY).toBe(-arena.goals[1].planeY);
    expect(arena.keeperCreases[0].bounds.minY).toBe(-arena.keeperCreases[1].bounds.maxY);
    expect(arena.keeperCreases[0].bounds.maxY).toBe(-arena.keeperCreases[1].bounds.minY);
  });

  it('rejects a goal wider than the arena and a crease as deep as the arena', () => {
    const baseTuning = createTuningRegistry();
    const tuning: TuningReader = {
      getNumber(key) {
        if (key === ARENA_WIDTH_KEY) {
          return 8;
        }
        if (key === ARENA_GOAL_WIDTH_KEY) {
          return 20;
        }

        return baseTuning.getNumber(key);
      }
    };

    expect(() => createArenaDefinition(tuning)).toThrow('Goal width must be between 0 and 8.');

    const creaseTuning: TuningReader = {
      getNumber(key) {
        if (key === ARENA_LENGTH_KEY || key === ARENA_CREASE_DEPTH_KEY) {
          return 12;
        }

        return baseTuning.getNumber(key);
      }
    };
    expect(() => createArenaDefinition(creaseTuning)).toThrow(
      'Keeper crease depth must be less than the arena length.'
    );
  });
});
