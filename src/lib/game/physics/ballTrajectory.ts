import {
  BALL_GRAVITY_KEY,
  BALL_HIGH_THROW_MAX_PLANAR_SPEED_KEY,
  BALL_HIGH_THROW_MAX_VERTICAL_SPEED_KEY,
  BALL_HIGH_THROW_MIN_PLANAR_SPEED_KEY,
  BALL_HIGH_THROW_MIN_VERTICAL_SPEED_KEY,
  BALL_GROUND_DAMPING_KEY,
  BALL_GROUND_RESTITUTION_KEY,
  BALL_GROUND_SETTLE_SPEED_KEY,
  BALL_LOW_THROW_MAX_SPEED_KEY,
  BALL_LOW_THROW_MIN_SPEED_KEY,
  BALL_PLANAR_DAMPING_KEY,
  BALL_PREDICTION_HORIZON_STEPS_KEY,
  BALL_RADIUS_KEY,
  BALL_WALL_RESTITUTION_KEY,
  CONTROLS_THROW_MAX_STRENGTH_KEY,
  CONTROLS_THROW_MIN_STRENGTH_KEY,
  type TuningReader
} from '../config/tuning';
import type { ArenaDefinition, ArenaGoalAperture } from './arena';
import {
  isCircleWithinBounds,
  sweepCircleAgainstBounds,
  type CircleBoundaryContact,
  type Vec2
} from './geometry';

const EPSILON = 1e-9;
const POSITION_EPSILON = 1e-8;
const MAX_SWEEP_CONTACTS = 8;
const MAX_VERTICAL_BOUNCES = 8;
const DEFAULT_PREDICTION_STEP_SECONDS = 1 / 60;

export interface LooseBallMotion {
  readonly position: Vec2;
  readonly velocity: Vec2;
  readonly height: number;
  readonly verticalVelocity: number;
}

export type BallThrowFamily = 'low' | 'high';

export interface BallThrowLaunch {
  readonly family: BallThrowFamily;
  readonly direction: Vec2;
  readonly strength: number;
  readonly velocity: Vec2;
  readonly verticalVelocity: number;
}

export interface BallTrajectorySegment {
  readonly startTimeSeconds: number;
  readonly endTimeSeconds: number;
  readonly start: Vec2;
  readonly end: Vec2;
  readonly startHeight: number;
  readonly endHeight: number;
}

export interface BallSweepContact {
  readonly boundary: CircleBoundaryContact;
  readonly timeSeconds: number;
  readonly position: Vec2;
  readonly normal: Vec2;
  readonly sweepStart: Vec2;
  readonly sweepEnd: Vec2;
  readonly velocityBefore: Vec2;
  readonly velocityAfter: Vec2;
}

export interface BallGoalApertureEvaluation {
  readonly end: ArenaGoalAperture['end'];
  readonly timeSeconds: number;
  readonly position: Vec2;
  readonly height: number;
  readonly horizontalFit: boolean;
  readonly verticalFit: boolean;
  readonly crossed: boolean;
}

export interface BallLanding {
  readonly timeSeconds: number;
  readonly position: Vec2;
}

export interface LooseBallStepResult {
  readonly nextState: LooseBallMotion;
  readonly segments: readonly BallTrajectorySegment[];
  readonly contacts: readonly BallSweepContact[];
  readonly goalAperture: BallGoalApertureEvaluation | undefined;
  readonly landing: BallLanding | undefined;
  readonly settled: boolean;
}

export interface LooseBallPredictionOptions {
  readonly fixedStepSeconds?: number;
  readonly maxSteps?: number;
}

export interface LooseBallTrajectorySample extends LooseBallMotion {
  readonly timeSeconds: number;
}

export interface LooseBallTrajectoryPrediction {
  readonly finalState: LooseBallMotion;
  readonly samples: readonly LooseBallTrajectorySample[];
  readonly segments: readonly BallTrajectorySegment[];
  readonly contacts: readonly BallSweepContact[];
  readonly goalApertures: readonly BallGoalApertureEvaluation[];
  readonly landing: BallLanding | undefined;
}

interface BallPhysicsTuning {
  readonly radius: number;
  readonly planarDamping: number;
  readonly gravity: number;
  readonly wallRestitution: number;
  readonly groundRestitution: number;
  readonly groundDamping: number;
  readonly groundSettleSpeed: number;
}

interface BallThrowTuning {
  readonly minStrength: number;
  readonly maxStrength: number;
  readonly lowMinSpeed: number;
  readonly lowMaxSpeed: number;
  readonly highMinPlanarSpeed: number;
  readonly highMaxPlanarSpeed: number;
  readonly highMinVerticalSpeed: number;
  readonly highMaxVerticalSpeed: number;
}

interface VerticalSegment {
  readonly startTimeSeconds: number;
  readonly endTimeSeconds: number;
  readonly startHeight: number;
  readonly startVerticalVelocity: number;
}

interface VerticalProfile {
  readonly height: number;
  readonly verticalVelocity: number;
  readonly segments: readonly VerticalSegment[];
  readonly landingTimeSeconds: number | undefined;
}

function assertFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${name} must be finite.`);
  }
}

function assertNonNegative(value: number, name: string): void {
  assertFinite(value, name);
  if (value < 0) {
    throw new RangeError(`${name} must be non-negative.`);
  }
}

function assertUnitInterval(value: number, name: string): void {
  assertFinite(value, name);
  if (value < 0 || value > 1) {
    throw new RangeError(`${name} must be between 0 and 1.`);
  }
}

function assertFixedStep(fixedStepSeconds: number): void {
  assertFinite(fixedStepSeconds, 'The simulation step');
  if (fixedStepSeconds <= 0) {
    throw new RangeError('The simulation step must be positive.');
  }
}

function assertMotion(motion: LooseBallMotion): void {
  assertFinite(motion.position.x, 'Ball position x');
  assertFinite(motion.position.y, 'Ball position y');
  assertFinite(motion.velocity.x, 'Ball velocity x');
  assertFinite(motion.velocity.y, 'Ball velocity y');
  assertNonNegative(motion.height, 'Ball height');
  assertFinite(motion.verticalVelocity, 'Ball vertical velocity');
}

function cloneVector(vector: Vec2): Vec2 {
  return { x: vector.x, y: vector.y };
}

function cloneMotion(motion: LooseBallMotion): LooseBallMotion {
  return {
    position: cloneVector(motion.position),
    velocity: cloneVector(motion.velocity),
    height: motion.height,
    verticalVelocity: motion.verticalVelocity
  };
}

function addVectors(left: Vec2, right: Vec2): Vec2 {
  return { x: left.x + right.x, y: left.y + right.y };
}

function scaleVector(vector: Vec2, scale: number): Vec2 {
  return { x: vector.x * scale, y: vector.y * scale };
}

function dot(left: Vec2, right: Vec2): number {
  return left.x * right.x + left.y * right.y;
}

function readBallPhysicsTuning(tuning: TuningReader): BallPhysicsTuning {
  const values = {
    radius: tuning.getNumber(BALL_RADIUS_KEY),
    planarDamping: tuning.getNumber(BALL_PLANAR_DAMPING_KEY),
    gravity: tuning.getNumber(BALL_GRAVITY_KEY),
    wallRestitution: tuning.getNumber(BALL_WALL_RESTITUTION_KEY),
    groundRestitution: tuning.getNumber(BALL_GROUND_RESTITUTION_KEY),
    groundDamping: tuning.getNumber(BALL_GROUND_DAMPING_KEY),
    groundSettleSpeed: tuning.getNumber(BALL_GROUND_SETTLE_SPEED_KEY)
  };

  if (values.radius <= 0) {
    throw new RangeError('Ball radius must be positive.');
  }
  assertNonNegative(values.planarDamping, 'Ball planar damping');
  assertNonNegative(values.gravity, 'Ball gravity');
  assertUnitInterval(values.wallRestitution, 'Ball wall restitution');
  assertUnitInterval(values.groundRestitution, 'Ball ground restitution');
  assertUnitInterval(values.groundDamping, 'Ball ground damping');
  assertNonNegative(values.groundSettleSpeed, 'Ball ground settle speed');

  return values;
}

function readBallThrowTuning(tuning: TuningReader): BallThrowTuning {
  const values = {
    minStrength: tuning.getNumber(CONTROLS_THROW_MIN_STRENGTH_KEY),
    maxStrength: tuning.getNumber(CONTROLS_THROW_MAX_STRENGTH_KEY),
    lowMinSpeed: tuning.getNumber(BALL_LOW_THROW_MIN_SPEED_KEY),
    lowMaxSpeed: tuning.getNumber(BALL_LOW_THROW_MAX_SPEED_KEY),
    highMinPlanarSpeed: tuning.getNumber(BALL_HIGH_THROW_MIN_PLANAR_SPEED_KEY),
    highMaxPlanarSpeed: tuning.getNumber(BALL_HIGH_THROW_MAX_PLANAR_SPEED_KEY),
    highMinVerticalSpeed: tuning.getNumber(BALL_HIGH_THROW_MIN_VERTICAL_SPEED_KEY),
    highMaxVerticalSpeed: tuning.getNumber(BALL_HIGH_THROW_MAX_VERTICAL_SPEED_KEY)
  };

  assertNonNegative(values.minStrength, 'Throw minimum strength');
  assertNonNegative(values.maxStrength, 'Throw maximum strength');
  assertNonNegative(values.lowMinSpeed, 'Low throw minimum speed');
  assertNonNegative(values.lowMaxSpeed, 'Low throw maximum speed');
  assertNonNegative(values.highMinPlanarSpeed, 'High throw minimum planar speed');
  assertNonNegative(values.highMaxPlanarSpeed, 'High throw maximum planar speed');
  assertNonNegative(values.highMinVerticalSpeed, 'High throw minimum vertical speed');
  assertNonNegative(values.highMaxVerticalSpeed, 'High throw maximum vertical speed');

  if (values.maxStrength < values.minStrength) {
    throw new RangeError('Throw maximum strength must be at least the minimum strength.');
  }
  if (values.lowMaxSpeed < values.lowMinSpeed) {
    throw new RangeError('Low throw maximum speed must be at least the minimum speed.');
  }
  if (values.highMaxPlanarSpeed < values.highMinPlanarSpeed) {
    throw new RangeError(
      'High throw maximum planar speed must be at least the minimum speed.'
    );
  }
  if (values.highMaxVerticalSpeed < values.highMinVerticalSpeed) {
    throw new RangeError(
      'High throw maximum vertical speed must be at least the minimum speed.'
    );
  }

  return values;
}

function normalizeDirection(direction: Vec2): Vec2 {
  assertFinite(direction.x, 'Throw direction x');
  assertFinite(direction.y, 'Throw direction y');
  const magnitude = Math.hypot(direction.x, direction.y);
  if (magnitude <= EPSILON) {
    throw new RangeError('A throw direction must have non-zero magnitude.');
  }

  return { x: direction.x / magnitude, y: direction.y / magnitude };
}

function interpolate(minimum: number, maximum: number, progress: number): number {
  return minimum + (maximum - minimum) * progress;
}

/**
 * Converts an authored throw family/strength into the loose-ball launch state.
 * Possession and action semantics remain simulation-owned; this function only
 * defines the deterministic motion family that follows a release.
 */
export function createBallThrowLaunch(
  family: BallThrowFamily,
  direction: Vec2,
  strength: number,
  tuning: TuningReader
): BallThrowLaunch {
  assertFinite(strength, 'Throw strength');
  const throwTuning = readBallThrowTuning(tuning);
  const normalizedDirection = normalizeDirection(direction);
  const strengthRange = throwTuning.maxStrength - throwTuning.minStrength;
  const progress =
    strengthRange <= EPSILON
      ? 1
      : Math.min(
          1,
          Math.max(
            0,
            (strength - throwTuning.minStrength) / strengthRange
          )
        );

  if (family === 'low') {
    const speed = interpolate(
      throwTuning.lowMinSpeed,
      throwTuning.lowMaxSpeed,
      progress
    );
    return {
      family,
      direction: normalizedDirection,
      strength,
      velocity: scaleVector(normalizedDirection, speed),
      verticalVelocity: 0
    };
  }

  const planarSpeed = interpolate(
    throwTuning.highMinPlanarSpeed,
    throwTuning.highMaxPlanarSpeed,
    progress
  );
  return {
    family,
    direction: normalizedDirection,
    strength,
    velocity: scaleVector(normalizedDirection, planarSpeed),
    verticalVelocity: interpolate(
      throwTuning.highMinVerticalSpeed,
      throwTuning.highMaxVerticalSpeed,
      progress
    )
  };
}

function solveGroundHitTime(
  height: number,
  verticalVelocity: number,
  gravity: number,
  maxDurationSeconds: number
): number | undefined {
  if (height <= EPSILON) {
    if (verticalVelocity < -EPSILON) {
      return 0;
    }
    if (verticalVelocity <= EPSILON) {
      return undefined;
    }
  }

  if (gravity <= EPSILON) {
    if (verticalVelocity >= -EPSILON) {
      return undefined;
    }

    const time = -height / verticalVelocity;
    return time >= -EPSILON && time <= maxDurationSeconds + EPSILON
      ? Math.max(0, time)
      : undefined;
  }

  const discriminant = Math.max(0, verticalVelocity ** 2 + 2 * gravity * height);
  const time = (verticalVelocity + Math.sqrt(discriminant)) / gravity;
  return time >= -EPSILON && time <= maxDurationSeconds + EPSILON
    ? Math.max(0, Math.min(maxDurationSeconds, time))
    : undefined;
}

function createVerticalProfile(
  motion: LooseBallMotion,
  fixedStepSeconds: number,
  tuning: BallPhysicsTuning
): VerticalProfile {
  let elapsed = 0;
  let height = motion.height;
  let verticalVelocity = motion.verticalVelocity;
  const segments: VerticalSegment[] = [];
  let landingTimeSeconds: number | undefined;
  let bounceCount = 0;

  while (elapsed < fixedStepSeconds - EPSILON) {
    if (height <= EPSILON && verticalVelocity <= EPSILON) {
      height = 0;
      verticalVelocity = 0;
      segments.push({
        startTimeSeconds: elapsed,
        endTimeSeconds: fixedStepSeconds,
        startHeight: height,
        startVerticalVelocity: verticalVelocity
      });
      elapsed = fixedStepSeconds;
      break;
    }

    const remaining = fixedStepSeconds - elapsed;
    const hitTime = solveGroundHitTime(
      height,
      verticalVelocity,
      tuning.gravity,
      remaining
    );
    const duration = hitTime ?? remaining;
    segments.push({
      startTimeSeconds: elapsed,
      endTimeSeconds: elapsed + duration,
      startHeight: height,
      startVerticalVelocity: verticalVelocity
    });

    height = Math.max(
      0,
      height + verticalVelocity * duration - 0.5 * tuning.gravity * duration ** 2
    );
    verticalVelocity -= tuning.gravity * duration;
    elapsed += duration;

    if (hitTime === undefined) {
      break;
    }

    height = 0;
    landingTimeSeconds ??= elapsed;
    const reboundSpeed =
      Math.max(0, -verticalVelocity) *
      tuning.groundRestitution *
      Math.max(0, 1 - tuning.groundDamping);

    if (
      reboundSpeed <= tuning.groundSettleSpeed + EPSILON ||
      bounceCount >= MAX_VERTICAL_BOUNCES
    ) {
      verticalVelocity = 0;
      if (elapsed < fixedStepSeconds - EPSILON) {
        segments.push({
          startTimeSeconds: elapsed,
          endTimeSeconds: fixedStepSeconds,
          startHeight: 0,
          startVerticalVelocity: 0
        });
      }
      elapsed = fixedStepSeconds;
      break;
    }

    verticalVelocity = reboundSpeed;
    bounceCount += 1;
  }

  return {
    height,
    verticalVelocity,
    segments,
    landingTimeSeconds
  };
}

function heightAtWithGravity(
  profile: VerticalProfile,
  timeSeconds: number,
  gravity: number
): number {
  const time = Math.max(0, timeSeconds);
  const segment = profile.segments.find(
    (candidate) => time <= candidate.endTimeSeconds + EPSILON
  );
  if (!segment) {
    return profile.height;
  }

  const duration = Math.max(
    0,
    Math.min(time, segment.endTimeSeconds) - segment.startTimeSeconds
  );
  return Math.max(
    0,
    segment.startHeight +
      segment.startVerticalVelocity * duration -
      0.5 * gravity * duration ** 2
  );
}

function goalForBoundary(
  arena: ArenaDefinition,
  boundary: CircleBoundaryContact
): ArenaGoalAperture | undefined {
  if (boundary === 'bottom') {
    return arena.goals.find((goal) => goal.end === 'negativeY');
  }
  if (boundary === 'top') {
    return arena.goals.find((goal) => goal.end === 'positiveY');
  }
  return undefined;
}

function evaluateGoalAperture(
  goal: ArenaGoalAperture,
  position: Vec2,
  height: number,
  radius: number,
  timeSeconds: number
): BallGoalApertureEvaluation {
  const horizontalFit =
    position.x - radius >= goal.minX - EPSILON &&
    position.x + radius <= goal.maxX + EPSILON;
  const verticalFit = height + radius * 2 <= goal.crossbarHeight + EPSILON;

  return {
    end: goal.end,
    timeSeconds,
    position: cloneVector(position),
    height,
    horizontalFit,
    verticalFit,
    crossed: horizontalFit && verticalFit
  };
}

function reflectVelocity(
  velocity: Vec2,
  normal: Vec2,
  restitution: number
): Vec2 {
  const normalVelocity = dot(velocity, normal);
  if (normalVelocity >= -EPSILON) {
    return cloneVector(velocity);
  }

  return {
    x: velocity.x - (1 + restitution) * normalVelocity * normal.x,
    y: velocity.y - (1 + restitution) * normalVelocity * normal.y
  };
}

function positionAtTime(
  segments: readonly BallTrajectorySegment[],
  timeSeconds: number,
  fallback: Vec2
): Vec2 {
  const segment = segments.find(
    (candidate) => timeSeconds <= candidate.endTimeSeconds + EPSILON
  );
  if (!segment) {
    return cloneVector(fallback);
  }

  const duration = segment.endTimeSeconds - segment.startTimeSeconds;
  if (duration <= EPSILON) {
    return cloneVector(segment.end);
  }

  const ratio = Math.min(
    1,
    Math.max(0, (timeSeconds - segment.startTimeSeconds) / duration)
  );
  return {
    x: segment.start.x + (segment.end.x - segment.start.x) * ratio,
    y: segment.start.y + (segment.end.y - segment.start.y) * ratio
  };
}

function appendSegment(
  segments: BallTrajectorySegment[],
  startTimeSeconds: number,
  endTimeSeconds: number,
  start: Vec2,
  end: Vec2,
  profile: VerticalProfile,
  gravity: number
): void {
  if (endTimeSeconds - startTimeSeconds <= EPSILON) {
    return;
  }

  segments.push({
    startTimeSeconds,
    endTimeSeconds,
    start: cloneVector(start),
    end: cloneVector(end),
    startHeight: heightAtWithGravity(profile, startTimeSeconds, gravity),
    endHeight: heightAtWithGravity(profile, endTimeSeconds, gravity)
  });
}

function insetPosition(position: Vec2, normals: readonly Vec2[]): Vec2 {
  return normals.reduce(
    (current, normal) => addVectors(current, scaleVector(normal, POSITION_EPSILON)),
    cloneVector(position)
  );
}

export function advanceLooseBall(
  motion: LooseBallMotion,
  fixedStepSeconds: number,
  tuning: TuningReader,
  arena: ArenaDefinition
): LooseBallStepResult {
  assertFixedStep(fixedStepSeconds);
  assertMotion(motion);
  const physicsTuning = readBallPhysicsTuning(tuning);
  const verticalProfile = createVerticalProfile(motion, fixedStepSeconds, physicsTuning);

  let position = cloneVector(motion.position);
  let velocity = scaleVector(
    motion.velocity,
    Math.exp(-physicsTuning.planarDamping * fixedStepSeconds)
  );
  let elapsed = 0;
  let remaining = fixedStepSeconds;
  let contactCount = 0;
  let endWallEvaluated = false;
  const segments: BallTrajectorySegment[] = [];
  const contacts: BallSweepContact[] = [];
  let goalAperture: BallGoalApertureEvaluation | undefined;

  while (remaining > EPSILON) {
    const sweepStart = cloneVector(position);
    const displacement = scaleVector(velocity, remaining);
    const rawHits = isCircleWithinBounds(
      position,
      physicsTuning.radius,
      arena.bounds
    )
      ? sweepCircleAgainstBounds(
          position,
          displacement,
          physicsTuning.radius,
          arena.bounds
        )
      : [];

    if (rawHits.length === 0) {
      const segmentEnd = addVectors(position, displacement);
      appendSegment(
        segments,
        elapsed,
        fixedStepSeconds,
        sweepStart,
        segmentEnd,
        verticalProfile,
        physicsTuning.gravity
      );
      position = segmentEnd;
      elapsed = fixedStepSeconds;
      remaining = 0;
      break;
    }

    const hit = rawHits[0];
    const travelTime = Math.min(remaining, Math.max(0, hit.time * remaining));
    const segmentEnd = addVectors(position, scaleVector(velocity, travelTime));
    appendSegment(
      segments,
      elapsed,
      elapsed + travelTime,
      sweepStart,
      segmentEnd,
      verticalProfile,
      physicsTuning.gravity
    );

    position = cloneVector(hit.position);
    elapsed += travelTime;
    remaining = Math.max(0, fixedStepSeconds - elapsed);

    const endHit = rawHits.find(
      (candidate) => candidate.boundary === 'bottom' || candidate.boundary === 'top'
    );
    let solidHits = rawHits;

    if (endHit && !endWallEvaluated) {
      endWallEvaluated = true;
      const goal = goalForBoundary(arena, endHit.boundary);
      if (goal) {
        goalAperture = evaluateGoalAperture(
          goal,
          endHit.position,
          heightAtWithGravity(verticalProfile, elapsed, physicsTuning.gravity),
          physicsTuning.radius,
          elapsed
        );

        if (goalAperture.crossed) {
          solidHits = rawHits.filter(
            (candidate) => candidate.boundary !== 'bottom' && candidate.boundary !== 'top'
          );
          if (solidHits.length === 0) {
            const throughEnd = addVectors(position, scaleVector(velocity, remaining));
            appendSegment(
              segments,
              elapsed,
              fixedStepSeconds,
              position,
              throughEnd,
              verticalProfile,
              physicsTuning.gravity
            );
            position = throughEnd;
            elapsed = fixedStepSeconds;
            remaining = 0;
            break;
          }
        }
      }
    }

    const velocityBefore = cloneVector(velocity);
    for (const contact of solidHits) {
      velocity = reflectVelocity(
        velocity,
        contact.normal,
        physicsTuning.wallRestitution
      );
    }

    for (const contact of solidHits) {
      contacts.push({
        boundary: contact.boundary,
        timeSeconds: elapsed,
        position: cloneVector(contact.position),
        normal: cloneVector(contact.normal),
        sweepStart,
        sweepEnd: cloneVector(contact.position),
        velocityBefore,
        velocityAfter: cloneVector(velocity)
      });
    }

    contactCount += solidHits.length;
    if (contactCount >= MAX_SWEEP_CONTACTS) {
      break;
    }

    position = insetPosition(
      position,
      solidHits.map((contact) => contact.normal)
    );
  }

  const landing =
    verticalProfile.landingTimeSeconds === undefined
      ? undefined
      : {
          timeSeconds: verticalProfile.landingTimeSeconds,
          position: positionAtTime(
            segments,
            verticalProfile.landingTimeSeconds,
            position
          )
        };

  const nextState: LooseBallMotion = {
    position,
    velocity,
    height: verticalProfile.height,
    verticalVelocity: verticalProfile.verticalVelocity
  };

  return {
    nextState,
    segments,
    contacts,
    goalAperture,
    landing,
    settled:
      nextState.height <= EPSILON &&
      Math.abs(nextState.verticalVelocity) <= EPSILON
  };
}

function predictionStepCount(
  tuning: TuningReader,
  maxSteps: number | undefined
): number {
  const value = maxSteps ?? tuning.getNumber(BALL_PREDICTION_HORIZON_STEPS_KEY);
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError('Ball prediction horizon must be a positive integer.');
  }

  return value;
}

export function predictLooseBallTrajectory(
  motion: LooseBallMotion,
  tuning: TuningReader,
  arena: ArenaDefinition,
  options: LooseBallPredictionOptions = {}
): LooseBallTrajectoryPrediction {
  const fixedStepSeconds = options.fixedStepSeconds ?? DEFAULT_PREDICTION_STEP_SECONDS;
  assertFixedStep(fixedStepSeconds);
  assertMotion(motion);
  const maxSteps = predictionStepCount(tuning, options.maxSteps);

  let current = cloneMotion(motion);
  let elapsed = 0;
  let landing: BallLanding | undefined;
  const samples: LooseBallTrajectorySample[] = [
    { timeSeconds: 0, ...cloneMotion(current) }
  ];
  const segments: BallTrajectorySegment[] = [];
  const contacts: BallSweepContact[] = [];
  const goalApertures: BallGoalApertureEvaluation[] = [];

  for (let stepIndex = 0; stepIndex < maxSteps; stepIndex += 1) {
    const result = advanceLooseBall(current, fixedStepSeconds, tuning, arena);
    segments.push(
      ...result.segments.map((segment) => ({
        ...segment,
        startTimeSeconds: segment.startTimeSeconds + elapsed,
        endTimeSeconds: segment.endTimeSeconds + elapsed
      }))
    );
    contacts.push(
      ...result.contacts.map((contact) => ({
        ...contact,
        timeSeconds: contact.timeSeconds + elapsed
      }))
    );
    if (result.goalAperture) {
      goalApertures.push({
        ...result.goalAperture,
        timeSeconds: result.goalAperture.timeSeconds + elapsed
      });
    }

    if (!landing && result.landing) {
      landing = {
        timeSeconds: result.landing.timeSeconds + elapsed,
        position: cloneVector(result.landing.position)
      };
    }

    current = cloneMotion(result.nextState);
    elapsed += fixedStepSeconds;
    samples.push({ timeSeconds: elapsed, ...cloneMotion(current) });

    if (result.goalAperture?.crossed) {
      break;
    }
  }

  return {
    finalState: cloneMotion(current),
    samples,
    segments,
    contacts,
    goalApertures,
    landing
  };
}
