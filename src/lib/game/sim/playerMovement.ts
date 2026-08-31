import type { PlayerIntent } from '../control/types';
import {
  MOVEMENT_ACCELERATION_KEY,
  MOVEMENT_BRAKING_KEY,
  MOVEMENT_FACING_RESPONSE_KEY,
  MOVEMENT_MAX_SPEED_KEY,
  MOVEMENT_REVERSAL_RESPONSE_KEY,
  PLAYER_RADIUS_KEY,
  type TuningReader
} from '../config/tuning';
import type { ArenaDefinition } from '../physics/arena';
import {
  constrainCircleToBounds,
  type CircleBoundaryContact,
  type Vec2
} from '../physics/geometry';
import type { PlayerState } from './gameState';

const EPSILON = 1e-9;
const DEFAULT_FACING: Vec2 = { x: 0, y: 1 };

export interface PlayerMovementObservation {
  readonly playerId: string;
  readonly position: Vec2;
  readonly velocity: Vec2;
  readonly facing: Vec2;
  readonly desiredMovement: Vec2;
  readonly desiredVelocity: Vec2;
  readonly radius: number;
  readonly contacts: readonly CircleBoundaryContact[];
}

interface MovementTuning {
  readonly maxSpeed: number;
  readonly acceleration: number;
  readonly braking: number;
  readonly facingResponse: number;
  readonly reversalResponse: number;
  readonly radius: number;
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

function assertFixedStep(fixedStepSeconds: number): void {
  assertFinite(fixedStepSeconds, 'The simulation step');
  if (fixedStepSeconds <= 0) {
    throw new RangeError('The simulation step must be positive.');
  }
}

function assertVector(vector: Vec2, name: string): void {
  assertFinite(vector.x, `${name} x`);
  assertFinite(vector.y, `${name} y`);
}

function vectorLength(vector: Vec2): number {
  assertVector(vector, 'A vector');
  return Math.hypot(vector.x, vector.y);
}

function cloneVector(vector: Vec2): Vec2 {
  assertVector(vector, 'A vector');
  return { x: vector.x, y: vector.y };
}

function scaleVector(vector: Vec2, scale: number): Vec2 {
  return { x: vector.x * scale, y: vector.y * scale };
}

function normalizeOrUndefined(vector: Vec2): Vec2 | undefined {
  const length = vectorLength(vector);
  if (length <= EPSILON) {
    return undefined;
  }

  return scaleVector(vector, 1 / length);
}

function clampUnitVector(vector: Vec2): Vec2 {
  const length = vectorLength(vector);
  if (length <= EPSILON) {
    return { x: 0, y: 0 };
  }

  return scaleVector(vector, Math.min(1, 1 / length));
}

function approachVector(current: Vec2, target: Vec2, maxDistance: number): Vec2 {
  const delta = { x: target.x - current.x, y: target.y - current.y };
  const distance = vectorLength(delta);
  if (distance <= EPSILON) {
    return cloneVector(target);
  }
  if (maxDistance <= EPSILON) {
    return cloneVector(current);
  }
  if (distance <= maxDistance) {
    return cloneVector(target);
  }

  return {
    x: current.x + (delta.x / distance) * maxDistance,
    y: current.y + (delta.y / distance) * maxDistance
  };
}

function wrapAngle(angle: number): number {
  let wrapped = angle;
  while (wrapped > Math.PI) {
    wrapped -= Math.PI * 2;
  }
  while (wrapped < -Math.PI) {
    wrapped += Math.PI * 2;
  }
  return wrapped;
}

function rotateTowards(current: Vec2, target: Vec2, maxRadians: number): Vec2 {
  const currentDirection = normalizeOrUndefined(current) ?? DEFAULT_FACING;
  const targetDirection = normalizeOrUndefined(target);
  if (!targetDirection || maxRadians <= EPSILON) {
    return cloneVector(currentDirection);
  }

  const currentAngle = Math.atan2(currentDirection.y, currentDirection.x);
  const targetAngle = Math.atan2(targetDirection.y, targetDirection.x);
  const delta = wrapAngle(targetAngle - currentAngle);
  if (Math.abs(delta) <= maxRadians) {
    return targetDirection;
  }

  const nextAngle = currentAngle + Math.sign(delta) * maxRadians;
  return { x: Math.cos(nextAngle), y: Math.sin(nextAngle) };
}

function readMovementTuning(tuning: TuningReader): MovementTuning {
  const values = {
    maxSpeed: tuning.getNumber(MOVEMENT_MAX_SPEED_KEY),
    acceleration: tuning.getNumber(MOVEMENT_ACCELERATION_KEY),
    braking: tuning.getNumber(MOVEMENT_BRAKING_KEY),
    facingResponse: tuning.getNumber(MOVEMENT_FACING_RESPONSE_KEY),
    reversalResponse: tuning.getNumber(MOVEMENT_REVERSAL_RESPONSE_KEY),
    radius: tuning.getNumber(PLAYER_RADIUS_KEY)
  };

  assertNonNegative(values.maxSpeed, 'Movement maximum speed');
  assertNonNegative(values.acceleration, 'Movement acceleration');
  assertNonNegative(values.braking, 'Movement braking');
  assertNonNegative(values.facingResponse, 'Movement facing response');
  assertNonNegative(values.reversalResponse, 'Movement reversal response');
  assertNonNegative(values.radius, 'Player radius');

  return values;
}

function removeOutwardVelocity(
  velocity: Vec2,
  contacts: readonly CircleBoundaryContact[]
): Vec2 {
  let x = velocity.x;
  let y = velocity.y;

  if (contacts.includes('left') && x < 0) {
    x = 0;
  }
  if (contacts.includes('right') && x > 0) {
    x = 0;
  }
  if (contacts.includes('bottom') && y < 0) {
    y = 0;
  }
  if (contacts.includes('top') && y > 0) {
    y = 0;
  }

  return { x, y };
}

export function integrateFieldPlayer(
  player: PlayerState,
  intent: Pick<PlayerIntent, 'movement' | 'desiredFacing'> | undefined,
  fixedStepSeconds: number,
  tuning: TuningReader,
  arena: ArenaDefinition
): PlayerMovementObservation {
  assertFixedStep(fixedStepSeconds);

  const movementTuning = readMovementTuning(tuning);
  const movement = clampUnitVector(intent?.movement ?? { x: 0, y: 0 });
  const movementMagnitude = vectorLength(movement);
  const movementDirection = normalizeOrUndefined(movement);
  const desiredFacing =
    normalizeOrUndefined(intent?.desiredFacing ?? { x: 0, y: 0 }) ?? movementDirection;
  const desiredVelocity = scaleVector(movement, movementTuning.maxSpeed);
  const currentVelocity = cloneVector(player.velocity);
  const currentSpeed = vectorLength(currentVelocity);

  let response = movementMagnitude <= EPSILON ? movementTuning.braking : movementTuning.acceleration;
  if (
    movementDirection &&
    currentSpeed > EPSILON &&
    currentVelocity.x * movementDirection.x + currentVelocity.y * movementDirection.y < 0
  ) {
    response = movementTuning.reversalResponse;
  }

  let velocity = approachVector(
    currentVelocity,
    desiredVelocity,
    response * fixedStepSeconds
  );
  const speed = vectorLength(velocity);
  if (speed > movementTuning.maxSpeed && movementTuning.maxSpeed >= 0) {
    velocity = scaleVector(velocity, movementTuning.maxSpeed / speed);
  }

  const facing = desiredFacing
    ? rotateTowards(
        player.facing,
        desiredFacing,
        movementTuning.facingResponse * fixedStepSeconds
      )
    : normalizeOrUndefined(player.facing) ?? DEFAULT_FACING;

  const unconstrainedPosition = {
    x: player.position.x + velocity.x * fixedStepSeconds,
    y: player.position.y + velocity.y * fixedStepSeconds
  };
  const constraint = constrainCircleToBounds(
    unconstrainedPosition,
    movementTuning.radius,
    arena.bounds
  );
  const constrainedVelocity = removeOutwardVelocity(velocity, constraint.contacts);

  player.position = constraint.position;
  player.velocity = constrainedVelocity;
  player.facing = facing;

  return {
    playerId: player.definition.id,
    position: cloneVector(player.position),
    velocity: cloneVector(player.velocity),
    facing: cloneVector(player.facing),
    desiredMovement: cloneVector(movement),
    desiredVelocity: cloneVector(desiredVelocity),
    radius: movementTuning.radius,
    contacts: constraint.contacts.slice()
  };
}
