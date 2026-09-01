import type { PlayerState, ThrowChargeState } from './gameState';
import {
  THROW_DIAGNOSTIC_LAYER,
  type DiagnosticRecord
} from './diagnostics';
import type { ThrowStepResult } from './throwing';

const CHARGE_COLOR = '#9ccfd8';
const RELEASE_COLOR = '#f6c177';
const LAUNCH_COLOR = '#c4a7e7';

function chargeData(
  playerId: string,
  charge: ThrowChargeState
): Readonly<Record<string, unknown>> {
  return {
    playerId,
    active: charge.family !== undefined,
    family: charge.family ?? null,
    elapsedSeconds: charge.elapsedSeconds,
    strength: charge.strength,
    progress: charge.progress
  };
}

function playerPosition(player: PlayerState | undefined): { x: number; y: number } {
  return player?.position ?? { x: 0, y: 0 };
}

export function createThrowDiagnosticRecords(
  tick: number,
  player: PlayerState | undefined,
  result: ThrowStepResult
): readonly DiagnosticRecord[] {
  const records: DiagnosticRecord[] = [];

  if (result.playerId && result.charge) {
    const data = chargeData(result.playerId, result.charge);
    const position = playerPosition(player);
    records.push({
      layer: THROW_DIAGNOSTIC_LAYER,
      source: 'throwCharge',
      entityId: `${result.playerId}-charge`,
      primitive: {
        type: 'label',
        position: { x: position.x, y: position.y + 1 },
        text:
          result.charge.family === undefined
            ? 'Throw · idle'
            : `Throw · ${result.charge.family} · ${Math.round(result.charge.progress * 100)}%`,
        color: CHARGE_COLOR
      },
      data: { tick, ...data }
    });
  }

  if (result.release) {
    const release = result.release;
    records.push({
      layer: THROW_DIAGNOSTIC_LAYER,
      source: 'throwRelease',
      entityId: 'throw-release',
      primitive: {
        type: 'label',
        position: { x: release.origin.x, y: release.origin.y + 1.5 },
        text: `Release · ${release.family} · ${release.source}`,
        color: RELEASE_COLOR
      },
      data: {
        tick,
        ...release
      }
    });
    records.push({
      layer: THROW_DIAGNOSTIC_LAYER,
      source: 'throwLaunch',
      entityId: 'throw-launch',
      primitive: {
        type: 'vector',
        origin: release.origin,
        direction: release.velocity,
        color: LAUNCH_COLOR
      },
      data: {
        tick,
        ...release
      }
    });
  }

  return records;
}
