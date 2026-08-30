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
