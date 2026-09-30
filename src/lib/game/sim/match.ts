import type { TuningReader } from '../config/tuning';
import type { ArenaDefinition, ArenaEnd } from '../physics/arena';
import type { BallGoalApertureEvaluation } from '../physics/ballTrajectory';
import { constrainCircleToBounds, type Vec2 } from '../physics/geometry';
import { PLAYER_RADIUS_KEY } from '../config/tuning';
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
  phase: 'playing' | 'goal-stoppage';
  readonly score: Record<string, number>;
  readonly attackingTeams: Record<ArenaEnd, string>;
  readonly restartPlayers: readonly MatchRestartPlayer[];
  stoppageTicksRemaining: number;
  restartCount: number;
  transitionReason: string;
  lastGoal: GoalScored | undefined;
}

/** Restart setup is stable simulation data, never inferred from render objects. */
export function createMatchState(players: readonly PlayerState[], humanTeamId = 'human', opponentTeamId = 'opponent'): MatchState {
  return {
    phase: 'playing', score: { [humanTeamId]: 0, [opponentTeamId]: 0 },
    attackingTeams: { positiveY: humanTeamId, negativeY: opponentTeamId },
    restartPlayers: players.map(player => ({ playerId: player.definition.id, position: { ...player.position }, facing: { ...player.facing } })),
    stoppageTicksRemaining: 0, restartCount: 0, transitionReason: 'initial-play', lastGoal: undefined
  };
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

/** Non-playing steps still advance fixed ticks, but never execute gameplay input. */
export function advanceMatchStoppage(state: GameState, arena: ArenaDefinition, tuning: TuningReader): boolean {
  const match = state.match;
  if (!match || match.phase === 'playing') return false;
  match.stoppageTicksRemaining = Math.max(0, match.stoppageTicksRemaining - 1);
  if (match.stoppageTicksRemaining === 0) {
    resetMatchPositions(state, arena, tuning);
    match.phase = 'playing';
    match.transitionReason = 'goal-restart';
  }
  return true;
}

export function resolveGoal(state: GameState, crossing: BallGoalApertureEvaluation | undefined, fixedStepSeconds: number, tuning: TuningReader): GoalScored | undefined {
  const match = state.match;
  if (!match || match.phase !== 'playing' || !crossing?.crossed) return undefined;
  const teamId = match.attackingTeams[crossing.end];
  const event: GoalScored = { type: 'GoalScored', tick: state.tick + 1, teamId, end: crossing.end, crossing };
  match.score[teamId] += 1;
  match.lastGoal = event;
  match.phase = 'goal-stoppage';
  match.transitionReason = 'goal-scored';
  match.stoppageTicksRemaining = Math.max(1, Math.ceil(tuning.getNumber(MATCH_STOPPAGE_SECONDS_KEY) / fixedStepSeconds));
  clearMatchActions(state);
  // The scoring ball remains visible at its crossing throughout the stoppage.
  state.ball = createLooseBallState({ position: crossing.position, height: crossing.height });
  return event;
}

export function publishMatchDiagnostics(state: GameState, diagnostics?: DiagnosticSink): void {
  if (!state.match || !diagnostics?.isLayerEnabled(MATCH_DIAGNOSTIC_LAYER)) return;
  diagnostics.publish({
    layer: MATCH_DIAGNOSTIC_LAYER, source: 'match', entityId: 'match-state',
    primitive: { type: 'label', position: { x: 0, y: 0 }, text: state.match.phase },
    data: { tick: state.tick, ...state.match }
  });
}
