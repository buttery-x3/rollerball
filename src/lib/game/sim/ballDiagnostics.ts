import type {
  LooseBallState,
  PlayerState,
  PossessedBallState
} from './gameState';
import {
  BALL_DIAGNOSTIC_LAYER,
  type DiagnosticRecord
} from './diagnostics';
import type {
  BallGoalApertureEvaluation,
  LooseBallStepResult,
  LooseBallTrajectoryPrediction
} from '../physics/ballTrajectory';

const BALL_COLOR = '#f6c177';
const VELOCITY_COLOR = '#9ccfd8';
const TRAJECTORY_COLOR = '#c4a7e7';
const CONTACT_COLOR = '#eb6f92';
const LANDING_COLOR = '#85dacc';
const CROSSING_COLOR = '#f6c177';

function stateData(
  tick: number,
  ball: LooseBallState,
  radius: number,
  step: LooseBallStepResult,
  prediction: LooseBallTrajectoryPrediction
): Readonly<Record<string, unknown>> {
  return {
    tick,
    mode: ball.mode,
    position: ball.position,
    velocity: ball.velocity,
    height: ball.height,
    verticalVelocity: ball.verticalVelocity,
    radius,
    settled: step.settled,
    landing: step.landing,
    contacts: step.contacts,
    goalAperture: step.goalAperture,
    predictedLanding: prediction.landing,
    release: ball.release
  };
}

function goalData(
  evaluation: BallGoalApertureEvaluation
): Readonly<Record<string, unknown>> {
  return {
    end: evaluation.end,
    timeSeconds: evaluation.timeSeconds,
    position: evaluation.position,
    height: evaluation.height,
    horizontalFit: evaluation.horizontalFit,
    verticalFit: evaluation.verticalFit,
    crossed: evaluation.crossed
  };
}

export function createBallDiagnosticRecords(
  tick: number,
  ball: LooseBallState,
  radius: number,
  step: LooseBallStepResult,
  prediction: LooseBallTrajectoryPrediction
): readonly DiagnosticRecord[] {
  const data = stateData(tick, ball, radius, step, prediction);
  const records: DiagnosticRecord[] = [
    {
      layer: BALL_DIAGNOSTIC_LAYER,
      source: 'looseBall',
      entityId: 'ball-state',
      primitive: {
        type: 'circle',
        center: ball.position,
        radius,
        color: BALL_COLOR
      },
      data
    },
    {
      layer: BALL_DIAGNOSTIC_LAYER,
      source: 'looseBall',
      entityId: 'ball-velocity',
      primitive: {
        type: 'vector',
        origin: ball.position,
        direction: ball.velocity,
        color: VELOCITY_COLOR
      },
      data
    },
    {
      layer: BALL_DIAGNOSTIC_LAYER,
      source: 'looseBall',
      entityId: 'ball-height',
      primitive: {
        type: 'label',
        position: { x: ball.position.x + radius + 0.2, y: ball.position.y },
        text: `Ball · h ${ball.height.toFixed(2)} · vy ${ball.verticalVelocity.toFixed(2)}`,
        color: BALL_COLOR
      },
      data
    }
  ];

  prediction.segments.forEach((segment, index) => {
    if (segment.start.x === segment.end.x && segment.start.y === segment.end.y) {
      return;
    }

    records.push({
      layer: BALL_DIAGNOSTIC_LAYER,
      source: 'ballTrajectoryPrediction',
      entityId: `ball-trajectory-${index}`,
      primitive: {
        type: 'line',
        start: segment.start,
        end: segment.end,
        color: TRAJECTORY_COLOR
      },
      data: {
        startTimeSeconds: segment.startTimeSeconds,
        endTimeSeconds: segment.endTimeSeconds,
        startHeight: segment.startHeight,
        endHeight: segment.endHeight
      }
    });
  });

  if (prediction.landing) {
    records.push({
      layer: BALL_DIAGNOSTIC_LAYER,
      source: 'ballTrajectoryPrediction',
      entityId: 'ball-predicted-landing',
      primitive: {
        type: 'circle',
        center: prediction.landing.position,
        radius: Math.max(radius * 0.6, 0.08),
        color: LANDING_COLOR
      },
      data: { ...prediction.landing }
    });
  }

  for (const [index, contact] of step.contacts.entries()) {
    records.push({
      layer: BALL_DIAGNOSTIC_LAYER,
      source: 'ballSweep',
      entityId: `ball-sweep-${index}`,
      primitive: {
        type: 'line',
        start: contact.sweepStart,
        end: contact.sweepEnd,
        color: CONTACT_COLOR
      },
      data: { ...contact }
    });
    records.push({
      layer: BALL_DIAGNOSTIC_LAYER,
      source: 'ballSweep',
      entityId: `ball-contact-normal-${index}`,
      primitive: {
        type: 'vector',
        origin: contact.position,
        direction: contact.normal,
        color: CONTACT_COLOR
      },
      data: { ...contact }
    });
  }

  if (step.goalAperture) {
    records.push({
      layer: BALL_DIAGNOSTIC_LAYER,
      source: 'ballGoalAperture',
      entityId: 'ball-goal-aperture-result',
      primitive: {
        type: 'circle',
        center: step.goalAperture.position,
        radius: Math.max(radius * 0.5, 0.06),
        color: step.goalAperture.crossed ? CROSSING_COLOR : CONTACT_COLOR
      },
      data: goalData(step.goalAperture)
    });
  }

  return records;
}

export function createPossessedBallDiagnosticRecords(
  tick: number,
  ball: PossessedBallState,
  holder: PlayerState,
  radius: number
): readonly DiagnosticRecord[] {
  const data = {
    tick,
    mode: ball.mode,
    holderId: ball.holderId,
    holderPosition: holder.position,
    holderFacing: holder.facing,
    radius
  } satisfies Readonly<Record<string, unknown>>;

  return [
    {
      layer: BALL_DIAGNOSTIC_LAYER,
      source: 'possessedBall',
      entityId: 'ball-state',
      primitive: {
        type: 'circle',
        center: holder.position,
        radius,
        color: BALL_COLOR
      },
      data
    },
    {
      layer: BALL_DIAGNOSTIC_LAYER,
      source: 'possessedBall',
      entityId: 'ball-holder-facing',
      primitive: {
        type: 'vector',
        origin: holder.position,
        direction: holder.facing,
        color: VELOCITY_COLOR
      },
      data
    }
  ];
}
