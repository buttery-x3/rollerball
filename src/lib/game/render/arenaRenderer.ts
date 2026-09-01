import * as THREE from 'three';
import { DEFAULT_BALL_RADIUS, DEFAULT_PLAYER_RADIUS } from '../config/tuning';
import { createArenaDiagnosticRecords } from '../sim/arenaDiagnostics';
import { ARENA_DIAGNOSTIC_LAYER } from '../sim/diagnostics';
import type { DiagnosticFrame } from '../sim/diagnostics';
import type { ArenaDefinition } from '../physics/arena';
import type { GameState } from '../sim/gameState';
import { createDiagnosticRenderer } from '../debug/diagnosticRenderer';
import {
  createArenaCameraController,
  type ArenaCameraFraming
} from './arenaCameraController';

const EMPTY_DIAGNOSTIC_FRAME: DiagnosticFrame = { tick: 0, records: [] };

export interface ArenaRenderer {
  render(
    state: GameState,
    alpha: number,
    diagnostics?: DiagnosticFrame,
    arenaDiagnosticsEnabled?: boolean,
    playerRadius?: number,
    ballRadius?: number
  ): void;
  setArena(arena: ArenaDefinition): void;
  setCameraFraming(framing: ArenaCameraFraming): void;
  fitArena(): void;
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

interface PlayerPresentation {
  readonly root: THREE.Group;
  readonly radius: number;
}

interface BallPresentation {
  readonly mesh: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  readonly radius: number;
}

function playerColor(teamId: string): string {
  return teamId === 'human' ? '#f6c177' : '#eb6f92';
}

function createPlayerPresentation(
  radius: number,
  color: string
): PlayerPresentation {
  const safeRadius = Math.max(0, radius);
  const root = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(safeRadius, safeRadius, 0.24, 32),
    new THREE.MeshBasicMaterial({ color })
  );
  body.position.y = 0.12;
  root.add(body);

  const heading = createLine(
    new THREE.Vector3(0, 0.27, 0),
    new THREE.Vector3(safeRadius * 1.35, 0.27, 0),
    '#e7ecff'
  );
  root.add(heading);

  return { root, radius: safeRadius };
}

function createBallPresentation(radius: number): BallPresentation {
  const safeRadius = Math.max(0.01, radius);
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(safeRadius, 24, 16),
    new THREE.MeshBasicMaterial({ color: '#f6c177' })
  );
  return { mesh, radius: safeRadius };
}

export function disposeObject(object: THREE.Object3D): void {
  const disposeMaterial = (material: THREE.Material): void => {
    const texturedMaterial = material as THREE.Material & {
      map?: THREE.Texture | null;
    };
    texturedMaterial.map?.dispose();
    material.dispose();
  };

  object.traverse((child) => {
    const renderable = child as THREE.Object3D & {
      geometry?: THREE.BufferGeometry;
      material?: THREE.Material | THREE.Material[];
    };

    renderable.geometry?.dispose();
    if (Array.isArray(renderable.material)) {
      for (const material of renderable.material) {
        disposeMaterial(material);
      }
    } else if (renderable.material) {
      disposeMaterial(renderable.material);
    }
  });
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

  const cameraController = createArenaCameraController(initialArena);
  const camera = cameraController.camera;

  const diagnosticRenderer = createDiagnosticRenderer(scene);
  const arenaGroup = new THREE.Group();
  arenaGroup.name = 'arena-presentation';
  scene.add(arenaGroup);
  const playerGroup = new THREE.Group();
  playerGroup.name = 'players-presentation';
  scene.add(playerGroup);
  const ballGroup = new THREE.Group();
  ballGroup.name = 'ball-presentation';
  scene.add(ballGroup);

  let arena = initialArena;
  let signature = arenaSignature(arena);
  let arenaObjects: THREE.Object3D[] = [];
  let playerObjects = new Map<string, PlayerPresentation>();
  let ballPresentation: BallPresentation | undefined;
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

  const clearPlayerObjects = (): void => {
    for (const presentation of playerObjects.values()) {
      playerGroup.remove(presentation.root);
      disposeObject(presentation.root);
    }
    playerObjects = new Map();
  };

  const clearBallObject = (): void => {
    if (!ballPresentation) {
      return;
    }

    ballGroup.remove(ballPresentation.mesh);
    disposeObject(ballPresentation.mesh);
    ballPresentation = undefined;
  };

  const syncBall = (state: GameState, radius: number): void => {
    if (state.ball.mode !== 'loose') {
      if (ballPresentation) {
        ballPresentation.mesh.visible = false;
      }
      return;
    }

    const safeRadius = Math.max(0.01, radius);
    if (!ballPresentation || ballPresentation.radius !== safeRadius) {
      clearBallObject();
      ballPresentation = createBallPresentation(safeRadius);
      ballGroup.add(ballPresentation.mesh);
    }

    ballPresentation.mesh.visible = true;
    ballPresentation.mesh.position.set(
      state.ball.position.x,
      state.ball.height + safeRadius,
      -state.ball.position.y
    );
  };

  const syncPlayers = (state: GameState, radius: number): void => {
    const activePlayerIds = new Set<string>();
    const safeRadius = Math.max(0, radius);

    for (const player of state.players) {
      const playerId = player.definition.id;
      activePlayerIds.add(playerId);
      let presentation = playerObjects.get(playerId);

      if (!presentation || presentation.radius !== safeRadius) {
        if (presentation) {
          playerGroup.remove(presentation.root);
          disposeObject(presentation.root);
        }

        presentation = createPlayerPresentation(
          safeRadius,
          playerColor(player.definition.teamId)
        );
        playerObjects.set(playerId, presentation);
        playerGroup.add(presentation.root);
      }

      presentation.root.position.set(player.position.x, 0, -player.position.y);
      presentation.root.rotation.y = Math.atan2(player.facing.y, player.facing.x);
    }

    for (const [playerId, presentation] of playerObjects) {
      if (activePlayerIds.has(playerId)) {
        continue;
      }

      playerGroup.remove(presentation.root);
      disposeObject(presentation.root);
      playerObjects.delete(playerId);
    }
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

    renderer.setSize(width, height, false);
    cameraController.setViewport(width, height);
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
      state: GameState,
      _alpha: number,
      diagnostics: DiagnosticFrame = EMPTY_DIAGNOSTIC_FRAME,
      arenaDiagnosticsEnabled = true,
      playerRadius = DEFAULT_PLAYER_RADIUS,
      ballRadius = DEFAULT_BALL_RADIUS
    ): void {
      syncPlayers(state, playerRadius);
      syncBall(state, ballRadius);
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
      cameraController.setArena(arena);
      rebuildArenaObjects();
      resize();
    },

    setCameraFraming(framing: ArenaCameraFraming): void {
      cameraController.setFraming(framing);
    },

    fitArena(): void {
      cameraController.fitArena();
    },

    dispose(): void {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', resize);
      diagnosticRenderer.dispose();
      clearArenaObjects();
      clearPlayerObjects();
      clearBallObject();
      scene.remove(arenaGroup);
      scene.remove(playerGroup);
      scene.remove(ballGroup);
      renderer.dispose();
      renderer.domElement.remove();
    }
  };
}
