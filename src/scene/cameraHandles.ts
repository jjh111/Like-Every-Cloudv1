import { Mesh, MeshBasicMaterial, type Scene, SphereGeometry, type Vector3 } from 'three';

// Colored sphere markers for the exterior camera pose + the doorway tween
// waypoint. Hidden by default; the dev panel surfaces them as gizmo targets.
// The marker's position vector is the source of truth — `syncToSources()`
// every tick mirrors it back into the caller's Vector3s (exteriorPos, doorway)
// so dragging the gizmo flows through the tween + save pipeline.
export interface CameraHandles {
  exteriorMarker: Mesh;
  doorwayMarker: Mesh;
  /** Show one marker, hide the other (or both hidden if id === '(none)'). */
  setVisible(id: '(none)' | 'exterior' | 'doorway'): void;
  /** Hide every marker. Used by the global detachGizmos in app.ts. */
  hideAll(): void;
  /** Per-tick: copy marker.position back into the source vectors if changed. */
  syncToSources(): void;
}

const makeHandle = (color: number, scene: Scene, at: Vector3): Mesh => {
  const m = new Mesh(
    new SphereGeometry(0.09, 14, 12),
    new MeshBasicMaterial({
      color,
      depthTest: false,
      transparent: true,
      opacity: 0.85,
    }),
  );
  m.renderOrder = 100;
  m.visible = false;
  m.position.copy(at);
  scene.add(m);
  return m;
};

export function createCameraHandles(
  scene: Scene,
  exteriorPos: Vector3,
  doorway: Vector3,
): CameraHandles {
  // Green = exterior, cyan = doorway.
  const exteriorMarker = makeHandle(0x4dffa6, scene, exteriorPos);
  const doorwayMarker = makeHandle(0x4dc8ff, scene, doorway);

  const setVisible = (id: '(none)' | 'exterior' | 'doorway'): void => {
    exteriorMarker.visible = id === 'exterior';
    doorwayMarker.visible = id === 'doorway';
  };

  const hideAll = (): void => {
    exteriorMarker.visible = false;
    doorwayMarker.visible = false;
  };

  const syncToSources = (): void => {
    if (!exteriorPos.equals(exteriorMarker.position)) exteriorPos.copy(exteriorMarker.position);
    if (!doorway.equals(doorwayMarker.position)) doorway.copy(doorwayMarker.position);
  };

  return { exteriorMarker, doorwayMarker, setVisible, hideAll, syncToSources };
}
