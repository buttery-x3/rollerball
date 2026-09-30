import {
  constrainCircleToBounds,
  removeOutwardVelocity,
  sweepCircleAgainstCircle,
  type AxisAlignedBounds,
  type Vec2
} from './geometry';

const EPSILON = 1e-8;
// Numerical convergence limit, independent of gameplay impact/strength tuning.
const MAX_SOLVER_PASSES = 96;

export interface ContactBody {
  readonly id: string;
  readonly previousPosition: Vec2;
  readonly position: Vec2;
  readonly velocity: Vec2;
  readonly radius: number;
  readonly bounds: AxisAlignedBounds;
}

export interface PlayerContact {
  readonly firstId: string;
  readonly secondId: string;
  /** Unit direction from the first body towards the second at contact. */
  readonly normal: Vec2;
  readonly point: Vec2;
  readonly penetration: number;
  readonly time: number;
  readonly firstVelocity: Vec2;
  readonly secondVelocity: Vec2;
  /** Second minus first, sampled before any response to this pair. */
  readonly relativeVelocity: Vec2;
  readonly closingSpeed: number;
  readonly separation: number;
  /** Total normal velocity change applied to each unit-mass body. */
  readonly velocityResponse: number;
}

interface MutableBody extends ContactBody {
  position: Vec2;
  velocity: Vec2;
}

interface MutableContact extends PlayerContact {
  separation: number;
  velocityResponse: number;
}

export interface PlayerContactResult {
  readonly bodies: readonly ContactBody[];
  readonly contacts: readonly PlayerContact[];
}

function difference(first: Vec2, second: Vec2): Vec2 {
  return { x: first.x - second.x, y: first.y - second.y };
}

function dot(first: Vec2, second: Vec2): number {
  return first.x * second.x + first.y * second.y;
}

function normalBetween(first: Vec2, second: Vec2, fallback: Vec2): Vec2 {
  const delta = difference(second, first);
  const distance = Math.hypot(delta.x, delta.y);
  if (distance > EPSILON) {
    return { x: delta.x / distance, y: delta.y / distance };
  }
  const fallbackLength = Math.hypot(fallback.x, fallback.y);
  return fallbackLength > EPSILON
    ? { x: fallback.x / fallbackLength, y: fallback.y / fallbackLength }
    : { x: 1, y: 0 };
}

function constrainBody(body: MutableBody): void {
  const constrained = constrainCircleToBounds(body.position, body.radius, body.bounds);
  body.position = constrained.position;
  body.velocity = removeOutwardVelocity(body.velocity, constrained.contacts);
}

/** Equal-mass circle response. No intent, role, stat or sporting rules enter here. */
export function resolvePlayerCircleContacts(
  inputBodies: readonly ContactBody[],
  restitution: number
): PlayerContactResult {
  if (!Number.isFinite(restitution) || restitution < 0 || restitution > 1) {
    throw new RangeError('Contact restitution must be between zero and one.');
  }
  const bodies: MutableBody[] = inputBodies.map((body) => ({
    ...body,
    position: { ...body.position },
    velocity: { ...body.velocity }
  })).sort((first, second) => first.id < second.id ? -1 : first.id > second.id ? 1 : 0);
  for (const body of bodies) {
    constrainBody(body);
  }
  const contacts = new Map<string, MutableContact>();

  for (let pass = 0; pass < MAX_SOLVER_PASSES; pass += 1) {
    let maximumCorrection = 0;
    let maximumVelocityResponse = 0;
    for (let firstIndex = 0; firstIndex < bodies.length; firstIndex += 1) {
      for (let secondIndex = firstIndex + 1; secondIndex < bodies.length; secondIndex += 1) {
        const first = bodies[firstIndex];
        const second = bodies[secondIndex];
        const radius = first.radius + second.radius;
        const delta = difference(second.position, first.position);
        const distance = Math.hypot(delta.x, delta.y);
        const priorDelta = difference(second.previousPosition, first.previousPosition);
        // Exact coincidence has no geometric normal. A stable pair-dependent
        // direction separates a cluster in the plane, avoiding a line jam.
        const fallback = Math.hypot(priorDelta.x, priorDelta.y) > EPSILON
          ? priorDelta
          : { x: Math.cos(secondIndex * 2.4 + firstIndex), y: Math.sin(secondIndex * 2.4 + firstIndex) };
        let normal = normalBetween(first.position, second.position, fallback);
        let penetration = radius - distance;
        let time = 1;
        let firstAtContact = first.position;

        // A relative sweep also covers small-radius/high-speed players crossing
        // between ticks. Later passes only resolve the updated overlap geometry.
        if (pass === 0 && Math.hypot(priorDelta.x, priorDelta.y) > radius + EPSILON) {
          const firstMove = difference(first.position, first.previousPosition);
          const secondMove = difference(second.position, second.previousPosition);
          const sweep = sweepCircleAgainstCircle(
            first.previousPosition,
            difference(firstMove, secondMove),
            first.radius,
            second.previousPosition,
            second.radius
          );
          if (sweep) {
            time = sweep.enterTime;
            firstAtContact = {
              x: first.previousPosition.x + firstMove.x * time,
              y: first.previousPosition.y + firstMove.y * time
            };
            const secondAtContact = {
              x: second.previousPosition.x + secondMove.x * time,
              y: second.previousPosition.y + secondMove.y * time
            };
            normal = normalBetween(firstAtContact, secondAtContact, priorDelta);
            penetration = radius - dot(delta, normal);
          }
        }
        if (penetration < -EPSILON) {
          continue;
        }

        const key = `${firstIndex}:${secondIndex}`;
        let contact = contacts.get(key);
        const relativeVelocity = difference(second.velocity, first.velocity);
        const closingSpeed = Math.max(0, -dot(relativeVelocity, normal));
        const firstContact = contact === undefined;
        if (!contact) {
          contact = {
            firstId: first.id,
            secondId: second.id,
            normal,
            point: {
              x: firstAtContact.x + normal.x * first.radius,
              y: firstAtContact.y + normal.y * first.radius
            },
            penetration: Math.max(0, penetration),
            time,
            firstVelocity: { ...first.velocity },
            secondVelocity: { ...second.velocity },
            relativeVelocity,
            closingSpeed,
            separation: 0,
            velocityResponse: 0
          };
          contacts.set(key, contact);
        }

        const correction = Math.max(0, penetration) / 2;
        first.position = {
          x: first.position.x - normal.x * correction,
          y: first.position.y - normal.y * correction
        };
        second.position = {
          x: second.position.x + normal.x * correction,
          y: second.position.y + normal.y * correction
        };
        // Restitution is applied once per pair; subsequent solver passes only
        // remove new closing motion. Position correction never adds velocity.
        const response = closingSpeed * (firstContact ? 1 + restitution : 1) / 2;
        first.velocity = {
          x: first.velocity.x - normal.x * response,
          y: first.velocity.y - normal.y * response
        };
        second.velocity = {
          x: second.velocity.x + normal.x * response,
          y: second.velocity.y + normal.y * response
        };
        contact.separation += correction * 2;
        contact.velocityResponse += response;
        maximumCorrection = Math.max(maximumCorrection, correction);
        maximumVelocityResponse = Math.max(maximumVelocityResponse, response);
        // Pair correction can press another player into a board. Reprojecting
        // each pass converges the contacts and board constraint together.
        constrainBody(first);
        constrainBody(second);
      }
    }
    if (maximumCorrection <= EPSILON && maximumVelocityResponse <= EPSILON) {
      break;
    }
  }

  return { bodies, contacts: [...contacts.values()] };
}
