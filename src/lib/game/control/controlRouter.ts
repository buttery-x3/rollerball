import type { TuningReader } from '../config/tuning';
import type { ArenaDefinition } from '../physics/arena';
import type { GameState, PlayerState } from '../sim/gameState';
import type { DiagnosticSink } from '../sim/diagnostics';
import { estimateReachSeconds, receiveOpportunities } from '../sim/ballQueries';
import { cloneVector, vectorMagnitude } from './inputNormalization';
import { createInputProcessor } from './inputProcessor';
import type {
  ButtonState,
  ControlActionContext,
  ControlAssignment,
  ControlAssignmentReason,
  ControlStepResult,
  ControlRoutingDecision,
  DefensiveRoutingCandidate,
  InputSnapshot,
  PlayerId,
  PlayerIntent,
  ReceiveIntent,
  ReceiverClaim,
  ReceiverRoutingCandidate,
  RightStickThrowPulse,
  RoutedPlayerIntent
} from './types';

const EPSILON = 1e-9;
const EMPTY_BUTTON_STATE: ButtonState = {
  held: false,
  pressed: false,
  released: false
};

function assertPlayerId(playerId: PlayerId): void {
  if (!playerId.trim()) {
    throw new RangeError('A controlled player ID must have a non-empty value.');
  }
}

function cloneButtonState(state: ButtonState): ButtonState {
  return {
    held: state.held,
    pressed: state.pressed,
    released: state.released
  };
}

function emptyReceiveIntent(): ReceiveIntent {
  return {
    low: EMPTY_BUTTON_STATE,
    high: EMPTY_BUTTON_STATE,
    rightStickThrow: undefined
  };
}

export interface ControlRouterOptions {
  readonly tuning: TuningReader;
  readonly initialPlayerId?: PlayerId;
  readonly humanTeamId?: string;
}

export interface ControlRoutingWorld {
  readonly state: GameState;
  readonly arena: ArenaDefinition;
  readonly diagnostics?: DiagnosticSink;
}

export interface ControlRouter {
  readonly assignment: ControlAssignment | undefined;
  readonly receiverClaim: ReceiverClaim | undefined;
  consumeTick(
    snapshot: InputSnapshot,
    actionContext?: ControlActionContext,
    world?: ControlRoutingWorld
  ): ControlStepResult;
  assignPlayer(playerId: PlayerId, reason?: ControlAssignmentReason): void;
  clearAssignment(): void;
  resetInput(): void;
  reset(): void;
}

function compareIds(first: string, second: string): number {
  return first < second ? -1 : first > second ? 1 : 0;
}

function defensiveCandidates(
  world: ControlRoutingWorld,
  fieldPlayers: readonly PlayerState[],
  humanTeamId: string,
  tuning: TuningReader
): readonly DefensiveRoutingCandidate[] {
  const ball = world.state.ball;
  const ballPosition = ball.mode === 'loose' ? ball.position
    : world.state.players.find((player) => player.definition.id === ball.holderId)?.position ?? { x: 0, y: 0 };
  const ownKeeper = world.state.players.find((player) =>
    player.definition.teamId === humanTeamId && player.definition.role === 'goalkeeper');
  const defendingEnd = ownKeeper?.definition.defendingEnd ??
    (world.state.match?.attackingTeams.negativeY === humanTeamId ? 'positiveY' : 'negativeY');
  const ownGoal = world.arena.goals.find((goal) => goal.end === defendingEnd)!;
  return fieldPlayers.map((player) => {
    const reachSeconds = estimateReachSeconds(player, ballPosition, tuning, world.arena,
      tuning.getNumber('player.radius') * 2);
    const goalSide = (player.position.y - ballPosition.y) * (ownGoal.planeY - ballPosition.y) >= 0;
    const pressureScore = Number.isFinite(reachSeconds)
      ? tuning.getNumber('controls.defensiveReachWeight') / (1 + reachSeconds) : 0;
    const goalSideScore = goalSide ? tuning.getNumber('controls.defensiveGoalSideWeight') : 0;
    return { playerId: player.definition.id, position: { ...player.position }, reachSeconds,
      goalSide, pressureScore, goalSideScore, score: pressureScore + goalSideScore };
  }).sort((first, second) => second.score - first.score || compareIds(first.playerId, second.playerId));
}

function receiverCandidates(world: ControlRoutingWorld, humanTeamId: string, tuning: TuningReader): readonly ReceiverRoutingCandidate[] {
  const lead = tuning.getNumber('controls.receiverClaimLeadSeconds');
  return receiveOpportunities(world.state, tuning, world.arena)
    .filter((opportunity) => opportunity.teamId === humanTeamId)
    .map((opportunity) => ({
      playerId: opportunity.playerId,
      teamId: opportunity.teamId,
      position: { ...opportunity.position },
      timeSeconds: opportunity.timeSeconds,
      arrivalSeconds: opportunity.arrivalSeconds,
      difficulty: opportunity.difficulty.total,
      capacity: opportunity.difficulty.capacity,
      score: opportunity.timeSeconds + tuning.getNumber('controls.receiverDifficultyWeight') *
        opportunity.difficulty.total / Math.max(EPSILON, opportunity.difficulty.capacity),
      contested: opportunity.opponentArrivalSeconds !== undefined &&
        opportunity.opponentArrivalSeconds <= opportunity.timeSeconds + lead
    })).sort((first, second) => first.score - second.score || compareIds(first.playerId, second.playerId));
}

function createIntent(
  processed: ControlStepResult['input'],
  rightStickThrow: RightStickThrowPulse | undefined,
  actionContext: ControlActionContext
): PlayerIntent {
  const movement = cloneVector(processed.movement);
  const movementLength = vectorMagnitude(movement);
  const desiredFacing =
    movementLength > EPSILON
      ? { x: movement.x / movementLength, y: movement.y / movementLength }
      : undefined;

  const check =
    actionContext === 'neutral' || actionContext === 'defending'
      ? cloneButtonState(processed.buttons.low)
      : EMPTY_BUTTON_STATE;

  const receive =
    actionContext === 'receiving'
      ? {
          low: cloneButtonState(processed.buttons.low),
          high: cloneButtonState(processed.buttons.high),
          rightStickThrow: rightStickThrow
            ? {
                direction: cloneVector(rightStickThrow.direction),
                magnitude: rightStickThrow.magnitude
              }
            : undefined
        }
      : emptyReceiveIntent();

  return {
    movement,
    desiredFacing,
    actionContext,
    lowThrow:
      actionContext === 'possessed'
        ? cloneButtonState(processed.buttons.low)
        : EMPTY_BUTTON_STATE,
    highThrow:
      actionContext === 'possessed'
        ? cloneButtonState(processed.buttons.high)
        : EMPTY_BUTTON_STATE,
    check,
    rightStickThrow: actionContext === 'possessed' && rightStickThrow
      ? {
          direction: cloneVector(rightStickThrow.direction),
          magnitude: rightStickThrow.magnitude
        }
      : undefined,
    receive
  };
}

export function createControlRouter(options: ControlRouterOptions): ControlRouter {
  if (options.initialPlayerId !== undefined) {
    assertPlayerId(options.initialPlayerId);
  }

  const inputProcessor = createInputProcessor(options.tuning);
  const initialPlayerId = options.initialPlayerId;
  const humanTeamId = options.humanTeamId ?? 'human';
  let currentAssignment: ControlAssignment | undefined = initialPlayerId
    ? { playerId: initialPlayerId, reason: 'initial' }
    : undefined;
  let currentClaim: ReceiverClaim | undefined;
  let previousPossessionKey: string | undefined;
  let manualSelection = false;

  const resetRouting = (): void => {
    currentClaim = undefined;
    previousPossessionKey = undefined;
    manualSelection = false;
  };

  const assign = (playerId: PlayerId, reason: ControlAssignmentReason): void => {
    if (currentAssignment?.playerId !== playerId || currentAssignment.reason !== reason) {
      currentAssignment = { playerId, reason };
    }
  };

  const routeWorld = (world: ControlRoutingWorld, manualSwitch: boolean): ControlRoutingDecision => {
    const { state } = world;
    const previousPlayerId = currentAssignment?.playerId;
    const fields = state.players.filter((player) => player.definition.teamId === humanTeamId && player.definition.role === 'field');
    const ball = state.ball;
    const holder = ball.mode === 'possessed'
      ? state.players.find((player) => player.definition.id === ball.holderId) : undefined;
    const possessionKey = holder ? `${holder.definition.teamId}:${holder.definition.id}` : 'loose';
    const transition = possessionKey !== previousPossessionKey;
    if (transition) manualSelection = false;
    previousPossessionKey = possessionKey;
    const defensive = defensiveCandidates(world, fields, humanTeamId, options.tuning);
    let candidates: readonly ReceiverRoutingCandidate[] = [];
    let reason = 'retain-current-player';

    if (holder?.definition.teamId === humanTeamId) {
      currentClaim = undefined;
      assign(holder.definition.id, 'possession');
      reason = holder.definition.role === 'goalkeeper' ? 'keeper-possession' : 'own-possession';
    } else {
      if (holder) {
        currentClaim = undefined;
        if (transition && defensive[0]) {
          assign(defensive[0].playerId, 'defensive');
          reason = 'opponent-possession-transition';
        }
      }
      if (manualSwitch && fields.length > 0) {
        const index = defensive.findIndex((candidate) => candidate.playerId === currentAssignment?.playerId);
        const next = defensive[(index + 1) % defensive.length];
        assign(next.playerId, 'manual');
        manualSelection = true;
        currentClaim = undefined;
        reason = 'manual-field-switch';
      } else if (ball.mode === 'loose' && !manualSelection) {
        // A stationary, unclaimed ball is a chase, rather than an incoming pass.
        const moving = Math.hypot(ball.velocity.x, ball.velocity.y) > EPSILON || Math.abs(ball.verticalVelocity) > EPSILON;
        candidates = moving ? receiverCandidates(world, humanTeamId, options.tuning) : [];
        const eligible = candidates.filter((candidate) => !candidate.contested &&
          candidate.timeSeconds <= options.tuning.getNumber('controls.receiverMaxArrivalSeconds'));
        const retained = eligible.find((candidate) => candidate.playerId === currentClaim?.playerId);
        const best = eligible[0];
        const lead = eligible[1] ? eligible[1].score - best.score : Infinity;
        const strong = best && lead > EPSILON && lead >= options.tuning.getNumber('controls.receiverClaimLeadSeconds');
        const replacement = retained && best && best.playerId !== retained.playerId &&
          retained.score - best.score > EPSILON &&
          retained.score - best.score >= options.tuning.getNumber('controls.receiverReplacementMargin');
        const selected = retained && !replacement ? retained : strong ? best : undefined;
        if (selected) {
          const previousClaim = currentClaim;
          currentClaim = {
            playerId: selected.playerId, position: selected.position, timeSeconds: selected.timeSeconds,
            score: selected.score, createdTick: previousClaim?.playerId === selected.playerId ? previousClaim.createdTick : state.tick + 1
          };
          assign(selected.playerId, 'receiver');
          reason = previousClaim?.playerId === selected.playerId ? 'receiver-claim-retained'
            : previousClaim ? 'receiver-claim-replaced' : 'receiver-claim-acquired';
        } else {
          reason = currentClaim ? 'receiver-claim-invalidated' : 'ambiguous-loose-ball';
          currentClaim = undefined;
        }
      } else if (manualSelection) {
        reason = 'manual-selection-retained';
      }
      const controlled = state.players.find((player) => player.definition.id === currentAssignment?.playerId);
      if (!controlled || controlled.definition.teamId !== humanTeamId || controlled.definition.role === 'goalkeeper') {
        if (defensive[0]) {
          assign(defensive[0].playerId, 'defensive');
          reason = controlled?.definition.role === 'goalkeeper' ? 'keeper-return-to-defence' : 'select-available-field-player';
        } else currentAssignment = undefined;
      }
    }

    return { tick: state.tick + 1, reason, holderId: holder?.definition.id, previousPlayerId,
      receiverClaim: currentClaim ? { ...currentClaim, position: { ...currentClaim.position } } : undefined,
      receiverCandidates: candidates, defensiveCandidates: defensive };
  };

  return {
    get assignment(): ControlAssignment | undefined {
      return currentAssignment ? { ...currentAssignment } : undefined;
    },

    get receiverClaim(): ReceiverClaim | undefined {
      return currentClaim ? { ...currentClaim, position: { ...currentClaim.position } } : undefined;
    },

    consumeTick(snapshot, actionContext = 'neutral', world): ControlStepResult {
      const processed = inputProcessor.process(snapshot);
      const routing = world ? routeWorld(world, processed.input.buttons.switch.pressed) : undefined;
      if (world) {
        actionContext = world.state.ball.mode === 'possessed' && world.state.ball.holderId === currentAssignment?.playerId
          ? 'possessed' : currentClaim?.playerId === currentAssignment?.playerId && currentClaim
            ? 'receiving' : world.state.ball.mode === 'possessed' ? 'defending' : 'neutral';
      }
      const intent = createIntent(processed.input, processed.rightStickThrow, actionContext);
      const routedIntent: RoutedPlayerIntent | undefined = currentAssignment
        ? {
            playerId: currentAssignment.playerId,
            intent
          }
        : undefined;

      return {
        input: processed.input,
        assignment: currentAssignment ? { ...currentAssignment } : undefined,
        routedIntent,
        capture: processed.capture,
        routing
      };
    },

    assignPlayer(playerId, reason = 'manual'): void {
      assertPlayerId(playerId);
      currentAssignment = { playerId, reason };
      currentClaim = undefined;
      manualSelection = reason === 'manual';
    },

    clearAssignment(): void {
      currentAssignment = undefined;
      resetRouting();
    },

    resetInput(): void {
      inputProcessor.reset();
      resetRouting();
    },

    reset(): void {
      inputProcessor.reset();
      resetRouting();
      currentAssignment = initialPlayerId
        ? { playerId: initialPlayerId, reason: 'reset' }
        : undefined;
    }
  };
}
