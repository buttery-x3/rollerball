import type { TuningReader } from '../config/tuning';
import { playerStrengthRatio, playerRetentionThreshold } from '../config/playerAttributes';
import { BALL_POST_RELEASE_LOCKOUT_TICKS_KEY } from '../config/tuning';
import { routedInputs, type SimulationInput } from '../control/types';
import type { PlayerContact } from '../physics/playerContact';
import { createEmptyOneTouchState, createEmptyThrowChargeState, createLooseBallState, type GameState, type PlayerState } from './gameState';
import type { DiagnosticSink } from './diagnostics';

export interface CheckImpact {
  readonly checkerId: string;
  readonly targetId: string;
  readonly closingSpeed: number;
  readonly alignment: number;
  readonly strengthFactor: number;
  readonly impactScore: number;
  readonly control: number;
  readonly retentionThreshold: number;
  readonly outcome: 'weak' | 'knockback' | 'stumble' | 'turnover' | 'immune';
}

export function advanceCheckState(state: GameState, tuning: TuningReader, input?: SimulationInput): void {
  for (const player of state.players) {
    const playerInput = routedInputs(input).find(candidate => candidate.playerId === player.definition.id);
    const contact = player.contact;
    contact.checkTicksRemaining = Math.max(0, contact.checkTicksRemaining - 1);
    contact.checkRecoveryTicksRemaining = Math.max(0, contact.checkRecoveryTicksRemaining - 1);
    contact.stumbleTicksRemaining = Math.max(0, contact.stumbleTicksRemaining - 1);
    contact.immunityTicksRemaining = Math.max(0, contact.immunityTicksRemaining - 1);
    if (contact.checkTicksRemaining === 0) contact.hitPlayerIds = [];
    const hasBall = state.ball.mode === 'possessed' && state.ball.holderId === player.definition.id;
    if (hasBall) contact.checkTicksRemaining = 0;
    if (!hasBall && playerInput?.intent.check.pressed &&
        contact.checkRecoveryTicksRemaining === 0 && contact.stumbleTicksRemaining === 0) {
      contact.checkTicksRemaining = tuning.getNumber('contact.checkWindowTicks');
      contact.checkRecoveryTicksRemaining = contact.checkTicksRemaining + tuning.getNumber('contact.checkRecoveryTicks');
      contact.hitPlayerIds = [];
    }
  }
}

/** Authored possession transition; the geometric solver never owns this rule. */
export function forceContactTurnover(state: GameState, target: PlayerState, normal: { x: number; y: number }, impactScore: number, tuning: TuningReader): void {
  if (state.ball.mode !== 'possessed' || state.ball.holderId !== target.definition.id) return;
  const speed = impactScore * tuning.getNumber('contact.turnoverSpeedScale');
  state.ball = createLooseBallState({ position: { ...target.position },
    velocity: { x: normal.x * speed, y: normal.y * speed },
    release: { releasedById: target.definition.id, reacquisitionLockoutTicksRemaining: tuning.getNumber(BALL_POST_RELEASE_LOCKOUT_TICKS_KEY) }
  });
  target.throwCharge = createEmptyThrowChargeState();
  target.oneTouch = createEmptyOneTouchState();
}

export function resolveActiveChecks(state: GameState, contacts: readonly PlayerContact[], tuning: TuningReader): readonly CheckImpact[] {
  const impacts: CheckImpact[] = [];
  for (const geometry of contacts) {
    for (const reverse of [false, true]) {
      const checker = state.players.find(p => p.definition.id === (reverse ? geometry.secondId : geometry.firstId))!;
      const target = state.players.find(p => p.definition.id === (reverse ? geometry.firstId : geometry.secondId))!;
      if (!checker || !target || checker.definition.teamId === target.definition.teamId ||
          checker.contact.checkTicksRemaining === 0 || checker.contact.stumbleTicksRemaining > 0 ||
          checker.contact.hitPlayerIds.includes(target.definition.id)) continue;
      checker.contact.hitPlayerIds.push(target.definition.id);
      const direction = reverse ? -1 : 1;
      const normal = { x: geometry.normal.x * direction, y: geometry.normal.y * direction };
      const alignment = Math.max(0, checker.facing.x * normal.x + checker.facing.y * normal.y);
      const strengthFactor = playerStrengthRatio(checker.definition.attributes, target.definition.attributes, tuning);
      const impactScore = geometry.closingSpeed * alignment * strengthFactor;
      const retentionThreshold = playerRetentionThreshold(target.definition.attributes, tuning);
      let outcome: CheckImpact['outcome'] = 'weak';
      if (target.contact.immunityTicksRemaining > 0) {
        outcome = 'immune';
      } else if (impactScore >= tuning.getNumber('contact.minimumImpact')) {
        const knockback = impactScore * tuning.getNumber('contact.knockbackScale');
        target.velocity = { x: target.velocity.x + normal.x * knockback, y: target.velocity.y + normal.y * knockback };
        outcome = 'knockback';
        if (impactScore >= tuning.getNumber('contact.stumbleThreshold')) {
          target.contact.stumbleTicksRemaining = tuning.getNumber('contact.stumbleTicks');
          target.contact.immunityTicksRemaining = target.contact.stumbleTicksRemaining + tuning.getNumber('contact.immunityTicks');
          target.contact.checkTicksRemaining = 0;
          target.throwCharge = createEmptyThrowChargeState();
          target.oneTouch = createEmptyOneTouchState();
          outcome = 'stumble';
        }
        if (state.ball.mode === 'possessed' && state.ball.holderId === target.definition.id &&
            (impactScore >= tuning.getNumber('contact.turnoverThreshold') || impactScore >= retentionThreshold)) {
          forceContactTurnover(state, target, normal, impactScore, tuning);
          outcome = 'turnover';
        }
      }
      impacts.push({ checkerId: checker.definition.id, targetId: target.definition.id,
        closingSpeed: geometry.closingSpeed, alignment, strengthFactor, impactScore, outcome,
        control: target.definition.attributes.control, retentionThreshold });
    }
  }
  return impacts;
}

export function publishCheckingDiagnostics(state: GameState, impacts: readonly CheckImpact[], sink?: DiagnosticSink): void {
  if (!sink?.isLayerEnabled('checking')) return;
  for (const player of state.players) {
    sink.publish({ layer: 'checking', source: 'checking', entityId: player.definition.id,
      primitive: { type: 'label', position: player.position,
        text: player.contact.stumbleTicksRemaining > 0 ? 'Stumble' : player.contact.checkTicksRemaining > 0 ? 'Check' : '' },
      data: { playerId: player.definition.id, ...player.contact } });
  }
  sink.publish({ layer: 'checking', source: 'checking', entityId: 'checking-state',
    primitive: { type: 'label', position: { x: 0, y: 0 }, text: '' },
    data: { tick: state.tick, players: state.players.map(p => ({ playerId: p.definition.id, ...p.contact })), impacts } });
}
