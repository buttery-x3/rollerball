import {
  BALL_RADIUS_KEY,
  PLAYER_RADIUS_KEY,
  RECEIVE_CATCH_HEIGHT_KEY,
  type TuningReader
} from '../config/tuning';
import type { GameState, PlayerState } from './gameState';
import {
  RECEIVE_DIAGNOSTIC_LAYER,
  type DiagnosticRecord
} from './diagnostics';
import type { ReceiveInteractionObservation } from './receiving';

const ENVELOPE_COLOR = '#85dacc';
const LOCKOUT_COLOR = '#eb6f92';
const ONE_TOUCH_COLOR = '#c4a7e7';
const PICKUP_COLOR = '#f6c177';

function oneTouchData(player: PlayerState): Readonly<Record<string, unknown>> {
  const charge = player.oneTouch.charge;
  const buffer = player.oneTouch.buffer;
  return {
    charge: {
      active: charge.family !== undefined,
      family: charge.family ?? null,
      elapsedSeconds: charge.elapsedSeconds,
      strength: charge.strength,
      progress: charge.progress
    },
    buffer: buffer
      ? {
          direction: { ...buffer.direction },
          magnitude: buffer.magnitude,
          ticksRemaining: buffer.ticksRemaining
        }
      : null
  };
}

function playerReceiveData(
  tick: number,
  state: GameState,
  player: PlayerState,
  envelopeRadius: number,
  catchHeight: number
): Readonly<Record<string, unknown>> {
  const release = state.ball.mode === 'loose' ? state.ball.release : undefined;
  const lockedOut =
    release?.releasedById === player.definition.id &&
    release.reacquisitionLockoutTicksRemaining > 0;

  return {
    tick,
    playerId: player.definition.id,
    teamId: player.definition.teamId,
    envelopeRadius,
    catchHeight,
    lockedOut,
    lockoutTicksRemaining: lockedOut
      ? release.reacquisitionLockoutTicksRemaining
      : 0,
    oneTouch: oneTouchData(player)
  };
}

export function createReceivingDiagnosticRecords(
  tick: number,
  state: GameState,
  tuning: TuningReader,
  interaction: ReceiveInteractionObservation | undefined
): readonly DiagnosticRecord[] {
  const envelopeRadius =
    tuning.getNumber(PLAYER_RADIUS_KEY) + tuning.getNumber(BALL_RADIUS_KEY);
  const catchHeight = tuning.getNumber(RECEIVE_CATCH_HEIGHT_KEY);
  const fieldPlayers = state.players.filter(
    (player) => player.definition.role === 'field'
  );
  const playerData = fieldPlayers.map((player) =>
    playerReceiveData(tick, state, player, envelopeRadius, catchHeight)
  );
  const summaryPosition = fieldPlayers[0]?.position ?? { x: 0, y: 0 };
  const records: DiagnosticRecord[] = [
    {
      layer: RECEIVE_DIAGNOSTIC_LAYER,
      source: 'ballPlayerInteraction',
      entityId: 'receive-state',
      primitive: {
        type: 'label',
        position: { x: summaryPosition.x, y: summaryPosition.y + 2 },
        text: interaction
          ? `Receive · ${interaction.outcome} · ${interaction.playerId}`
          : 'Receive · awaiting contact',
        color: interaction?.outcome === 'one-touch' ? ONE_TOUCH_COLOR : ENVELOPE_COLOR
      },
      data: {
        tick,
        ballMode: state.ball.mode,
        releaseLockout:
          state.ball.mode === 'loose' && state.ball.release
            ? { ...state.ball.release }
            : null,
        catchHeight,
        envelopeRadius,
        players: playerData,
        interaction: interaction ?? null
      }
    }
  ];

  for (const [index, player] of fieldPlayers.entries()) {
    const data = playerData[index];
    const lockedOut = data.lockedOut === true;
    const charge = player.oneTouch.charge;
    const buffer = player.oneTouch.buffer;
    records.push({
      layer: RECEIVE_DIAGNOSTIC_LAYER,
      source: 'receiveEnvelope',
      entityId: `${player.definition.id}-receive-envelope`,
      primitive: {
        type: 'circle',
        center: player.position,
        radius: envelopeRadius,
        color: lockedOut ? LOCKOUT_COLOR : ENVELOPE_COLOR
      },
      data
    });
    records.push({
      layer: RECEIVE_DIAGNOSTIC_LAYER,
      source: 'oneTouchState',
      entityId: `${player.definition.id}-one-touch-state`,
      primitive: {
        type: 'label',
        position: { x: player.position.x, y: player.position.y + 1.25 },
        text: charge.family
          ? `One-touch · ${charge.family} · ${Math.round(charge.progress * 100)}%`
          : buffer
            ? `One-touch · buffered ${buffer.ticksRemaining}t`
            : lockedOut
              ? `Receive locked · ${data.lockoutTicksRemaining}t`
              : 'One-touch · idle',
        color: lockedOut ? LOCKOUT_COLOR : ONE_TOUCH_COLOR
      },
      data
    });
  }

  if (interaction) {
    records.push({
      layer: RECEIVE_DIAGNOSTIC_LAYER,
      source: 'resolvedBallPlayerInteraction',
      entityId: 'receive-interaction',
      primitive: {
        type: 'circle',
        center: interaction.contactPosition,
        radius: Math.max(tuning.getNumber(BALL_RADIUS_KEY) * 0.65, 0.08),
        color: interaction.outcome === 'one-touch' ? ONE_TOUCH_COLOR : PICKUP_COLOR
      },
      data: { tick, ...interaction }
    });
    if (interaction.outcome === 'one-touch') {
      records.push({
        layer: RECEIVE_DIAGNOSTIC_LAYER,
        source: 'resolvedBallPlayerInteraction',
        entityId: 'one-touch-launch',
        primitive: {
          type: 'vector',
          origin: interaction.contactPosition,
          direction: interaction.velocity,
          color: ONE_TOUCH_COLOR
        },
        data: { tick, ...interaction }
      });
    }
  }

  return records;
}
