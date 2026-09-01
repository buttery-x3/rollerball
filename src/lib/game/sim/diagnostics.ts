import type { TuningReader } from '../config/tuning';
import type { ArenaDefinition } from '../physics/arena';

export interface DiagnosticPoint {
  readonly x: number;
  readonly y: number;
}

export interface DiagnosticVector {
  readonly x: number;
  readonly y: number;
}

export type DiagnosticPrimitive =
  | {
      readonly type: 'line';
      readonly start: DiagnosticPoint;
      readonly end: DiagnosticPoint;
      readonly color?: string;
    }
  | {
      readonly type: 'vector';
      readonly origin: DiagnosticPoint;
      readonly direction: DiagnosticVector;
      readonly color?: string;
    }
  | {
      readonly type: 'circle';
      readonly center: DiagnosticPoint;
      readonly radius: number;
      readonly color?: string;
    }
  | {
      readonly type: 'region';
      readonly center: DiagnosticPoint;
      readonly width: number;
      readonly height: number;
      readonly color?: string;
    }
  | {
      readonly type: 'label';
      readonly position: DiagnosticPoint;
      readonly text: string;
      readonly color?: string;
    };

export interface DiagnosticRecord {
  readonly layer: string;
  readonly source: string;
  readonly primitive: DiagnosticPrimitive;
  readonly data?: Readonly<Record<string, unknown>>;
  readonly entityId?: string;
}

export interface DiagnosticFrame {
  readonly tick: number;
  readonly records: readonly DiagnosticRecord[];
}

export interface DiagnosticLayerDefinition {
  readonly key: string;
  readonly label: string;
  readonly enabledByDefault?: boolean;
}

export interface DiagnosticLayerState extends DiagnosticLayerDefinition {
  readonly enabled: boolean;
}

export const RUNTIME_DIAGNOSTIC_LAYER = 'runtime';
export const ARENA_DIAGNOSTIC_LAYER = 'arena';
export const CONTROL_DIAGNOSTIC_LAYER = 'control';
export const PLAYER_MOVEMENT_DIAGNOSTIC_LAYER = 'playerMovement';
export const BALL_DIAGNOSTIC_LAYER = 'ball';
export const THROW_DIAGNOSTIC_LAYER = 'throw';

export interface DiagnosticSink {
  beginTick(tick: number): void;
  isLayerEnabled(layer: string): boolean;
  publish(record: DiagnosticRecord): void;
  endTick(): void;
}

export interface SimulationStepContext {
  readonly diagnostics?: DiagnosticSink;
  readonly tuning?: TuningReader;
  readonly arena?: ArenaDefinition;
}
