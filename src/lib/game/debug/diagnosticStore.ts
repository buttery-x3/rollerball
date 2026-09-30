import type {
  DiagnosticFrame,
  DiagnosticLayerDefinition,
  DiagnosticLayerState,
  DiagnosticRecord,
  DiagnosticSink
} from '../sim/diagnostics';
import {
  ARENA_DIAGNOSTIC_LAYER,
  BALL_DIAGNOSTIC_LAYER,
  CONTROL_DIAGNOSTIC_LAYER,
  PLAYER_MOVEMENT_DIAGNOSTIC_LAYER,
  PLAYER_CONTACT_DIAGNOSTIC_LAYER,
  RECEIVE_DIAGNOSTIC_LAYER,
  RUNTIME_DIAGNOSTIC_LAYER,
  THROW_DIAGNOSTIC_LAYER
} from '../sim/diagnostics';

export {
  ARENA_DIAGNOSTIC_LAYER,
  BALL_DIAGNOSTIC_LAYER,
  CONTROL_DIAGNOSTIC_LAYER,
  PLAYER_MOVEMENT_DIAGNOSTIC_LAYER,
  PLAYER_CONTACT_DIAGNOSTIC_LAYER,
  RECEIVE_DIAGNOSTIC_LAYER,
  RUNTIME_DIAGNOSTIC_LAYER,
  THROW_DIAGNOSTIC_LAYER
} from '../sim/diagnostics';

export interface DiagnosticStore extends DiagnosticSink {
  getFrame(): DiagnosticFrame;
  listLayers(): readonly DiagnosticLayerState[];
  registerLayer(definition: DiagnosticLayerDefinition): void;
  setLayerEnabled(layer: string, enabled: boolean): void;
  subscribe(listener: () => void): () => void;
}

export const DEFAULT_DIAGNOSTIC_LAYERS: readonly DiagnosticLayerDefinition[] = [
  { key: 'ai', label: 'AI candidates and decisions', enabledByDefault: false },
  { key: 'aiScores', label: 'AI spatial score field', enabledByDefault: false },
  { key: 'keeper', label: 'Goalkeeper saves and targets', enabledByDefault: false },
  { key: 'checking', label: 'Checks, stumble and turnovers', enabledByDefault: false },
  { key: 'match', label: 'Goals and match flow', enabledByDefault: true },
  {
    key: RUNTIME_DIAGNOSTIC_LAYER,
    label: 'Runtime',
    enabledByDefault: true
  },
  {
    key: ARENA_DIAGNOSTIC_LAYER,
    label: 'Arena geometry',
    enabledByDefault: true
  },
  {
    key: CONTROL_DIAGNOSTIC_LAYER,
    label: 'Control input',
    enabledByDefault: true
  },
  {
    key: PLAYER_MOVEMENT_DIAGNOSTIC_LAYER,
    label: 'Player movement',
    enabledByDefault: true
  },
  {
    key: PLAYER_CONTACT_DIAGNOSTIC_LAYER,
    label: 'Player contact and separation',
    enabledByDefault: false
  },
  {
    key: BALL_DIAGNOSTIC_LAYER,
    label: 'Ball trajectory',
    enabledByDefault: true
  },
  {
    key: THROW_DIAGNOSTIC_LAYER,
    label: 'Throw charging and releases',
    enabledByDefault: true
  },
  {
    key: RECEIVE_DIAGNOSTIC_LAYER,
    label: 'Receiving and one-touch',
    enabledByDefault: false
  }
];

export function createDiagnosticStore(
  definitions: readonly DiagnosticLayerDefinition[] = DEFAULT_DIAGNOSTIC_LAYERS
): DiagnosticStore {
  const layers = new Map<string, DiagnosticLayerState>();
  const listeners = new Set<() => void>();
  let currentFrame: DiagnosticFrame = { tick: 0, records: [] };
  let visibleFrame: DiagnosticFrame = currentFrame;
  let pendingTick: number | undefined;
  let pendingRecords: DiagnosticRecord[] = [];
  // Tactical decisions run more slowly than physics. Preserve their last
  // sampled explanation between updates without recalculating gameplay queries.
  const spatialDecisions = new Map<string, readonly DiagnosticRecord[]>();
  const isDecision = (record: DiagnosticRecord) =>
    record.source === 'spatialCandidates' || record.source === 'teamRoleSelection';
  const decisionKey = (record: DiagnosticRecord) => `${record.source}:${record.data?.playerId}`;

  const notify = (): void => {
    for (const listener of listeners) {
      listener();
    }
  };

  const assertLayerKey = (layer: string): void => {
    if (!layer.trim()) {
      throw new RangeError('A diagnostic layer must have a non-empty key.');
    }
  };

  const assertLayerDefinition = (definition: DiagnosticLayerDefinition): void => {
    assertLayerKey(definition.key);
    if (!definition.label.trim()) {
      throw new RangeError(`Diagnostic layer '${definition.key}' must have a non-empty label.`);
    }
  };

  const rebuildVisibleFrame = (): void => {
    visibleFrame = {
      tick: currentFrame.tick,
      records: currentFrame.records.filter(
        (record) => layers.get(record.layer)?.enabled ?? false
      )
    };
  };

  for (const definition of definitions) {
    assertLayerDefinition(definition);
    if (layers.has(definition.key)) {
      throw new Error(`Diagnostic layer '${definition.key}' is already registered.`);
    }

    layers.set(definition.key, {
      ...definition,
      enabled: definition.enabledByDefault ?? true
    });
  }

  return {
    beginTick(tick: number): void {
      if (!Number.isInteger(tick) || tick < 0) {
        throw new RangeError('A diagnostic tick must be a non-negative integer.');
      }

      pendingTick = tick;
      pendingRecords = [];
    },

    isLayerEnabled(layer: string): boolean {
      return layers.get(layer)?.enabled ?? false;
    },

    publish(record: DiagnosticRecord): void {
      if (pendingTick === undefined) {
        throw new Error('Diagnostics must begin a tick before publishing records.');
      }

      if (!layers.has(record.layer)) {
        throw new Error(`Unknown diagnostic layer '${record.layer}'.`);
      }

      pendingRecords.push(record);
    },

    endTick(): void {
      if (pendingTick === undefined) {
        return;
      }

      const match = pendingRecords.find(record => record.entityId === 'match-state');
      const nonPlaying = (match?.data?.phase && match.data.phase !== 'playing') ||
        pendingRecords.some(record => record.layer === 'ai' && record.data?.context === 'non-playing');
      if (nonPlaying) spatialDecisions.clear();
      for (const record of pendingRecords.filter(record => record.entityId?.endsWith('-current-role'))) {
        const key = `teamRoleSelection:${record.data?.playerId}`;
        if (spatialDecisions.get(key)?.[0].data?.role !== record.data?.role) spatialDecisions.delete(key);
      }
      const updatedDecisions = new Set(pendingRecords.filter(record => !nonPlaying && isDecision(record))
        .map(decisionKey));
      for (const key of updatedDecisions) {
        spatialDecisions.set(key, pendingRecords.filter(record => isDecision(record) && decisionKey(record) === key));
      }
      currentFrame = {
        tick: pendingTick,
        records: [...pendingRecords.filter(record => !isDecision(record)),
          ...Array.from(spatialDecisions.values()).flat()]
      };
      rebuildVisibleFrame();
      pendingTick = undefined;
      pendingRecords = [];
      notify();
    },

    getFrame(): DiagnosticFrame {
      return visibleFrame;
    },

    listLayers(): readonly DiagnosticLayerState[] {
      return Array.from(layers.values(), (layer) => ({ ...layer }));
    },

    registerLayer(definition: DiagnosticLayerDefinition): void {
      assertLayerDefinition(definition);
      if (layers.has(definition.key)) {
        throw new Error(`Diagnostic layer '${definition.key}' is already registered.`);
      }

      layers.set(definition.key, {
        ...definition,
        enabled: definition.enabledByDefault ?? true
      });
      rebuildVisibleFrame();
      notify();
    },

    setLayerEnabled(layer: string, enabled: boolean): void {
      const current = layers.get(layer);
      if (!current) {
        throw new Error(`Unknown diagnostic layer '${layer}'.`);
      }

      if (current.enabled === enabled) {
        return;
      }

      layers.set(layer, { ...current, enabled });
      rebuildVisibleFrame();
      notify();
    },

    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };
}
