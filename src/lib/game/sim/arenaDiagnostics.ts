import type { ArenaDefinition, ArenaGoalAperture, KeeperCrease } from '../physics/arena';
import {
  ARENA_DIAGNOSTIC_LAYER,
  type DiagnosticRecord,
  type DiagnosticPoint
} from './diagnostics';

const BOUNDARY_COLOR = '#7aa2f7';
const GOAL_COLOR = '#f6c177';
const CREASE_COLOR = '#9ccfd8';

function point(x: number, y: number): DiagnosticPoint {
  return { x, y };
}

function line(
  source: string,
  start: DiagnosticPoint,
  end: DiagnosticPoint,
  color: string,
  entityId: string
): DiagnosticRecord {
  return {
    layer: ARENA_DIAGNOSTIC_LAYER,
    source,
    entityId,
    primitive: { type: 'line', start, end, color }
  };
}

function goalRecords(goal: ArenaGoalAperture): DiagnosticRecord[] {
  const sign = goal.end === 'positiveY' ? 1 : -1;
  return [
    line(
      'arenaDefinition',
      point(goal.minX, goal.planeY),
      point(goal.maxX, goal.planeY),
      GOAL_COLOR,
      `goal-aperture-${goal.end}`
    ),
    {
      layer: ARENA_DIAGNOSTIC_LAYER,
      source: 'arenaDefinition',
      entityId: `goal-crossbar-${goal.end}`,
      primitive: {
        type: 'label',
        position: point(goal.maxX + 0.4, goal.planeY - sign * 0.8),
        text: `${goal.end} goal · crossbar ${goal.crossbarHeight}`,
        color: GOAL_COLOR
      }
    }
  ];
}

function creaseRecord(crease: KeeperCrease): DiagnosticRecord {
  const { bounds } = crease;
  return {
    layer: ARENA_DIAGNOSTIC_LAYER,
    source: 'arenaDefinition',
    entityId: `keeper-crease-${crease.end}`,
    primitive: {
      type: 'region',
      center: point((bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2),
      width: bounds.maxX - bounds.minX,
      height: bounds.maxY - bounds.minY,
      color: CREASE_COLOR
    }
  };
}

export function createArenaDiagnosticRecords(
  arena: ArenaDefinition
): readonly DiagnosticRecord[] {
  const { minX, maxX, minY, maxY } = arena.bounds;
  const records: DiagnosticRecord[] = [
    line('arenaDefinition', point(minX, minY), point(maxX, minY), BOUNDARY_COLOR, 'arena-bottom'),
    line('arenaDefinition', point(maxX, minY), point(maxX, maxY), BOUNDARY_COLOR, 'arena-right'),
    line('arenaDefinition', point(maxX, maxY), point(minX, maxY), BOUNDARY_COLOR, 'arena-top'),
    line('arenaDefinition', point(minX, maxY), point(minX, minY), BOUNDARY_COLOR, 'arena-left')
  ];

  for (const goal of arena.goals) {
    records.push(...goalRecords(goal));
  }

  for (const crease of arena.keeperCreases) {
    records.push(creaseRecord(crease));
  }

  return records;
}
