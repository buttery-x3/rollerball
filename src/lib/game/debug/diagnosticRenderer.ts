import * as THREE from 'three';
import type {
  DiagnosticFrame,
  DiagnosticPoint,
  DiagnosticPrimitive
} from '../sim/diagnostics';

const DEFAULT_COLOR = '#e7ecff';
const DIAGNOSTIC_PLANE_HEIGHT = 0.08;
const CIRCLE_SEGMENTS = 32;

export interface DiagnosticRenderer {
  render(frame: DiagnosticFrame): void;
  dispose(): void;
}

function toWorldPoint(point: DiagnosticPoint): THREE.Vector3 {
  return new THREE.Vector3(point.x, DIAGNOSTIC_PLANE_HEIGHT, -point.y);
}

function colorFor(primitive: DiagnosticPrimitive): string {
  return primitive.color ?? DEFAULT_COLOR;
}

function createLine(
  start: DiagnosticPoint,
  end: DiagnosticPoint,
  color: string
): THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial> {
  const geometry = new THREE.BufferGeometry().setFromPoints([
    toWorldPoint(start),
    toWorldPoint(end)
  ]);
  return new THREE.Line(geometry, new THREE.LineBasicMaterial({ color }));
}

function createVector(
  origin: DiagnosticPoint,
  direction: { readonly x: number; readonly y: number },
  color: string
): THREE.ArrowHelper | undefined {
  const worldDirection = new THREE.Vector3(direction.x, 0, -direction.y);
  const length = worldDirection.length();
  if (length === 0) {
    return undefined;
  }

  return new THREE.ArrowHelper(
    worldDirection.normalize(),
    toWorldPoint(origin),
    length,
    color,
    Math.min(length * 0.25, 0.4),
    Math.min(length * 0.15, 0.25)
  );
}

function createCircle(
  center: DiagnosticPoint,
  radius: number,
  color: string
): THREE.LineLoop<THREE.BufferGeometry, THREE.LineBasicMaterial> {
  const safeRadius = Math.max(0, radius);
  const points = Array.from({ length: CIRCLE_SEGMENTS }, (_, index) => {
    const angle = (index / CIRCLE_SEGMENTS) * Math.PI * 2;
    return toWorldPoint({
      x: center.x + Math.cos(angle) * safeRadius,
      y: center.y + Math.sin(angle) * safeRadius
    });
  });
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  return new THREE.LineLoop(geometry, new THREE.LineBasicMaterial({ color }));
}

function createRegion(
  center: DiagnosticPoint,
  width: number,
  height: number,
  color: string
): THREE.LineLoop<THREE.BufferGeometry, THREE.LineBasicMaterial> {
  const halfWidth = Math.max(0, width) / 2;
  const halfHeight = Math.max(0, height) / 2;
  const points = [
    toWorldPoint({ x: center.x - halfWidth, y: center.y - halfHeight }),
    toWorldPoint({ x: center.x + halfWidth, y: center.y - halfHeight }),
    toWorldPoint({ x: center.x + halfWidth, y: center.y + halfHeight }),
    toWorldPoint({ x: center.x - halfWidth, y: center.y + halfHeight })
  ];
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  return new THREE.LineLoop(geometry, new THREE.LineBasicMaterial({ color }));
}

function createLabel(
  position: DiagnosticPoint,
  text: string,
  color: string
): THREE.Sprite | undefined {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 64;
  const context = canvas.getContext('2d');
  if (!context) {
    return undefined;
  }

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.font = '28px sans-serif';
  context.fillStyle = color;
  context.textBaseline = 'middle';
  context.fillText(text, 8, canvas.height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false
  });
  const sprite = new THREE.Sprite(material);
  sprite.position.copy(toWorldPoint(position));
  sprite.position.y = 0.5;
  sprite.scale.set(3.5, 0.45, 1);
  return sprite;
}

function createObject(primitive: DiagnosticPrimitive): THREE.Object3D | undefined {
  const color = colorFor(primitive);

  switch (primitive.type) {
    case 'line':
      return createLine(primitive.start, primitive.end, color);
    case 'vector':
      return createVector(primitive.origin, primitive.direction, color);
    case 'circle':
      return createCircle(primitive.center, primitive.radius, color);
    case 'region':
      return createRegion(primitive.center, primitive.width, primitive.height, color);
    case 'label':
      return createLabel(primitive.position, primitive.text, color);
  }
}

function disposeObject(object: THREE.Object3D): void {
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
    } else {
      if (renderable.material) {
        disposeMaterial(renderable.material);
      }
    }
  });
}

export function createDiagnosticRenderer(scene: THREE.Scene): DiagnosticRenderer {
  const group = new THREE.Group();
  group.name = 'structured-diagnostics';
  scene.add(group);
  let objects: THREE.Object3D[] = [];
  let renderedFrame: DiagnosticFrame | undefined;

  const clear = (): void => {
    for (const object of objects) {
      group.remove(object);
      disposeObject(object);
    }
    objects = [];
  };

  return {
    render(frame: DiagnosticFrame): void {
      if (frame === renderedFrame) {
        return;
      }

      clear();
      for (const record of frame.records) {
        const object = createObject(record.primitive);
        if (!object) {
          continue;
        }

        object.userData.diagnosticLayer = record.layer;
        object.userData.diagnosticSource = record.source;
        object.userData.diagnosticEntityId = record.entityId;
        group.add(object);
        objects.push(object);
      }
      renderedFrame = frame;
    },

    dispose(): void {
      clear();
      renderedFrame = undefined;
      scene.remove(group);
    }
  };
}
