import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createTuningRegistry } from '../config/tuning';
import { createArenaDefinition } from '../physics/arena';
import {
  createArenaCameraController,
  type ArenaCameraController
} from './arenaCameraController';

function createController(): ArenaCameraController {
  return createArenaCameraController(createArenaDefinition(createTuningRegistry()));
}

function createArenaWithDimensions(width: number, length: number) {
  const tuning = createTuningRegistry();
  tuning.setOverride('arena.width', width);
  tuning.setOverride('arena.length', length);
  return createArenaDefinition(tuning);
}

describe('arena camera controller', () => {
  it('keeps the fixed top-down orientation with positive simulation Y upward on screen', () => {
    const controller = createController();
    controller.setViewport(900, 600);

    const { camera } = controller;
    const direction = new THREE.Vector3();
    camera.getWorldDirection(direction);
    camera.updateMatrixWorld();

    const origin = new THREE.Vector3(0, 0, 0).project(camera);
    const positiveY = new THREE.Vector3(0, 0, -1).project(camera);

    expect(camera.position.x).toBeCloseTo(0);
    expect(camera.position.y).toBeCloseTo(30);
    expect(camera.position.z).toBeCloseTo(0);
    expect(camera.up.toArray()).toEqual([0, 0, -1]);
    expect(direction.x).toBeCloseTo(0);
    expect(direction.y).toBeCloseTo(-1);
    expect(direction.z).toBeCloseTo(0);
    expect(positiveY.y).toBeGreaterThan(origin.y);
  });

  it('fits the complete arena without distortion for different viewport aspects', () => {
    const controller = createController();
    const arena = createArenaDefinition(createTuningRegistry());

    controller.setViewport(1200, 600);
    expect(controller.getFraming()).toEqual({ center: { x: 0, y: 0 }, zoom: 1 });
    expect(controller.camera.left).toBeCloseTo(-34);
    expect(controller.camera.right).toBeCloseTo(34);
    expect(controller.camera.top).toBeCloseTo(17);
    expect(controller.camera.bottom).toBeCloseTo(-17);

    controller.setViewport(600, 1200);
    expect(controller.camera.left).toBeCloseTo(-11);
    expect(controller.camera.right).toBeCloseTo(11);
    expect(controller.camera.top).toBeCloseTo(22);
    expect(controller.camera.bottom).toBeCloseTo(-22);
    expect(controller.camera.right).toBeGreaterThanOrEqual(arena.bounds.maxX);
    expect(controller.camera.left).toBeLessThanOrEqual(arena.bounds.minX);
    expect(controller.camera.top).toBeGreaterThanOrEqual(arena.bounds.maxY);
    expect(controller.camera.bottom).toBeLessThanOrEqual(arena.bounds.minY);
  });

  it('supports explicit presentation centre and zoom without changing the arena state', () => {
    const controller = createController();

    controller.setViewport(900, 600);
    controller.setFraming({ center: { x: 3, y: -4 }, zoom: 2 });

    expect(controller.getFraming()).toEqual({ center: { x: 3, y: -4 }, zoom: 2 });
    expect(controller.camera.position.toArray()).toEqual([3, 30, 4]);
    expect(controller.camera.zoom).toBe(2);
  });

  it('recomputes fit framing when the arena changes and can restore fit after explicit framing', () => {
    const controller = createController();
    controller.setViewport(1200, 600);
    controller.setArena(createArenaWithDimensions(24, 40));

    expect(controller.getFraming()).toEqual({ center: { x: 0, y: 0 }, zoom: 1 });
    expect(controller.camera.top).toBeCloseTo(22);

    controller.setFraming({ center: { x: 2, y: 3 }, zoom: 1.5 });
    controller.setArena(createArenaWithDimensions(30, 50));
    expect(controller.getFraming()).toEqual({ center: { x: 2, y: 3 }, zoom: 1.5 });

    controller.fitArena();
    expect(controller.getFraming()).toEqual({ center: { x: 0, y: 0 }, zoom: 1 });
    expect(controller.camera.position.x).toBeCloseTo(0);
    expect(controller.camera.position.y).toBeCloseTo(30);
    expect(controller.camera.position.z).toBeCloseTo(0);
  });

  it('rejects invalid viewport and framing values', () => {
    const controller = createController();

    expect(() => controller.setViewport(0, 600)).toThrow('Camera viewport width must be positive.');
    expect(() => controller.setViewport(900, Number.NaN)).toThrow(
      'Camera viewport height must be finite.'
    );
    expect(() => controller.setFraming({ center: { x: 0, y: 0 }, zoom: 0 })).toThrow(
      'Camera framing zoom must be positive.'
    );
  });
});
