export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

export interface AxisAlignedBounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
}

export interface CircleConstraintResult {
  readonly position: Vec2;
  readonly correction: Vec2;
  readonly contacts: readonly CircleBoundaryContact[];
}

export interface SweptCircleBoundaryHit {
  readonly boundary: CircleBoundaryContact;
  /** Normalized time within the supplied displacement, in the range [0, 1]. */
  readonly time: number;
  readonly position: Vec2;
  readonly normal: Vec2;
}

export interface SweptCircleCircleInterval {
  /** Normalized entry time within the supplied displacement. */
  readonly enterTime: number;
  /** Normalized exit time within the supplied displacement. */
  readonly exitTime: number;
  readonly enterPosition: Vec2;
}

export type CircleBoundaryContact = 'left' | 'right' | 'bottom' | 'top';

function assertFinite(value: number, description: string): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${description} must be finite.`);
  }
}

function assertBounds(bounds: AxisAlignedBounds): void {
  assertFinite(bounds.minX, 'Bounds minX');
  assertFinite(bounds.maxX, 'Bounds maxX');
  assertFinite(bounds.minY, 'Bounds minY');
  assertFinite(bounds.maxY, 'Bounds maxY');

  if (bounds.minX >= bounds.maxX || bounds.minY >= bounds.maxY) {
    throw new RangeError('Bounds must have positive width and height.');
  }
}

function assertCircle(center: Vec2, radius: number): void {
  assertFinite(center.x, 'Circle center x');
  assertFinite(center.y, 'Circle center y');
  assertFinite(radius, 'Circle radius');

  if (radius < 0) {
    throw new RangeError('Circle radius must be non-negative.');
  }
}

function assertDisplacement(displacement: Vec2): void {
  assertFinite(displacement.x, 'Displacement x');
  assertFinite(displacement.y, 'Displacement y');
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function isCircleWithinBounds(
  center: Vec2,
  radius: number,
  bounds: AxisAlignedBounds
): boolean {
  assertBounds(bounds);
  assertCircle(center, radius);

  return (
    bounds.minX + radius <= center.x &&
    center.x <= bounds.maxX - radius &&
    bounds.minY + radius <= center.y &&
    center.y <= bounds.maxY - radius
  );
}

export function constrainCircleToBounds(
  center: Vec2,
  radius: number,
  bounds: AxisAlignedBounds
): CircleConstraintResult {
  assertBounds(bounds);
  assertCircle(center, radius);

  const minX = bounds.minX + radius;
  const maxX = bounds.maxX - radius;
  const minY = bounds.minY + radius;
  const maxY = bounds.maxY - radius;

  if (minX > maxX || minY > maxY) {
    throw new RangeError('Circle radius must fit inside the bounds.');
  }

  const x = clamp(center.x, minX, maxX);
  const y = clamp(center.y, minY, maxY);
  const contacts: CircleBoundaryContact[] = [];

  if (x === minX) {
    contacts.push('left');
  }
  if (x === maxX) {
    contacts.push('right');
  }
  if (y === minY) {
    contacts.push('bottom');
  }
  if (y === maxY) {
    contacts.push('top');
  }

  return {
    position: { x, y },
    correction: { x: x - center.x, y: y - center.y },
    contacts
  };
}

/**
 * Finds the earliest static-boundary contacts for a moving circle. The caller
 * supplies the full displacement for one sweep; returned times are normalized
 * against that displacement. This helper intentionally contains no gameplay
 * meaning beyond geometric contact.
 */
export function sweepCircleAgainstBounds(
  start: Vec2,
  displacement: Vec2,
  radius: number,
  bounds: AxisAlignedBounds
): readonly SweptCircleBoundaryHit[] {
  assertBounds(bounds);
  assertCircle(start, radius);
  assertDisplacement(displacement);

  const minX = bounds.minX + radius;
  const maxX = bounds.maxX - radius;
  const minY = bounds.minY + radius;
  const maxY = bounds.maxY - radius;

  if (minX > maxX || minY > maxY) {
    throw new RangeError('Circle radius must fit inside the bounds.');
  }

  const candidates: Array<{
    boundary: CircleBoundaryContact;
    time: number;
    normal: Vec2;
  }> = [];

  const addCandidate = (
    boundary: CircleBoundaryContact,
    coordinate: number,
    delta: number,
    limit: number,
    normal: Vec2
  ): void => {
    if (Math.abs(delta) <= 1e-12) {
      return;
    }

    const time = (limit - coordinate) / delta;
    const movingTowardBoundary =
      (boundary === 'left' && delta < 0) ||
      (boundary === 'right' && delta > 0) ||
      (boundary === 'bottom' && delta < 0) ||
      (boundary === 'top' && delta > 0);

    if (!movingTowardBoundary || time < -1e-9 || time > 1 + 1e-9) {
      return;
    }

    candidates.push({
      boundary,
      time: clamp(time, 0, 1),
      normal
    });
  };

  if (start.x >= minX - 1e-9) {
    addCandidate('left', start.x, displacement.x, minX, { x: 1, y: 0 });
  }
  if (start.x <= maxX + 1e-9) {
    addCandidate('right', start.x, displacement.x, maxX, { x: -1, y: 0 });
  }
  if (start.y >= minY - 1e-9) {
    addCandidate('bottom', start.y, displacement.y, minY, { x: 0, y: 1 });
  }
  if (start.y <= maxY + 1e-9) {
    addCandidate('top', start.y, displacement.y, maxY, { x: 0, y: -1 });
  }

  if (candidates.length === 0) {
    return [];
  }

  const earliestTime = Math.min(...candidates.map((candidate) => candidate.time));
  const position = {
    x: start.x + displacement.x * earliestTime,
    y: start.y + displacement.y * earliestTime
  };

  return candidates
    .filter((candidate) => Math.abs(candidate.time - earliestTime) <= 1e-9)
    .map((candidate) => ({
      boundary: candidate.boundary,
      time: earliestTime,
      position: { ...position },
      normal: candidate.normal
    }));
}

/**
 * Finds the interval during which a moving circle overlaps a static circle.
 * This helper reports geometry only; callers decide the gameplay consequence.
 */
export function sweepCircleAgainstCircle(
  start: Vec2,
  displacement: Vec2,
  movingRadius: number,
  targetCenter: Vec2,
  targetRadius: number
): SweptCircleCircleInterval | undefined {
  assertCircle(start, movingRadius);
  assertCircle(targetCenter, targetRadius);
  assertDisplacement(displacement);

  const relativeX = start.x - targetCenter.x;
  const relativeY = start.y - targetCenter.y;
  const combinedRadius = movingRadius + targetRadius;
  const c =
    relativeX * relativeX +
    relativeY * relativeY -
    combinedRadius * combinedRadius;
  const a =
    displacement.x * displacement.x +
    displacement.y * displacement.y;

  if (a <= 1e-18) {
    return c <= 1e-9
      ? {
          enterTime: 0,
          exitTime: 1,
          enterPosition: { ...start }
        }
      : undefined;
  }

  const b = 2 * (relativeX * displacement.x + relativeY * displacement.y);
  const discriminant = b * b - 4 * a * c;
  if (discriminant < -1e-9) {
    return undefined;
  }

  const root = Math.sqrt(Math.max(0, discriminant));
  const first = (-b - root) / (2 * a);
  const second = (-b + root) / (2 * a);
  if (second < -1e-9 || first > 1 + 1e-9) {
    return undefined;
  }

  const enterTime = clamp(c <= 1e-9 ? 0 : first, 0, 1);
  const exitTime = clamp(second, 0, 1);
  if (exitTime + 1e-9 < enterTime) {
    return undefined;
  }

  return {
    enterTime,
    exitTime,
    enterPosition: {
      x: start.x + displacement.x * enterTime,
      y: start.y + displacement.y * enterTime
    }
  };
}
