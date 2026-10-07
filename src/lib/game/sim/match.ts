import type { TuningReader } from '../config/tuning';
import type { ArenaDefinition, ArenaEnd } from '../physics/arena';
import type { BallGoalApertureEvaluation } from '../physics/ballTrajectory';
import { constrainCircleToBounds, type Vec2 } from '../physics/geometry';
import { DEFAULT_MATCH_DURATION_SECONDS, MATCH_DURATION_SECONDS_KEY, PLAYER_RADIUS_KEY } from '../config/tuning';
import type { MatchAction } from '../control/types';
import { createEmptyContactState, createEmptyGoalkeeperState, createEmptyOneTouchState, createEmptyThrowChargeState, createLooseBallState, type GameState, type PlayerState } from './gameState';
import { getPlayerMovementBounds } from './goalkeeping';
import { MATCH_DIAGNOSTIC_LAYER, type DiagnosticSink } from './diagnostics';
import { createTacticalState } from './tactics';
import { createAiActionState } from './actionState';

export const MATCH_STOPPAGE_SECONDS_KEY = 'match.goalStoppageSeconds';

export interface MatchRestartPlayer {
  readonly playerId: string;
  readonly position: Vec2;
  readonly facing: Vec2;
}

export interface GoalScored {
  readonly type: 'GoalScored';
  readonly tick: number;
  readonly teamId: string;
  readonly end: ArenaEnd;
  readonly crossing: BallGoalApertureEvaluation;
}

export interface MatchState {
  phase: MatchPhase;
  readonly score: Record<string, number>;
  readonly attackingTeams: Record<ArenaEnd, string>;
  readonly restartPlayers: readonly MatchRestartPlayer[];
  stoppageTicksRemaining: number;
  restartCount: number;
  transitionReason: string;
  lastGoal: GoalScored | undefined;
  activeTicks: number;
  durationTicks: number;
  fixedStepSeconds: number;
  runRevision: number;
  lastTransition: MatchTransition | undefined;
}

export type MatchPhase = 'ready' | 'playing' | 'goal-stoppage' | 'full-time';

export interface MatchTransition {
  readonly type: 'MatchTransition';
  readonly tick: number;
  readonly from: MatchPhase;
  readonly to: MatchPhase;
  readonly reason: string;
  readonly activeTicks: number;
  readonly durationTicks: number;
  readonly remainingSeconds: number;
  readonly runRevision: number;
  readonly score: Readonly<Record<string, number>>;
}

/** Restart setup is stable simulation data, never inferred from render objects. */
export function createMatchState(players: readonly PlayerState[], humanTeamId = 'human', opponentTeamId = 'opponent',
  initialPhase: 'ready' | 'playing' = 'playing'): MatchState {
  return {
    phase: initialPhase, score: { [humanTeamId]: 0, [opponentTeamId]: 0 },
    attackingTeams: { positiveY: humanTeamId, negativeY: opponentTeamId },
    restartPlayers: players.map(player => ({ playerId: player.definition.id, position: { ...player.position }, facing: { ...player.facing } })),
    stoppageTicksRemaining: 0, restartCount: 0, transitionReason: initialPhase === 'ready' ? 'awaiting-start' : 'initial-play', lastGoal: undefined,
    activeTicks: 0, durationTicks: DEFAULT_MATCH_DURATION_SECONDS * 60, fixedStepSeconds: 1 / 60,
    runRevision: 0, lastTransition: undefined
  };
}

export function matchTimeRemaining(match: Pick<MatchState, 'activeTicks' | 'durationTicks' | 'fixedStepSeconds'>): number {
  return Math.max(0, match.durationTicks - match.activeTicks) * match.fixedStepSeconds;
}

function transition(state: GameState, to: MatchPhase, reason: string, diagnostics?: DiagnosticSink): void {
  const match = state.match!;
  const event: MatchTransition = { type: 'MatchTransition', tick: state.tick + 1, from: match.phase, to, reason,
    activeTicks: match.activeTicks, durationTicks: match.durationTicks, remainingSeconds: matchTimeRemaining(match),
    runRevision: match.runRevision, score: { ...match.score } };
  match.phase = to;
  match.transitionReason = reason;
  match.lastTransition = event;
  if (diagnostics?.isLayerEnabled(MATCH_DIAGNOSTIC_LAYER)) diagnostics.publish({
    layer: MATCH_DIAGNOSTIC_LAYER, source: 'match', entityId: 'match-transition',
    primitive: { type: 'label', position: { x: 0, y: 0 }, text: `${event.from} → ${to}: ${reason}` },
    data: { eventType: 'MatchTransition', ...event }
  });
}

function fullTime(state: GameState, diagnostics?: DiagnosticSink): void {
  const match = state.match!;
  match.stoppageTicksRemaining = 0;
  clearMatchActions(state);
  if (state.ball.mode === 'loose') {
    state.ball.velocity = { x: 0, y: 0 };
    state.ball.verticalVelocity = 0;
  }
  transition(state, 'full-time', 'clock-expired', diagnostics);
}

export function clearMatchActions(state: GameState): void {
  if (state.tactics) state.tactics = createTacticalState();
  if (state.aiActions) state.aiActions = createAiActionState();
  for (const player of state.players) {
    player.throwCharge = createEmptyThrowChargeState();
    player.oneTouch = createEmptyOneTouchState();
    player.contact = createEmptyContactState();
    if (player.goalkeeper) player.goalkeeper = createEmptyGoalkeeperState();
    player.velocity = { x: 0, y: 0 };
  }
  if (state.ball.mode === 'loose') state.ball.release = undefined;
}

export function resetMatchPositions(state: GameState, arena: ArenaDefinition, tuning: TuningReader): void {
  const match = state.match;
  if (!match) return;
  clearMatchActions(state);
  for (const spawn of match.restartPlayers) {
    const player = state.players.find(candidate => candidate.definition.id === spawn.playerId);
    if (!player) continue;
    player.position = constrainCircleToBounds(spawn.position, tuning.getNumber(PLAYER_RADIUS_KEY), getPlayerMovementBounds(player, arena)).position;
    player.facing = { ...spawn.facing };
  }
  state.ball = createLooseBallState({ position: arena.restartSpawns.center });
  match.restartCount += 1;
}

/** Match commands/non-playing steps consume a global tick without gameplay. */
export function advanceMatchFlow(state: GameState, arena: ArenaDefinition, tuning: TuningReader,
  fixedStepSeconds: number, action?: MatchAction, diagnostics?: DiagnosticSink): boolean {
  const match = state.match;
  if (!match) return false;
  if (match.phase !== 'full-time' || action === 'rematch') {
    match.fixedStepSeconds = fixedStepSeconds;
    match.durationTicks = Math.max(1, Math.ceil(tuning.getNumber(MATCH_DURATION_SECONDS_KEY) / fixedStepSeconds - 1e-9));
  }
  if (action === 'rematch' && match.phase === 'full-time') {
    for (const teamId of Object.keys(match.score)) match.score[teamId] = 0;
    match.activeTicks = 0;
    match.lastGoal = undefined;
    match.stoppageTicksRemaining = 0;
    match.runRevision += 1;
    resetMatchPositions(state, arena, tuning);
    transition(state, 'ready', 'rematch-reset', diagnostics);
    return true;
  }
  if (action === 'start' && match.phase === 'ready') {
    resetMatchPositions(state, arena, tuning);
    transition(state, 'playing', 'match-started', diagnostics);
    return true;
  }
  if (match.phase === 'ready' || match.phase === 'full-time') return true;
  if (match.phase === 'playing') {
    if (match.activeTicks >= match.durationTicks) {
      fullTime(state, diagnostics);
      return true;
    }
    return false;
  }
  match.stoppageTicksRemaining = Math.max(0, match.stoppageTicksRemaining - 1);
  if (match.stoppageTicksRemaining === 0) {
    resetMatchPositions(state, arena, tuning);
    transition(state, 'playing', 'goal-restart', diagnostics);
  }
  return true;
}

export function resolveGoal(state: GameState, crossing: BallGoalApertureEvaluation | undefined, fixedStepSeconds: number,
  tuning: TuningReader, diagnostics?: DiagnosticSink): GoalScored | undefined {
  const match = state.match;
  if (!match || match.phase !== 'playing' || !crossing?.crossed) return undefined;
  const teamId = match.attackingTeams[crossing.end];
  const event: GoalScored = { type: 'GoalScored', tick: state.tick + 1, teamId, end: crossing.end, crossing };
  match.score[teamId] += 1;
  match.lastGoal = event;
  match.stoppageTicksRemaining = Math.max(1, Math.ceil(tuning.getNumber(MATCH_STOPPAGE_SECONDS_KEY) / fixedStepSeconds));
  clearMatchActions(state);
  // The scoring ball remains visible at its crossing throughout the stoppage.
  state.ball = createLooseBallState({ position: crossing.position, height: crossing.height });
  transition(state, 'goal-stoppage', 'goal-scored', diagnostics);
  return event;
}

/** Rules phase: the last active step can score before the clock closes play. */
export function finishMatchPlayingTick(state: GameState, crossing: BallGoalApertureEvaluation | undefined,
  fixedStepSeconds: number, tuning: TuningReader, diagnostics?: DiagnosticSink): void {
  const match = state.match;
  if (!match || match.phase !== 'playing') return;
  match.activeTicks = Math.min(match.durationTicks, match.activeTicks + 1);
  resolveGoal(state, crossing, fixedStepSeconds, tuning, diagnostics);
  if (match.activeTicks >= match.durationTicks) fullTime(state, diagnostics);
}

export function publishMatchDiagnostics(state: GameState, diagnostics?: DiagnosticSink): void {
  if (!state.match || !diagnostics?.isLayerEnabled(MATCH_DIAGNOSTIC_LAYER)) return;
  diagnostics.publish({
    layer: MATCH_DIAGNOSTIC_LAYER, source: 'match', entityId: 'match-state',
    primitive: { type: 'label', position: { x: 0, y: 0 }, text: state.match.phase },
    data: { tick: state.tick, ...state.match, remainingSeconds: matchTimeRemaining(state.match) }
  });
}
