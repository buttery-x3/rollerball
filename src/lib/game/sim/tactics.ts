import type { Vec2 } from '../physics/geometry';
import type { GameState } from './gameState';

export type TeamTacticalContext = 'own-possession' | 'opponent-possession' | 'loose' | 'keeper-possession' | 'non-playing';
export type TacticalRole = 'carrier' | 'support' | 'width' | 'depth' | 'pressure' | 'goal-side' | 'lane-cover' | 'intercept';

export interface TacticalAssignment {
  readonly playerId: string;
  readonly teamId: string;
  readonly role: TacticalRole;
  readonly target: Vec2;
  readonly candidateId?: string;
  readonly score: number;
  readonly reason: string;
  readonly assignedTick: number;
  readonly targetPlannedTick: number;
  readonly nextThinkTick: number;
}

export interface TeamTacticalPlan {
  readonly teamId: string;
  readonly context: TeamTacticalContext;
  readonly assignments: readonly TacticalAssignment[];
  readonly plannedTick: number;
  readonly nextThinkTick: number;
  readonly reason: string;
}

/** Authoritative decision memory is replayed with the simulation, never held by AI. */
export interface TacticalState {
  readonly teams: readonly TeamTacticalPlan[];
  readonly lastPossessionKey: string;
  readonly lastBallVelocity: Vec2;
  readonly lastRestartCount: number;
}

export function createTacticalState(): TacticalState {
  return { teams: [], lastPossessionKey: '', lastBallVelocity: { x: 0, y: 0 }, lastRestartCount: -1 };
}

/** Explicit intent-production phase boundary: only decision memory is applied here. */
export function applyTacticalPlan(state: GameState, plan: TacticalState): void {
  state.tactics = plan;
}
