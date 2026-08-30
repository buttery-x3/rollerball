import type { Vec2 } from '../physics/geometry';

const ZERO: Vec2 = { x: 0, y: 0 };

function assertFiniteVector(vector: Vec2, description: string): void {
  if (!Number.isFinite(vector.x) || !Number.isFinite(vector.y)) {
    throw new RangeError(`${description} must contain finite coordinates.`);
  }
}

function assertDeadzone(deadzone: number): void {
  if (!Number.isFinite(deadzone) || deadzone < 0 || deadzone >= 1) {
    throw new RangeError('A stick deadzone must be finite and in the range [0, 1).');
  }
}

export function vectorMagnitude(vector: Vec2): number {
  assertFiniteVector(vector, 'A vector');
  return Math.hypot(vector.x, vector.y);
}

export function normalizeStick(stick: Vec2, deadzone: number): Vec2 {
  assertFiniteVector(stick, 'A stick sample');
  assertDeadzone(deadzone);

  const magnitude = Math.hypot(stick.x, stick.y);
  if (magnitude <= deadzone || magnitude === 0) {
    return ZERO;
  }

  const directionX = stick.x / magnitude;
  const directionY = stick.y / magnitude;
  const remappedMagnitude = Math.min(1, (magnitude - deadzone) / (1 - deadzone));

  return {
    x: directionX * remappedMagnitude,
    y: directionY * remappedMagnitude
  };
}

export function normalizeDigitalMovement(horizontal: number, vertical: number): Vec2 {
  if (!Number.isFinite(horizontal) || !Number.isFinite(vertical)) {
    throw new RangeError('Digital movement components must be finite.');
  }

  const x = Math.max(-1, Math.min(1, horizontal));
  const y = Math.max(-1, Math.min(1, vertical));
  const magnitude = Math.hypot(x, y);

  if (magnitude === 0) {
    return ZERO;
  }

  const scale = Math.min(1, 1 / magnitude);
  return { x: x * scale, y: y * scale };
}

export function cloneVector(vector: Vec2): Vec2 {
  assertFiniteVector(vector, 'A vector');
  return { x: vector.x, y: vector.y };
}
