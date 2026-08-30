import * as THREE from 'three';
import { createArenaDiagnosticRecords } from '../sim/arenaDiagnostics';
import { ARENA_DIAGNOSTIC_LAYER } from '../sim/diagnostics';
import type { DiagnosticFrame } from '../sim/diagnostics';
import type { ArenaDefinition } from '../physics/arena';
import type { GameState } from '../sim/gameState';
import { createDiagnosticRenderer } from '../debug/diagnosticRenderer';

const RENDER_PADDING = 2;
const EMPTY_DIAGNOSTIC_FRAME: DiagnosticFrame = { tick: 0, records: [] };

export interface ArenaRenderer {
  render(
    state: GameState,
    alpha: number,
    diagnostics?: DiagnosticFrame,
    arenaDiagnosticsEnabled?: boolean
  ): void;
  setArena(arena: ArenaDefinition): void;
  dispose(): void;
}

function arenaSignature(arena: ArenaDefinition): string {
  return JSON.stringify({
    width: arena.width,
    length: arena.length,
    bounds: arena.bounds,
    goals: arena.goals,
    keeperCreases: arena.keeperCreases,
    restartSpawns: arena.restartSpawns
  });
}

function toWorldPoint(x: number, y: number): THREE.Vector3 {
  return new THREE.Vector3(x, 0, -y);
}

function createLine(
  start: THREE.Vector3,
  end: THREE.Vector3,
  color: string
): THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial> {
  const geometry = new THREE.BufferGeometry().setFromPoints([start, end]);
  return new THREE.Line(geometry, new THREE.LineBasicMaterial({ color }));
}

function disposeObject(object: THREE.Object3D): void {
  const renderable = object as THREE.Object3D & {
    geometry?: THREE.BufferGeometry;
    material?: THREE.Material | THREE.Material[];
  };

  renderable.geometry?.dispose();
  if (Array.isArray(renderable.material)) {
    for (const material of renderable.material) {
      material.dispose();
    }
  } else {
    renderable.material?.dispose();
  }
}

export function createArenaRenderer(
  container: HTMLElement,
  initialArena: ArenaDefinition
): ArenaRenderer {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#0b1020');

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  container.appendChild(renderer.domElement);

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  camera.position.set(0, 30, 0);
  camera.up.set(0, 0, -1);
  camera.lookAt(0, 0, 0);

  const diagnosticRenderer = createDiagnosticRenderer(scene);
  const arenaGroup = new THREE.Group();
  arenaGroup.name = 'arena-presentation';
  scene.add(arenaGroup);

  let arena = initialArena;
  let signature = arenaSignature(arena);
  let arenaObjects: THREE.Object3D[] = [];
  let arenaDiagnosticRecords = createArenaDiagnosticRecords(arena);
  let composedFrame: DiagnosticFrame | undefined;
  let composedSourceFrame: DiagnosticFrame | undefined;
  let composedArenaDiagnosticsEnabled: boolean | undefined;

  const clearArenaObjects = (): void => {
    for (const object of arenaObjects) {
      arenaGroup.remove(object);
      disposeObject(object);
    }
    arenaObjects = [];
  };

  const rebuildArenaObjects = (): void => {
    clearArenaObjects();

    const { bounds } = arena;
    const groundGeometry = new THREE.PlaneGeometry(
      bounds.maxX - bounds.minX,
      bounds.maxY - bounds.minY
    );
    const groundMaterial = new THREE.MeshBasicMaterial({ color: '#17233d' });
    const ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    arenaGroup.add(ground);
    arenaObjects.push(ground);

    const centerLine = createLine(
      toWorldPoint(bounds.minX, 0),
      toWorldPoint(bounds.maxX, 0),
      '#40557d'
    );
    arenaGroup.add(centerLine);
    arenaObjects.push(centerLine);
  };

  const resize = (): void => {
    const width = Math.max(container.clientWidth, 1);
    const height = Math.max(container.clientHeight, 1);
    const aspect = width / height;
    const arenaHalfHeight = (arena.bounds.maxY - arena.bounds.minY) / 2;
    const arenaHalfWidth = (arena.bounds.maxX - arena.bounds.minX) / 2;
    const halfHeight = Math.max(
      arenaHalfHeight + RENDER_PADDING,
      (arenaHalfWidth + RENDER_PADDING) / aspect
    );

    renderer.setSize(width, height, false);
    camera.left = -halfHeight * aspect;
    camera.right = halfHeight * aspect;
    camera.top = halfHeight;
    camera.bottom = -halfHeight;
    camera.updateProjectionMatrix();
  };

  rebuildArenaObjects();

  let resizeObserver: ResizeObserver | undefined;
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);
  } else {
    window.addEventListener('resize', resize);
  }
  resize();

  const composeDiagnostics = (
    diagnostics: DiagnosticFrame,
    arenaDiagnosticsEnabled: boolean
  ): DiagnosticFrame => {
    if (
      composedFrame &&
      composedSourceFrame === diagnostics &&
      composedArenaDiagnosticsEnabled === arenaDiagnosticsEnabled
    ) {
      return composedFrame;
    }

    const dynamicRecords = diagnostics.records.filter(
      (record) => record.layer !== ARENA_DIAGNOSTIC_LAYER
    );
    composedFrame = {
      tick: diagnostics.tick,
      records: arenaDiagnosticsEnabled
        ? [...arenaDiagnosticRecords, ...dynamicRecords]
        : dynamicRecords
    };
    composedSourceFrame = diagnostics;
    composedArenaDiagnosticsEnabled = arenaDiagnosticsEnabled;
    return composedFrame;
  };

  return {
    render(
      _state: GameState,
      _alpha: number,
      diagnostics: DiagnosticFrame = EMPTY_DIAGNOSTIC_FRAME,
      arenaDiagnosticsEnabled = true
    ): void {
      diagnosticRenderer.render(composeDiagnostics(diagnostics, arenaDiagnosticsEnabled));
      renderer.render(scene, camera);
    },

    setArena(nextArena: ArenaDefinition): void {
      const nextSignature = arenaSignature(nextArena);
      if (nextSignature === signature) {
        return;
      }

      arena = nextArena;
      signature = nextSignature;
      arenaDiagnosticRecords = createArenaDiagnosticRecords(arena);
      composedFrame = undefined;
      rebuildArenaObjects();
      resize();
    },

    dispose(): void {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', resize);
      diagnosticRenderer.dispose();
      clearArenaObjects();
      scene.remove(arenaGroup);
      renderer.dispose();
      renderer.domElement.remove();
    }
  };
}
