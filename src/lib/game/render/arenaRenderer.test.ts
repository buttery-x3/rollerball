import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { disposeObject } from './arenaRenderer';

describe('arena renderer resource disposal', () => {
  it('disposes geometry and materials on player presentation descendants', () => {
    const root = new THREE.Group();
    const bodyGeometry = new THREE.CylinderGeometry(0.75, 0.75, 0.24, 8);
    const bodyMaterial = new THREE.MeshBasicMaterial({ color: '#f6c177' });
    const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
    const headingGeometry = new THREE.BufferGeometry();
    const headingMaterial = new THREE.LineBasicMaterial({ color: '#e7ecff' });
    const heading = new THREE.Line(headingGeometry, headingMaterial);
    root.add(body, heading);

    const bodyGeometryDispose = vi.spyOn(bodyGeometry, 'dispose');
    const bodyMaterialDispose = vi.spyOn(bodyMaterial, 'dispose');
    const headingGeometryDispose = vi.spyOn(headingGeometry, 'dispose');
    const headingMaterialDispose = vi.spyOn(headingMaterial, 'dispose');

    disposeObject(root);

    expect(bodyGeometryDispose).toHaveBeenCalledOnce();
    expect(bodyMaterialDispose).toHaveBeenCalledOnce();
    expect(headingGeometryDispose).toHaveBeenCalledOnce();
    expect(headingMaterialDispose).toHaveBeenCalledOnce();
  });
});
