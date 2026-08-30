import * as THREE from 'three';
import { createDiagnosticRenderer } from '../debug/diagnosticRenderer';
import type { DiagnosticFrame } from '../sim/diagnostics';
import type { GameState } from '../sim/gameState';

const REFERENCE_ARENA = {
  width: 18,
  length: 30,
  padding: 2
};
const EMPTY_DIAGNOSTIC_FRAME: DiagnosticFrame = { tick: 0, records: [] };

export interface ArenaRenderer {
  render(state: GameState, alpha: number, diagnostics?: DiagnosticFrame): void;
  dispose(): void;
}

export function createArenaRenderer(container: HTMLElement): ArenaRenderer {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#0b1020');

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  container.appendChild(renderer.domElement);

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  camera.position.set(0, 30, 0);
  camera.up.set(0, 0, -1);
  camera.lookAt(0, 0, 0);

  const groundGeometry = new THREE.PlaneGeometry(
    REFERENCE_ARENA.width,
    REFERENCE_ARENA.length
  );
  const groundMaterial = new THREE.MeshBasicMaterial({ color: '#17233d' });
  const ground = new THREE.Mesh(groundGeometry, groundMaterial);
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  const diagnosticRenderer = createDiagnosticRenderer(scene);

  const halfWidth = REFERENCE_ARENA.width / 2;
  const halfLength = REFERENCE_ARENA.length / 2;
  const boundaryGeometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-halfWidth, 0, -halfLength),
    new THREE.Vector3(halfWidth, 0, -halfLength),
    new THREE.Vector3(halfWidth, 0, halfLength),
    new THREE.Vector3(-halfWidth, 0, halfLength)
  ]);
  const boundaryMaterial = new THREE.LineBasicMaterial({ color: '#7aa2f7' });
  const boundary = new THREE.LineLoop(boundaryGeometry, boundaryMaterial);
  scene.add(boundary);

  const centerLineGeometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-halfWidth, 0, 0),
    new THREE.Vector3(halfWidth, 0, 0)
  ]);
  const centerLineMaterial = new THREE.LineBasicMaterial({ color: '#40557d' });
  const centerLine = new THREE.Line(centerLineGeometry, centerLineMaterial);
  scene.add(centerLine);

  const resize = (): void => {
    const width = Math.max(container.clientWidth, 1);
    const height = Math.max(container.clientHeight, 1);
    const aspect = width / height;
    const halfHeight = Math.max(
      REFERENCE_ARENA.length / 2 + REFERENCE_ARENA.padding,
      (REFERENCE_ARENA.width / 2 + REFERENCE_ARENA.padding) / aspect
    );

    renderer.setSize(width, height, false);
    camera.left = -halfHeight * aspect;
    camera.right = halfHeight * aspect;
    camera.top = halfHeight;
    camera.bottom = -halfHeight;
    camera.updateProjectionMatrix();
  };

  let resizeObserver: ResizeObserver | undefined;
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);
  } else {
    window.addEventListener('resize', resize);
  }
  resize();

  return {
    render(
      _state: GameState,
      _alpha: number,
      diagnostics: DiagnosticFrame = EMPTY_DIAGNOSTIC_FRAME
    ): void {
      diagnosticRenderer.render(diagnostics);
      renderer.render(scene, camera);
    },

    dispose(): void {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', resize);
      diagnosticRenderer.dispose();
      groundGeometry.dispose();
      groundMaterial.dispose();
      boundaryGeometry.dispose();
      boundaryMaterial.dispose();
      centerLineGeometry.dispose();
      centerLineMaterial.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    }
  };
}
