import type { Vec2 } from '../physics/geometry';

export type PlayerId = string;

export interface InputButtonSnapshot {
  readonly low: boolean;
  readonly high: boolean;
  readonly switch: boolean;
}

/**
 * A device-neutral, already-normalized sample from the human control boundary.
 * Browser-specific button indices and key codes must never cross this boundary.
 */
export interface InputSnapshot {
  readonly movement: Vec2;
  readonly rightStick: Vec2;
  readonly buttons: InputButtonSnapshot;
}

export interface ButtonState {
  readonly held: boolean;
  readonly pressed: boolean;
  readonly released: boolean;
}

export interface RightStickThrowPulse {
  readonly direction: Vec2;
  readonly magnitude: number;
}

export type ControlActionContext = 'neutral' | 'possessed' | 'defending' | 'receiving';

export interface ReceiveIntent {
  readonly low: ButtonState;
  readonly high: ButtonState;
  readonly rightStickThrow: RightStickThrowPulse | undefined;
}

/**
 * The gameplay-facing action contract shared by human and AI control.
 * Switching is deliberately absent; it belongs to the control router.
 */
export interface PlayerIntent {
  readonly movement: Vec2;
  readonly desiredFacing: Vec2 | undefined;
  readonly actionContext: ControlActionContext;
  readonly lowThrow: ButtonState;
  readonly highThrow: ButtonState;
  readonly check: ButtonState;
  readonly rightStickThrow: RightStickThrowPulse | undefined;
  readonly receive: ReceiveIntent;
  /** Explicit keeper commitment; physical rules are independent of controller. */
  readonly save?: ButtonState;
}

export type ControlAssignmentReason =
  | 'initial'
  | 'manual'
  | 'possession'
  | 'receiver'
  | 'defensive'
  | 'reset';

export interface ControlAssignment {
  readonly playerId: PlayerId;
  readonly reason: ControlAssignmentReason;
}

export type RightStickCapturePhase = 'neutral' | 'capturing' | 'awaitingNeutral';

export interface RightStickCaptureState {
  readonly phase: RightStickCapturePhase;
  readonly ticksCaptured: number;
  readonly ticksRemaining: number;
  readonly peakMagnitude: number;
  readonly direction: Vec2;
}

export interface ProcessedInputSnapshot {
  readonly movement: Vec2;
  readonly rightStick: Vec2;
  readonly buttons: {
    readonly low: ButtonState;
    readonly high: ButtonState;
    readonly switch: ButtonState;
  };
}

export interface RoutedPlayerIntent {
  readonly playerId: PlayerId;
  readonly intent: PlayerIntent;
}

export type MatchAction = 'start' | 'rematch';

/** Match commands are external simulation input, separate from player actions. */
export interface MatchInput {
  readonly playerIntents?: readonly RoutedPlayerIntent[];
  readonly matchAction?: MatchAction;
}

export type SimulationInput = RoutedPlayerIntent | readonly RoutedPlayerIntent[] | MatchInput;

export function matchAction(input: SimulationInput | undefined): MatchAction | undefined {
  return input && !Array.isArray(input) && 'matchAction' in input ? input.matchAction : undefined;
}

export function routedInputs(input: SimulationInput | undefined): readonly RoutedPlayerIntent[] {
  if (input === undefined) return [];
  if (Array.isArray(input)) return input;
  return 'playerId' in input ? [input] : (input as MatchInput).playerIntents ?? [];
}

export interface ControlStepResult {
  readonly input: ProcessedInputSnapshot;
  readonly assignment: ControlAssignment | undefined;
  readonly routedIntent: RoutedPlayerIntent | undefined;
  readonly capture: RightStickCaptureState;
  readonly routing?: ControlRoutingDecision;
}

export interface ReceiverClaim {
  readonly playerId: PlayerId;
  readonly position: Vec2;
  readonly timeSeconds: number;
  readonly score: number;
  readonly createdTick: number;
}

export interface ReceiverRoutingCandidate {
  readonly playerId: PlayerId;
  readonly teamId: string;
  readonly position: Vec2;
  readonly timeSeconds: number;
  readonly arrivalSeconds: number;
  readonly score: number;
  readonly difficulty: number;
  readonly capacity: number;
  readonly contested: boolean;
}

export interface DefensiveRoutingCandidate {
  readonly playerId: PlayerId;
  readonly position: Vec2;
  readonly reachSeconds: number;
  readonly goalSide: boolean;
  readonly pressureScore: number;
  readonly goalSideScore: number;
  readonly score: number;
}

export interface ControlRoutingDecision {
  readonly tick: number;
  readonly reason: string;
  readonly holderId?: PlayerId;
  readonly previousPlayerId?: PlayerId;
  readonly receiverClaim?: ReceiverClaim;
  readonly receiverCandidates: readonly ReceiverRoutingCandidate[];
  readonly defensiveCandidates: readonly DefensiveRoutingCandidate[];
}
