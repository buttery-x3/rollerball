import * as THREE from 'three';
import type { ArenaDefinition } from '../physics/arena';
import type { Vec2 } from '../physics/geometry';

const CAMERA_HEIGHT = 30;
const CAMERA_NEAR = 0.1;
const CAMERA_FAR = 100;
const RENDER_PADDING = 2;

export interface ArenaCameraFraming {
  readonly center: Vec2;
  readonly zoom: number;
}

export interface ArenaCameraController {
  readonly camera: THREE.OrthographicCamera;
  setArena(arena: ArenaDefinition): void;
  setViewport(width: number, height: number): void;
  setFraming(framing: ArenaCameraFraming): void;
  fitArena(): void;
  getFraming(): ArenaCameraFraming;
}

function assertFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${name} must be finite.`);
  }
}

function assertViewportDimension(value: number, name: string): void {
  assertFinite(value, name);
  if (value <= 0) {
    throw new RangeError(`${name} must be positive.`);
  }
}

function assertFraming(framing: ArenaCameraFraming): void {
  assertFinite(framing.center.x, 'Camera framing centre x');
  assertFinite(framing.center.y, 'Camera framing centre y');
  assertFinite(framing.zoom, 'Camera framing zoom');
  if (framing.zoom <= 0) {
    throw new RangeError('Camera framing zoom must be positive.');
  }
}

function arenaCentre(arena: ArenaDefinition): Vec2 {
  return {
    x: (arena.bounds.minX + arena.bounds.maxX) / 2,
    y: (arena.bounds.minY + arena.bounds.maxY) / 2
  };
}

function copyFraming(framing: ArenaCameraFraming): ArenaCameraFraming {
  return {
    center: { ...framing.center },
    zoom: framing.zoom
  };
}

export function createArenaCameraController(
  initialArena: ArenaDefinition
): ArenaCameraController {
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, CAMERA_NEAR, CAMERA_FAR);
  camera.up.set(0, 0, -1);

  let arena = initialArena;
  let viewportWidth = 1;
  let viewportHeight = 1;
  let framing: ArenaCameraFraming = { center: arenaCentre(arena), zoom: 1 };
  let fittingArena = true;

  const updateCamera = (): void => {
    const aspect = viewportWidth / viewportHeight;
    const arenaHalfHeight = (arena.bounds.maxY - arena.bounds.minY) / 2;
    const arenaHalfWidth = (arena.bounds.maxX - arena.bounds.minX) / 2;
    const halfHeight = Math.max(
      arenaHalfHeight + RENDER_PADDING,
      (arenaHalfWidth + RENDER_PADDING) / aspect
    );

    camera.left = -halfHeight * aspect;
    camera.right = halfHeight * aspect;
    camera.top = halfHeight;
    camera.bottom = -halfHeight;
    camera.zoom = framing.zoom;
    camera.position.set(framing.center.x, CAMERA_HEIGHT, -framing.center.y);
    camera.lookAt(framing.center.x, 0, -framing.center.y);
    camera.updateProjectionMatrix();
  };

  updateCamera();

  return {
    camera,

    setArena(nextArena: ArenaDefinition): void {
      arena = nextArena;
      if (fittingArena) {
        framing = { center: arenaCentre(arena), zoom: 1 };
      }
      updateCamera();
    },

    setViewport(width: number, height: number): void {
      assertViewportDimension(width, 'Camera viewport width');
      assertViewportDimension(height, 'Camera viewport height');
      viewportWidth = width;
      viewportHeight = height;
      updateCamera();
    },

    setFraming(nextFraming: ArenaCameraFraming): void {
      assertFraming(nextFraming);
      framing = copyFraming(nextFraming);
      fittingArena = false;
      updateCamera();
    },

    fitArena(): void {
      fittingArena = true;
      framing = { center: arenaCentre(arena), zoom: 1 };
      updateCamera();
    },

    getFraming(): ArenaCameraFraming {
      return copyFraming(framing);
    }
  };
}
