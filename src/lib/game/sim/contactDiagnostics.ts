import type { PlayerContact } from '../physics/playerContact';
import type { PlayerState } from './gameState';
import { PLAYER_CONTACT_DIAGNOSTIC_LAYER, type DiagnosticRecord } from './diagnostics';

export function createContactDiagnosticRecords(
  tick: number,
  players: readonly PlayerState[],
  radius: number,
  contacts: readonly PlayerContact[]
): readonly DiagnosticRecord[] {
  const records: DiagnosticRecord[] = players.map((player) => ({
    layer: PLAYER_CONTACT_DIAGNOSTIC_LAYER,
    source: 'playerContact',
    entityId: player.definition.id,
    primitive: {
      type: 'circle',
      center: player.position,
      radius,
      color: '#eb6f92'
    },
    data: { tick, playerId: player.definition.id, position: player.position, velocity: player.velocity }
  }));
  for (const contact of contacts) {
    records.push({
      layer: PLAYER_CONTACT_DIAGNOSTIC_LAYER,
      source: 'playerContact',
      entityId: contact.firstId,
      primitive: {
        type: 'vector',
        origin: contact.point,
        direction: contact.normal,
        color: '#f6c177'
      },
      data: { tick, ...contact }
    });
  }
  records.push({
    layer: PLAYER_CONTACT_DIAGNOSTIC_LAYER,
    source: 'playerContact',
    entityId: 'contact-state',
    primitive: {
      type: 'label',
      position: { x: 0, y: 0 },
      text: `${contacts.length} player contacts`,
      color: '#f6c177'
    },
    data: { tick, contacts }
  });
  return records;
}
