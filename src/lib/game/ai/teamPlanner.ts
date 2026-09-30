import { PLAYER_RADIUS_KEY, type TuningReader } from '../config/tuning';
import type { ArenaDefinition } from '../physics/arena';
import { constrainCircleToBounds, type Vec2 } from '../physics/geometry';
import type { DiagnosticSink } from '../sim/diagnostics';
import type { TacticalAssignment, TacticalRole, TacticalState, TeamTacticalContext, TeamTacticalPlan } from '../sim/tactics';
import { evaluateSpatialCandidates, type SpatialCandidate, type SpatialCandidateOptions } from './tacticalCandidates';
import { createWorldQueries, type ReadonlyGameState, type ReadonlyPlayerState, type WorldQueries } from './worldQueries';

interface RoleSlot {
  readonly role: TacticalRole;
  readonly anchor: Vec2;
  readonly purpose: NonNullable<SpatialCandidateOptions['purpose']>;
}

function compareIds(first: ReadonlyPlayerState, second: ReadonlyPlayerState): number {
  return first.definition.id < second.definition.id ? -1 : first.definition.id > second.definition.id ? 1 : 0;
}

function teamContext(state: ReadonlyGameState, teamId: string): TeamTacticalContext {
  if (state.match && state.match.phase !== 'playing') return 'non-playing';
  if (state.ball.mode === 'loose') return 'loose';
  const holderId = state.ball.holderId;
  const holder = state.players.find((player) => player.definition.id === holderId);
  if (holder?.definition.teamId !== teamId) return 'opponent-possession';
  return holder.definition.role === 'goalkeeper' ? 'keeper-possession' : 'own-possession';
}

function roleSlots(context: TeamTacticalContext, count: number, ball: Vec2, attackSign: number,
  tuning: TuningReader): RoleSlot[] {
  const width = tuning.getNumber('ai.supportWidth');
  const forward = tuning.getNumber('ai.supportForward');
  const depth = tuning.getNumber('ai.depthOffset');
  const side = ball.x > 0 ? -1 : 1;
  if (context === 'own-possession' || context === 'keeper-possession') {
    const slots: RoleSlot[] = [
      { role: 'support', purpose: 'support', anchor: { x: ball.x + side * width / 2, y: ball.y + attackSign * forward } },
      { role: 'width', purpose: 'support', anchor: { x: ball.x - side * width, y: ball.y + attackSign * forward / 2 } },
      { role: 'depth', purpose: 'support', anchor: { x: ball.x, y: ball.y + attackSign * depth * (context === 'keeper-possession' ? 1 : -1) } }
    ];
    if (count > 3) slots.push({ role: 'width', purpose: 'support',
      anchor: { x: ball.x + side * width, y: ball.y + attackSign * forward * 2 } });
    return slots.slice(0, count);
  }
  const coverDepth = tuning.getNumber('ai.defenseDepth');
  const coverWidth = tuning.getNumber('ai.laneCoverWidth');
  return [
    { role: 'goal-side' as const, purpose: 'defense' as const, anchor: { x: ball.x, y: ball.y - attackSign * coverDepth } },
    { role: 'lane-cover' as const, purpose: 'defense' as const, anchor: { x: ball.x - coverWidth, y: ball.y - attackSign * coverDepth / 2 } },
    { role: 'lane-cover' as const, purpose: 'defense' as const, anchor: { x: ball.x + coverWidth, y: ball.y - attackSign * coverDepth / 2 } }
  ].slice(0, count);
}

function choosePlayer(players: readonly ReadonlyPlayerState[], slot: RoleSlot, previous: TeamTacticalPlan | undefined,
  world: WorldQueries, tuning: TuningReader, tick: number, diagnostics?: DiagnosticSink): ReadonlyPlayerState {
  const ranked = players.map((player) => {
    const reachSeconds = world.reachSeconds(player.definition.id, slot.anchor);
    const goalSideBonus = slot.role === 'pressure' && world.goalSide(player.position, player.definition.teamId)
      ? tuning.getNumber('ai.roleGoalSideBonus') : 0;
    return { player, reachSeconds, goalSideBonus, cost: reachSeconds - goalSideBonus };
  })
    .sort((a, b) => a.cost - b.cost || compareIds(a.player, b.player));
  const best = ranked[0];
  const prior = ranked.filter(({ player }) => previous?.assignments.some((assignment) =>
    assignment.playerId === player.definition.id && assignment.role === slot.role))
    .sort((a, b) => a.cost - b.cost || compareIds(a.player, b.player))[0];
  const retained = !!prior && prior.cost - best.cost <= tuning.getNumber('ai.roleHysteresisMargin');
  const selected = retained ? prior! : best;
  if (diagnostics?.isLayerEnabled('ai')) diagnostics.publish({ layer: 'ai', source: 'teamRoleSelection',
    entityId: `${selected.player.definition.id}-${slot.role}-selection`,
    primitive: { type: 'label', position: selected.player.position, text: `${slot.role}: ${retained ? 'retained' : 'best reach'}` },
    data: { tick, playerId: selected.player.definition.id, teamId: selected.player.definition.teamId,
      role: slot.role, anchor: slot.anchor, retained, previousPlayerId: prior?.player.definition.id,
      hysteresisMargin: tuning.getNumber('ai.roleHysteresisMargin'),
      candidates: ranked.map(({ player, reachSeconds, goalSideBonus, cost }) => ({
        playerId: player.definition.id, reachSeconds: Number.isFinite(reachSeconds) ? reachSeconds : undefined,
        goalSideBonus, cost: Number.isFinite(cost) ? cost : undefined, selected: player === selected.player })) } });
  return selected.player;
}

function targetCandidates(anchor: Vec2, tuning: TuningReader): SpatialCandidate[] {
  const radius = tuning.getNumber('ai.targetSearchRadius');
  const spacing = tuning.getNumber('ai.candidateSpacing');
  const count = Math.floor(radius / spacing);
  const candidates: SpatialCandidate[] = [];
  for (let x = -count; x <= count; x += 1) {
    for (let y = -count; y <= count; y += 1) {
      candidates.push({ id: `assigned:${x}:${y}`, position: { x: anchor.x + x * spacing, y: anchor.y + y * spacing } });
    }
  }
  return candidates;
}

function publishPlans(state: ReadonlyGameState, plans: readonly TeamTacticalPlan[], diagnostics?: DiagnosticSink): void {
  if (!diagnostics?.isLayerEnabled('ai')) return;
  for (const plan of plans) {
    const first = state.players.find((player) => player.definition.teamId === plan.teamId);
    if (!first) continue;
    diagnostics.publish({ layer: 'ai', source: 'teamPlanner', entityId: 'ai-team-plan',
      primitive: { type: 'label', position: first.position, text: `${plan.teamId}: ${plan.context}` },
      data: { tick: state.tick, ...plan } });
    for (const assignment of plan.assignments) {
      const player = state.players.find((entry) => entry.definition.id === assignment.playerId);
      if (!player) continue;
      diagnostics.publish({ layer: 'ai', source: 'teamPlanner', entityId: `${assignment.playerId}-current-role`,
        primitive: { type: 'line', start: player.position, end: assignment.target, color: '#f6c177' },
        data: { tick: state.tick, context: plan.context, teamPlannedTick: plan.plannedTick,
          teamNextThinkTick: plan.nextThinkTick, ...assignment } });
    }
  }
}

/** Pure team/individual planning. Runtime applies returned decision memory through simulation. */
export function planTeams(state: ReadonlyGameState, tuning: TuningReader, arena: ArenaDefinition,
  diagnostics?: DiagnosticSink): TacticalState | undefined {
  const memory = state.tactics;
  if (!memory) return undefined;
  const possessionKey = state.ball.mode === 'possessed' ? `held:${state.ball.holderId}` : 'loose';
  const velocity = state.ball.mode === 'loose' ? state.ball.velocity : { x: 0, y: 0 };
  const restartCount = state.match?.restartCount ?? 0;
  const possessionEvent = memory.lastPossessionKey !== possessionKey;
  const restartEvent = memory.lastRestartCount !== restartCount;
  const velocityEvent = Math.hypot(velocity.x - memory.lastBallVelocity.x,
    velocity.y - memory.lastBallVelocity.y) >= tuning.getNumber('ai.ballVelocityReplanThreshold');
  const eventReason = restartEvent ? 'restart' : possessionEvent ? 'possession-transition' : velocityEvent ? 'ball-trajectory-change' : undefined;
  const teams = [...new Set(state.players.map((player) => player.definition.teamId))].sort();
  const world = createWorldQueries(state, arena, tuning);
  const ball = world.ballPosition();
  let changed = false;
  const plans = teams.map((teamId): TeamTacticalPlan => {
    const prior = memory.teams.find((team) => team.teamId === teamId);
    const context = teamContext(state, teamId);
    const teamDue = !prior || !!eventReason || prior.context !== context || state.tick >= prior.nextThinkTick;
    const targetDue = prior?.assignments.some((assignment) => state.tick >= assignment.nextThinkTick) ?? true;
    if (!teamDue && !targetDue) return prior!;
    changed = true;
    const fields = world.teamPlayers(teamId).filter((player) => player.definition.role === 'field')
      .sort(compareIds);
    const attackSign = world.goal(teamId).end === 'positiveY' ? 1 : -1;
    const choices: { player: ReadonlyPlayerState; slot: RoleSlot }[] = [];
    let available = [...fields];
    const add = (player: ReadonlyPlayerState, slot: RoleSlot) => {
      choices.push({ player, slot });
      available = available.filter((other) => other.definition.id !== player.definition.id);
    };
    if (!teamDue && prior) {
      for (const assignment of prior.assignments) {
        const player = available.find((entry) => entry.definition.id === assignment.playerId);
        if (player) add(player, { role: assignment.role, anchor: assignment.target,
          purpose: assignment.role === 'carrier' ? 'hold' : ['support', 'width', 'depth'].includes(assignment.role)
            ? 'support' : assignment.role === 'pressure' ? 'pressure' : assignment.role === 'intercept' ? 'intercept' : 'defense' });
      }
    } else if (context === 'non-playing') {
      for (const player of fields) add(player, { role: 'depth', anchor: player.position, purpose: 'hold' });
    } else {
      const holderId = state.ball.mode === 'possessed' ? state.ball.holderId : undefined;
      const carrier = available.find((player) => player.definition.id === holderId);
      if (carrier) add(carrier, { role: 'carrier', anchor: carrier.position, purpose: 'hold' });
      if (available.length && (context === 'opponent-possession' || context === 'loose')) {
        const role = context === 'loose' ? 'intercept' : 'pressure';
        let anchor = { x: ball.x, y: ball.y - (role === 'pressure' ? attackSign * 2 * tuning.getNumber(PLAYER_RADIUS_KEY) : 0) };
        let player: ReadonlyPlayerState;
        if (role === 'intercept') {
          const opportunities = world.receivers().filter((entry) => entry.teamId === teamId);
          const earliest = opportunities[0];
          const previousIntercept = opportunities.find((entry) => prior?.assignments.some((assignment) =>
            assignment.playerId === entry.playerId && assignment.role === 'intercept'));
          const chosen = previousIntercept && earliest && previousIntercept.timeSeconds - earliest.timeSeconds <= tuning.getNumber('ai.roleHysteresisMargin')
            ? previousIntercept : earliest;
          if (chosen) anchor = { ...chosen.position };
          player = available.find((entry) => entry.definition.id === chosen?.playerId) ??
            choosePlayer(available, { role, anchor, purpose: role }, prior, world, tuning, state.tick, diagnostics);
        } else player = choosePlayer(available, { role, anchor, purpose: role }, prior, world, tuning, state.tick, diagnostics);
        add(player, { role, anchor, purpose: role });
      }
      for (const slot of roleSlots(context, available.length, ball, attackSign, tuning)) {
        if (available.length) add(choosePlayer(available, slot, prior, world, tuning, state.tick, diagnostics), slot);
      }
    }
    const reserved: Vec2[] = [];
    const assignments = choices.map(({ player, slot }): TacticalAssignment => {
      const previous = prior?.assignments.find((assignment) => assignment.playerId === player.definition.id);
      const sameRole = previous?.role === slot.role;
      if (previous && sameRole && !eventReason && prior?.context === context && state.tick < previous.nextThinkTick) {
        reserved.push(previous.target);
        return previous;
      }
      const anchor = constrainCircleToBounds(slot.anchor, tuning.getNumber(PLAYER_RADIUS_KEY),
        world.movementBounds(player.definition.id)).position;
      const evaluation = evaluateSpatialCandidates(state, player.definition.id, {
        purpose: slot.purpose, anchor, candidates: slot.purpose === 'hold'
          ? [{ id: 'hold', position: anchor }] : targetCandidates(anchor, tuning),
        previousTarget: sameRole && !eventReason ? previous?.target : undefined,
        reservedPositions: reserved
      }, arena, tuning, diagnostics);
      const target = evaluation.selected?.position ?? constrainCircleToBounds(player.position,
        tuning.getNumber(PLAYER_RADIUS_KEY), world.movementBounds(player.definition.id)).position;
      const score = evaluation.candidates.find((candidate) => candidate.id === evaluation.selected?.id)?.score ?? 0;
      reserved.push(target);
      return { playerId: player.definition.id, teamId, role: slot.role, target: { ...target },
        candidateId: evaluation.selected?.id, score,
        reason: `${eventReason ?? (sameRole ? 'scheduled-target-update' : 'role-change')}: ${evaluation.reason}`,
        assignedTick: sameRole ? previous!.assignedTick : state.tick,
        targetPlannedTick: state.tick, nextThinkTick: state.tick + tuning.getNumber('ai.playerThinkTicks') };
    });
    return { teamId, context, assignments,
      plannedTick: teamDue ? state.tick : prior!.plannedTick,
      nextThinkTick: teamDue ? state.tick + tuning.getNumber('ai.teamThinkTicks') : prior!.nextThinkTick,
      reason: eventReason ?? (teamDue ? 'scheduled-team-update' : 'scheduled-player-update') };
  });
  publishPlans(state, plans, diagnostics);
  if (!changed) return undefined;
  return { teams: plans, lastPossessionKey: possessionKey, lastBallVelocity: { ...velocity }, lastRestartCount: restartCount };
}
