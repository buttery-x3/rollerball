import type { Vec2 } from '../physics/geometry';
import type { GameState } from './gameState';

export type AiActionKind = 'hold' | 'advance' | 'pass-low' | 'pass-high' | 'shot-low' | 'shot-high' |
  'receive' | 'one-touch-low' | 'one-touch-high' | 'check';

export interface AiActionDecision {
  readonly playerId: string;
  readonly kind: AiActionKind;
  readonly candidateId: string;
  readonly target: Vec2;
  /** Predicted swept receive contact used to aim a prepared redirect. */
  readonly origin?: Vec2;
  readonly receiverId?: string;
  readonly strength: number;
  readonly score: number;
  readonly selectedTick: number;
  readonly plannedTick: number;
  readonly nextThinkTick: number;
  readonly reason: string;
}

/** Decision memory only; normal simulation action state owns charge and recovery. */
export interface AiActionState {
  readonly decisions: readonly AiActionDecision[];
  readonly lastPossessionKey: string;
  readonly lastBallVelocity: Vec2;
  readonly lastRestartCount: number;
}

export function createAiActionState(): AiActionState {
  return { decisions: [], lastPossessionKey: '', lastBallVelocity: { x: 0, y: 0 }, lastRestartCount: -1 };
}

export function applyAiActionPlan(state: GameState, plan: AiActionState): void {
  state.aiActions = plan;
}
