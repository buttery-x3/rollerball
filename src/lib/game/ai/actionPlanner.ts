import { createPlayerTuning } from '../config/playerAttributes';
import { BALL_RADIUS_KEY, CONTROLS_THROW_CHARGE_TO_MAX_SECONDS_KEY, CONTROLS_THROW_MAX_STRENGTH_KEY,
  CONTROLS_THROW_MIN_STRENGTH_KEY, MOVEMENT_FACING_RESPONSE_KEY, MOVEMENT_MAX_SPEED_KEY,
  PLAYER_RADIUS_KEY, type TuningReader } from '../config/tuning';
import { RELEASED_BUTTON } from '../control/intent';
import type { PlayerIntent } from '../control/types';
import type { ArenaDefinition } from '../physics/arena';
import { constrainCircleToBounds, type Vec2 } from '../physics/geometry';
import type { AiActionDecision, AiActionKind, AiActionState } from '../sim/actionState';
import type { ReceiveOpportunity } from '../sim/ballQueries';
import { evaluateCheckImpact } from '../sim/checking';
import type { DiagnosticSink } from '../sim/diagnostics';
import { fieldPlayerIntent } from './fieldController';
import { evaluateSpatialCandidates } from './tacticalCandidates';
import { createWorldQueries, type ReadonlyGameState, type ReadonlyPlayerState, type ThrowOpportunity, type WorldQueries } from './worldQueries';

export interface ActionCandidate {
  readonly id: string;
  readonly kind: AiActionKind;
  readonly target: Vec2;
  readonly origin?: Vec2;
  readonly receiverId?: string;
  readonly strength: number;
  readonly factors: Readonly<Record<string, number>>;
  readonly score: number;
  readonly rejectedReason?: string;
  readonly forecast?: ThrowOpportunity;
}

const distance = (first: Vec2, second: Vec2) => Math.hypot(second.x - first.x, second.y - first.y);
function direction(from: Vec2, to: Vec2): Vec2 {
  const length = distance(from, to);
  return length > 1e-9 ? { x: (to.x - from.x) / length, y: (to.y - from.y) / length } : { x: 0, y: 1 };
}
function compare(first: ActionCandidate, second: ActionCandidate): number {
  return second.score - first.score || (first.id < second.id ? -1 : first.id > second.id ? 1 : 0);
}
function candidate(kind: AiActionKind, target: Vec2, score = 0, id: string = kind): ActionCandidate {
  return { id, kind, target: { ...target }, strength: 0, score, factors: { base: score } };
}

function throwCandidates(state: ReadonlyGameState, player: ReadonlyPlayerState, world: WorldQueries,
  tuning: TuningReader, origin = player.position, incoming?: ReceiveOpportunity): ActionCandidate[] {
  const goal = world.goal(player.definition.teamId);
  const attackSign = goal.end === 'positiveY' ? 1 : -1;
  const minimum = tuning.getNumber(CONTROLS_THROW_MIN_STRENGTH_KEY);
  const maximum = tuning.getNumber(CONTROLS_THROW_MAX_STRENGTH_KEY);
  const variants: { family: 'low' | 'high'; strength: number }[] = [
    { family: 'low', strength: minimum }, { family: 'high', strength: minimum },
    { family: 'low', strength: maximum }, { family: 'high', strength: (minimum + maximum) / 2 },
    { family: 'high', strength: maximum }
  ];
  const targets: { id: string; target: Vec2; receiverId?: string; shot: boolean }[] = world.teamPlayers(player.definition.teamId)
    .filter((other) => other.definition.id !== player.definition.id && other.definition.role === 'field')
    .map((other) => ({ id: `pass:${other.definition.id}`, target: { ...other.position }, receiverId: other.definition.id, shot: false }));
  const goalWidth = Math.max(0, goal.maxX - goal.minX - 2 * tuning.getNumber(BALL_RADIUS_KEY));
  const goalAimWidth = tuning.getNumber('ai.goalAimWidth');
  for (const fraction of [...new Set([-goalAimWidth, 0, goalAimWidth])]) targets.push({ id: `goal:${fraction}`, shot: true,
    target: { x: (goal.minX + goal.maxX) / 2 + goalWidth / 2 * fraction, y: goal.planeY } });
  const generated: ActionCandidate[] = [];
  // Round-robin trajectory variants keep both pass and shot families in the hard budget.
  for (const variant of variants) {
    for (const option of targets) {
      const range = distance(origin, option.target);
      const strength = incoming
        ? Math.min(maximum, minimum + (maximum - minimum) *
          ((player.oneTouch.charge.family === variant.family ? player.oneTouch.charge.elapsedSeconds : 0) + incoming.timeSeconds) /
          tuning.getNumber(CONTROLS_THROW_CHARGE_TO_MAX_SECONDS_KEY)) : variant.strength;
      if (incoming && variant.strength !== minimum) continue;
      const kind: AiActionKind = incoming ? `one-touch-${variant.family}` : `${option.shot ? 'shot' : 'pass'}-${variant.family}`;
      const factors = { base: tuning.getNumber(option.shot ? 'ai.shotValue' : 'ai.passValue'),
        progression: option.shot ? 0 : (option.target.y - origin.y) * attackSign * tuning.getNumber('ai.actionProgressWeight'),
        distance: option.shot ? -range * tuning.getNumber('ai.shotDistanceWeight') : 0,
        preparation: variant.family === 'high' ? -tuning.getNumber('ai.lobCost') : 0 };
      const cheapScore = Object.values(factors).reduce((sum, value) => sum + value, 0);
      const id = `${option.id}:${variant.family}:${incoming ? 'incoming' : strength}`;
      generated.push({ id, kind, target: option.target, origin: incoming ? { ...origin } : undefined,
        receiverId: option.receiverId, strength, factors, score: cheapScore,
        rejectedReason: range > tuning.getNumber(option.shot ? 'ai.shotRange' : 'ai.passRange') ? 'outside-action-range'
          : range < Math.max(2 * tuning.getNumber(PLAYER_RADIUS_KEY),
            option.shot ? 0 : tuning.getNumber('ai.minimumPassDistance')) ? 'target-too-close' : undefined });
    }
  }
  let detailed = 0;
  return generated.map((option) => {
    if (option.rejectedReason) return option;
    if (detailed >= tuning.getNumber('ai.actionCandidateLimit')) return { ...option, rejectedReason: 'detailed-budget' };
    detailed += 1;
    const family = option.kind.endsWith('high') ? 'high' : 'low';
    const forecast = world.throwOpportunity(player.definition.id, option.target, family, option.strength,
      option.receiverId, origin, incoming?.height ?? 0);
    const travel = option.receiverId ? forecast.receiver?.timeSeconds : forecast.goalCrossing?.timeSeconds;
    const intendedTime = travel ?? forecast.lane.travelTimeSeconds;
    const opponentTime = forecast.opposingReceiver?.timeSeconds;
    const blocked = intendedTime !== undefined && forecast.lane.contacts.some((contact) => contact.timeSeconds <= intendedTime &&
      world.player(contact.playerId)?.definition.role !== 'goalkeeper');
    // At a descending lob's first catchable sample several players may share a
    // contact timestamp. Their physical arrival lead distinguishes that contest.
    const simultaneous = intendedTime !== undefined && opponentTime !== undefined && Math.abs(opponentTime - intendedTime) <= 1 / 60 + 1e-9;
    const contention = simultaneous && forecast.receiver && forecast.opposingReceiver
      ? Math.max(0, Math.min(1, 1 + (forecast.receiver.arrivalSeconds - forecast.opposingReceiver.arrivalSeconds) /
        tuning.getNumber('ai.interceptionTimeMargin'))) : 1;
    const interception = blocked ? 1 : intendedTime !== undefined && opponentTime !== undefined && opponentTime <= intendedTime ? contention : 0;
    const keeperRisk = intendedTime === undefined ? 0 : Math.max(0, ...forecast.keeperThreats.map((keeper) =>
      keeper.ordinaryTime !== undefined && keeper.ordinaryTime <= intendedTime ? 1
        : keeper.extendedTime !== undefined && keeper.extendedTime <= intendedTime ? tuning.getNumber('ai.extendedKeeperRisk') : 0));
    const receive = forecast.receiver?.difficulty;
    const factors = { ...option.factors,
      travel: -(travel ?? 0) * tuning.getNumber('ai.actionTravelWeight'),
      interception: -interception * tuning.getNumber('ai.interceptionWeight'),
      keeper: -keeperRisk * tuning.getNumber('ai.keeperRiskWeight'),
      capability: receive ? (receive.capacity - receive.total) * tuning.getNumber('ai.receiveCapacityWeight') : 0 };
    let rejectedReason = travel === undefined ? option.receiverId ? 'receiver-cannot-reach' : 'outside-goal-aperture' : undefined;
    if (forecast.friendlyKeeperContact && intendedTime !== undefined &&
        forecast.friendlyKeeperContact.timeSeconds <= intendedTime) rejectedReason = 'friendly-keeper-before-target';
    const launchSpeed = Math.hypot(forecast.launchVelocity.x, forecast.launchVelocity.y);
    const sourceMomentum = player.velocity.x * (forecast.launchVelocity.x / Math.max(1e-9, launchSpeed)) +
      player.velocity.y * (forecast.launchVelocity.y / Math.max(1e-9, launchSpeed));
    if (!incoming && family === 'low' && launchSpeed <= sourceMomentum + tuning.getNumber('ai.releaseClearanceSpeed')) {
      rejectedReason = 'release-cannot-clear-carrier-momentum';
    }
    if (forecast.receiverContact && !forecast.receiverContact.difficulty.succeeds &&
        (travel === undefined || forecast.receiverContact.timeSeconds < travel)) rejectedReason = 'receiver-body-block-before-window';
    if (incoming) {
      const aim = direction(origin, option.target);
      const difficulty = world.receiveDifficultyAt(player.definition.id, incoming, aim);
      const alignment = Math.max(-1, Math.min(1, player.facing.x * aim.x + player.facing.y * aim.y));
      const turnSeconds = Math.acos(alignment) /
        Math.max(1e-9, createPlayerTuning(player.definition.attributes, tuning).getNumber(MOVEMENT_FACING_RESPONSE_KEY));
      if (!difficulty.succeeds) rejectedReason = 'redirect-exceeds-control';
      else if (turnSeconds > incoming.timeSeconds) rejectedReason = 'cannot-face-before-contact';
    }
    return { ...option, forecast, factors, rejectedReason,
      score: Object.values(factors).reduce((sum, value) => sum + value, 0) };
  });
}

function actorCandidates(state: ReadonlyGameState, player: ReadonlyPlayerState, world: WorldQueries,
  tuning: TuningReader, arena: ArenaDefinition, receivers: readonly ReceiveOpportunity[], diagnostics?: DiagnosticSink): ActionCandidate[] {
  if ((state.match && state.match.phase !== 'playing') || player.contact.stumbleTicksRemaining > 0) return [candidate('hold', player.position)];
  const ownsBall = state.ball.mode === 'possessed' && state.ball.holderId === player.definition.id;
  if (ownsBall) {
    const sign = world.goal(player.definition.teamId).end === 'positiveY' ? 1 : -1;
    const anchor = constrainCircleToBounds({ x: player.position.x, y: player.position.y + sign * tuning.getNumber('ai.advanceDistance') },
      tuning.getNumber(PLAYER_RADIUS_KEY), world.movementBounds(player.definition.id)).position;
    const spatial = player.definition.role === 'field' ? evaluateSpatialCandidates(state, player.definition.id, {
      purpose: 'hold', anchor, candidates: [-1, 0, 1].map((side) => ({ id: `advance:${side}`,
        position: { x: anchor.x + side * tuning.getNumber('ai.targetSearchRadius'), y: anchor.y } }))
    }, arena, tuning, diagnostics) : undefined;
    const advance = spatial?.selected ? candidate('advance', spatial.selected.position, tuning.getNumber('ai.advanceValue')) : candidate('hold', player.position);
    return [advance, ...throwCandidates(state, player, world, tuning)];
  }
  if (player.definition.role === 'goalkeeper') return [candidate('hold', player.position)];
  if (state.ball.mode === 'loose') {
    const opportunity = receivers.find((entry) => entry.teamId === player.definition.teamId);
    if (opportunity?.playerId !== player.definition.id) return [candidate('hold', player.position)];
    const direct = world.incomingContact(player.definition.id);
    // An on-line receiver can wait and face the incoming ball. Charging into
    // an already reachable hard pass raises relative speed and catch difficulty.
    const ordinary = candidate('receive', direct ? player.position : opportunity.position, tuning.getNumber('ai.receiveValue'));
    const incoming = direct ? { ...opportunity, ...direct } : opportunity;
    if (incoming.timeSeconds > tuning.getNumber('ai.oneTouchLeadSeconds')) return [ordinary];
    return [ordinary, ...throwCandidates(state, player, world, tuning, incoming.position, incoming)
      .map((option) => ({ ...option, score: option.score - tuning.getNumber('ai.oneTouchMargin'),
        factors: { ...option.factors, oneTouchCommitment: -tuning.getNumber('ai.oneTouchMargin') } }))];
  }
  const holder = world.player(state.ball.holderId)!;
  const assignment = state.tactics?.teams.flatMap((team) => team.assignments).find((item) => item.playerId === player.definition.id);
  if (holder.definition.teamId === player.definition.teamId || assignment?.role !== 'pressure' ||
      distance(player.position, holder.position) > tuning.getNumber('ai.checkRange') ||
      holder.contact.immunityTicksRemaining > 0 || player.contact.checkRecoveryTicksRemaining > 0) return [candidate('hold', player.position)];
  const normal = direction(player.position, holder.position);
  const expectedClosing = Math.max(0, createPlayerTuning(player.definition.attributes, tuning).getNumber(MOVEMENT_MAX_SPEED_KEY) -
    holder.velocity.x * normal.x - holder.velocity.y * normal.y);
  const impact = evaluateCheckImpact({ ...player, facing: normal }, holder, expectedClosing, normal, tuning);
  if (impact.impactScore < tuning.getNumber('ai.checkMinimumImpact')) return [candidate('hold', player.position)];
  return [{ ...candidate('check', holder.position, impact.impactScore),
    factors: { closingSpeed: expectedClosing, alignment: impact.alignment, strengthFactor: impact.strengthFactor,
      impact: impact.impactScore, retentionThreshold: impact.retentionThreshold } }];
}

/** Action selection at a deterministic lower cadence; persistent memory belongs to simulation. */
export function planActions(state: ReadonlyGameState, tuning: TuningReader, arena: ArenaDefinition,
  controlledPlayerIds: readonly string[], diagnostics?: DiagnosticSink): AiActionState | undefined {
  const memory = state.aiActions;
  if (!memory) return undefined;
  const possessionKey = state.ball.mode === 'possessed' ? `held:${state.ball.holderId}` : 'loose';
  const velocity = state.ball.mode === 'loose' ? state.ball.velocity : { x: 0, y: 0 };
  const restartCount = state.match?.restartCount ?? 0;
  const event = memory.lastRestartCount !== restartCount ? 'restart' : memory.lastPossessionKey !== possessionKey ? 'possession-transition'
    : distance(memory.lastBallVelocity, velocity) >= tuning.getNumber('ai.ballVelocityReplanThreshold') ? 'ball-trajectory-change' : undefined;
  const world = createWorldQueries(state, arena, tuning);
  const eligible = state.players.filter((player) => !controlledPlayerIds.includes(player.definition.id));
  let changed = memory.decisions.length !== eligible.length;
  let receivers: readonly ReceiveOpportunity[] | undefined;
  const decisions = eligible.map((player): AiActionDecision => {
    const prior = memory.decisions.find((decision) => decision.playerId === player.definition.id);
    if (prior && !event && state.tick < prior.nextThinkTick) return prior;
    changed = true;
    receivers ??= state.ball.mode === 'loose' ? world.receivers() : [];
    const options = actorCandidates(state, player, world, tuning, arena, receivers, diagnostics);
    const valid = options.filter((option) => !option.rejectedReason).sort(compare);
    const best = valid[0] ?? candidate('hold', player.position);
    const previous = valid.find((option) => option.id === prior?.candidateId);
    const charging = player.throwCharge.family === 'high' && prior?.kind.endsWith('high');
    const committed = !!prior && state.tick - prior.selectedTick < tuning.getNumber('ai.actionCommitTicks');
    const retained = !!previous && !event && (charging || committed || best.score - previous.score <= tuning.getNumber('ai.actionHysteresisMargin'));
    const selected = retained ? previous! : best;
    const sameChoice = selected.id === prior?.candidateId;
    const reason = `${event ?? 'scheduled-action-update'}: ${retained ? charging ? 'charging-retained' : 'hysteresis-retained' : 'best-score'}`;
    const decision: AiActionDecision = { playerId: player.definition.id, kind: selected.kind, candidateId: selected.id,
      target: { ...(charging && retained ? prior!.target : selected.target) }, receiverId: selected.receiverId,
      origin: selected.origin ? { ...selected.origin } : undefined,
      strength: charging && retained ? prior!.strength : selected.strength, score: selected.score,
      selectedTick: sameChoice ? prior!.selectedTick : state.tick, plannedTick: state.tick,
      nextThinkTick: state.tick + tuning.getNumber('ai.actionThinkTicks'), reason };
    if (diagnostics?.isLayerEnabled('ai')) diagnostics.publish({ layer: 'ai', source: 'actionCandidates',
      entityId: `${player.definition.id}-action-candidates`,
      primitive: { type: 'line', start: player.position, end: selected.target, color: '#a6da95' },
      data: { tick: state.tick, playerId: player.definition.id, candidates: options, selected, previousId: prior?.candidateId,
        retained, reason, nextThinkTick: decision.nextThinkTick } });
    return decision;
  });
  return changed ? { decisions, lastPossessionKey: possessionKey, lastBallVelocity: { ...velocity }, lastRestartCount: restartCount } : undefined;
}

function moveForAction(state: ReadonlyGameState, decision: AiActionDecision, tuning: TuningReader,
  arena: ArenaDefinition, target = decision.target): Pick<PlayerIntent, 'movement' | 'desiredFacing'> {
  return fieldPlayerIntent(state, { playerId: decision.playerId,
    teamId: state.players.find((player) => player.definition.id === decision.playerId)!.definition.teamId,
    role: decision.kind === 'check' ? 'pressure' : decision.kind === 'receive' ? 'intercept' : 'carrier', target,
    score: decision.score, reason: decision.reason, assignedTick: decision.selectedTick,
    targetPlannedTick: decision.plannedTick, nextThinkTick: decision.nextThinkTick }, tuning, arena).intent;
}

/** Executes a selected action through the ordinary simulation-owned action state. */
export function actionPlayerIntent(state: ReadonlyGameState, playerId: string, baseIntent: PlayerIntent,
  tuning: TuningReader, arena: ArenaDefinition, diagnostics?: DiagnosticSink): PlayerIntent {
  const decision = state.aiActions?.decisions.find((entry) => entry.playerId === playerId);
  const player = state.players.find((entry) => entry.definition.id === playerId);
  if (!decision || !player) return baseIntent;
  let intent = baseIntent;
  const holderId = state.ball.mode === 'possessed' ? state.ball.holderId : undefined;
  const holder = state.players.find((entry) => entry.definition.id === holderId);
  const hasBall = holderId === playerId;
  const aim = direction(decision.kind.startsWith('one-touch-') && decision.origin ? decision.origin : player.position, decision.target);
  const preparation = !hasBall ? state.aiActions?.decisions.find((entry) => entry.receiverId === playerId &&
    ((state.ball.mode === 'possessed' && entry.playerId === state.ball.holderId && entry.kind.startsWith('pass-')) ||
      (state.ball.mode === 'loose' && entry.kind.startsWith('one-touch-')))) : undefined;
  if (hasBall && decision.kind === 'advance' && player.definition.role === 'field') {
    intent = { ...baseIntent, ...moveForAction(state, decision, tuning, arena), actionContext: 'possessed' };
  } else if (hasBall && (decision.kind.startsWith('pass-') || decision.kind.startsWith('shot-'))) {
    const high = decision.kind.endsWith('high');
    const alignment = player.facing.x * aim.x + player.facing.y * aim.y;
    const aligned = alignment >= tuning.getNumber('ai.throwFacingCosine');
    const release = high && player.throwCharge.family === 'high' &&
      player.throwCharge.strength + 1e-9 >= decision.strength && aligned;
    // Face before starting charge so a short lob does not become a maximum lob
    // merely because the skater initially pointed away from its chosen target.
    const charge = high && !release && (player.throwCharge.family === 'high' || aligned);
    const minimum = tuning.getNumber(CONTROLS_THROW_MIN_STRENGTH_KEY);
    const maximum = tuning.getNumber(CONTROLS_THROW_MAX_STRENGTH_KEY);
    intent = { ...baseIntent, movement: { x: 0, y: 0 }, desiredFacing: aim, actionContext: 'possessed',
      highThrow: high ? { held: charge, pressed: charge && player.throwCharge.family !== 'high', released: release } : RELEASED_BUTTON,
      rightStickThrow: high ? undefined : { direction: aim,
        magnitude: maximum > minimum ? Math.max(0, Math.min(1, (decision.strength - minimum) / (maximum - minimum))) : 0 } };
  } else if (preparation && player.definition.role === 'field') {
    intent = { ...baseIntent, ...moveForAction(state, { ...decision, kind: 'receive' }, tuning, arena, preparation.target), actionContext: 'receiving' };
  } else if (!hasBall && state.ball.mode === 'loose' && decision.kind === 'receive') {
    intent = { ...baseIntent, ...moveForAction(state, decision, tuning, arena), actionContext: 'receiving' };
  } else if (!hasBall && state.ball.mode === 'loose' && decision.kind.startsWith('one-touch-')) {
    const high = decision.kind === 'one-touch-high';
    const button = { held: true, pressed: player.oneTouch.charge.family !== (high ? 'high' : 'low'), released: false };
    const reach = tuning.getNumber(PLAYER_RADIUS_KEY) + tuning.getNumber(BALL_RADIUS_KEY);
    const movement = decision.origin && distance(player.position, decision.origin) > reach + 1e-8
      ? moveForAction(state, decision, tuning, arena, decision.origin).movement : { x: 0, y: 0 };
    intent = { ...baseIntent, movement, desiredFacing: aim, actionContext: 'receiving', receive: {
      low: high ? RELEASED_BUTTON : button, high: high ? button : RELEASED_BUTTON, rightStickThrow: undefined } };
  } else if (!hasBall && state.ball.mode === 'possessed' &&
      (decision.kind === 'check' || player.contact.checkTicksRemaining > 0) &&
      holder && holder.definition.teamId !== player.definition.teamId) {
    const normal = direction(player.position, holder.position);
    const closingSpeed = Math.max(0, (player.velocity.x - holder.velocity.x) * normal.x + (player.velocity.y - holder.velocity.y) * normal.y);
    const impact = evaluateCheckImpact(player, holder, closingSpeed, normal, tuning);
    const gap = Math.max(0, distance(player.position, holder.position) - 2 * tuning.getNumber(PLAYER_RADIUS_KEY));
    const activate = player.contact.checkRecoveryTicksRemaining === 0 && holder.contact.immunityTicksRemaining === 0 &&
      impact.impactScore >= tuning.getNumber('ai.checkMinimumImpact') &&
      gap / Math.max(1e-9, closingSpeed) <= tuning.getNumber('contact.checkWindowTicks') / 60;
    // Contact is the destination of this action, so keep approaching through
    // the active window instead of applying a position-arrival braking curve.
    intent = { ...baseIntent, movement: normal, desiredFacing: normal,
      actionContext: 'defending', check: { held: activate, pressed: activate, released: false } };
  }
  if (diagnostics?.isLayerEnabled('ai')) diagnostics.publish({ layer: 'ai', source: 'actionController',
    entityId: `${playerId}-current-action`,
    primitive: { type: 'label', position: player.position, text: `${decision.kind}: ${decision.reason}` },
    data: { eventType: decision.selectedTick === state.tick ? 'AiActionChanged' : undefined,
      tick: state.tick, ...decision, intent, preparingForPlayerId: preparation?.playerId,
      charge: player.throwCharge, oneTouch: player.oneTouch } });
  return intent;
}
