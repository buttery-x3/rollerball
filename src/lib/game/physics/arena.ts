import {
  ARENA_CROSSBAR_HEIGHT_KEY,
  ARENA_CREASE_DEPTH_KEY,
  ARENA_CREASE_WIDTH_KEY,
  ARENA_GOAL_WIDTH_KEY,
  ARENA_LENGTH_KEY,
  ARENA_WIDTH_KEY,
  type TuningReader
} from '../config/tuning';
import type { AxisAlignedBounds, Vec2 } from './geometry';

export type ArenaEnd = 'negativeY' | 'positiveY';

export interface ArenaGoalAperture {
  readonly end: ArenaEnd;
  readonly planeY: number;
  readonly minX: number;
  readonly maxX: number;
  readonly crossbarHeight: number;
}

export interface KeeperCrease {
  readonly end: ArenaEnd;
  readonly bounds: AxisAlignedBounds;
}

export interface ArenaRestartSpawns {
  readonly center: Vec2;
  readonly negativeEnd: Vec2;
  readonly positiveEnd: Vec2;
}

export interface ArenaDefinition {
  readonly width: number;
  readonly length: number;
  readonly bounds: AxisAlignedBounds;
  readonly goals: readonly [ArenaGoalAperture, ArenaGoalAperture];
  readonly keeperCreases: readonly [KeeperCrease, KeeperCrease];
  readonly restartSpawns: ArenaRestartSpawns;
}

function assertPositive(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a finite positive value.`);
  }
}

function assertWithin(value: number, min: number, max: number, name: string): void {
  if (value < min || value > max) {
    throw new RangeError(`${name} must be between ${min} and ${max}.`);
  }
}

function readPositive(tuning: TuningReader, key: string, name: string): number {
  const value = tuning.getNumber(key);
  assertPositive(value, name);
  return value;
}

function createGoal(
  end: ArenaEnd,
  halfLength: number,
  halfGoalWidth: number,
  crossbarHeight: number
): ArenaGoalAperture {
  return {
    end,
    planeY: end === 'positiveY' ? halfLength : -halfLength,
    minX: -halfGoalWidth,
    maxX: halfGoalWidth,
    crossbarHeight
  };
}

function createCrease(
  end: ArenaEnd,
  halfLength: number,
  halfCreaseWidth: number,
  creaseDepth: number
): KeeperCrease {
  const minY = end === 'positiveY' ? halfLength - creaseDepth : -halfLength;
  const maxY = end === 'positiveY' ? halfLength : -halfLength + creaseDepth;

  return {
    end,
    bounds: {
      minX: -halfCreaseWidth,
      maxX: halfCreaseWidth,
      minY,
      maxY
    }
  };
}

export function createArenaDefinition(tuning: TuningReader): ArenaDefinition {
  const width = readPositive(tuning, ARENA_WIDTH_KEY, 'Arena width');
  const length = readPositive(tuning, ARENA_LENGTH_KEY, 'Arena length');
  const goalWidth = readPositive(tuning, ARENA_GOAL_WIDTH_KEY, 'Goal width');
  const crossbarHeight = readPositive(
    tuning,
    ARENA_CROSSBAR_HEIGHT_KEY,
    'Crossbar height'
  );
  const creaseWidth = readPositive(tuning, ARENA_CREASE_WIDTH_KEY, 'Keeper crease width');
  const creaseDepth = readPositive(tuning, ARENA_CREASE_DEPTH_KEY, 'Keeper crease depth');

  assertWithin(goalWidth, 0, width, 'Goal width');
  assertWithin(creaseWidth, 0, width, 'Keeper crease width');
  assertWithin(creaseDepth, 0, length, 'Keeper crease depth');
  if (creaseDepth >= length) {
    throw new RangeError('Keeper crease depth must be less than the arena length.');
  }

  const halfWidth = width / 2;
  const halfLength = length / 2;
  const halfGoalWidth = goalWidth / 2;
  const halfCreaseWidth = creaseWidth / 2;

  return {
    width,
    length,
    bounds: {
      minX: -halfWidth,
      maxX: halfWidth,
      minY: -halfLength,
      maxY: halfLength
    },
    goals: [
      createGoal('negativeY', halfLength, halfGoalWidth, crossbarHeight),
      createGoal('positiveY', halfLength, halfGoalWidth, crossbarHeight)
    ],
    keeperCreases: [
      createCrease('negativeY', halfLength, halfCreaseWidth, creaseDepth),
      createCrease('positiveY', halfLength, halfCreaseWidth, creaseDepth)
    ],
    restartSpawns: {
      center: { x: 0, y: 0 },
      negativeEnd: { x: 0, y: -halfLength + creaseDepth },
      positiveEnd: { x: 0, y: halfLength - creaseDepth }
    }
  };
}
