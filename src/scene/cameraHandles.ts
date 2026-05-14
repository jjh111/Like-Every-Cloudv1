import { Mesh, MeshBasicMaterial, type Scene, SphereGeometry, Vector3 } from 'three';

// Colored sphere markers for the exterior camera pose + the doorway tween
// waypoint. Hidden by default; the dev panel surfaces them as gizmo targets.
//
// Bidirectional sync: dragging the gizmo (marker → vector) and external
// mutation of the vector (e.g. saveCurrentAsDoorway → vector → marker) both
// flow through `syncToSources()`. We attribute direction by tracking each
// marker's last-known position — if the marker moved since the last tick,
// the gizmo is dragging it; otherwise any vector-vs-marker mismatch means
// the vector was changed externally and the marker should follow.
//
// Without this, a save that mutates the doorway Vector3 lasts only one
// tick before the marker (still at the old position) clobbers it back.
export interface CameraHandles {
  exteriorMarker: Mesh;
  doorwayMarker: Mesh;
  /** Show one marker, hide the other (or both hidden if id === '(none)'). */
  setVisible(id: '(none)' | 'exterior' | 'doorway'): void;
  /** Hide every marker. Used by the global detachGizmos in app.ts. */
  hideAll(): void;
  /** Per-tick: keep marker.position and the source vectors in sync. */
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

  // Last-seen marker positions for direction attribution. If the marker
  // moved between ticks, the gizmo dragged it; if it didn't move but the
  // vector differs, the vector was mutated externally.
  const lastExteriorMarker = exteriorMarker.position.clone();
  const lastDoorwayMarker = doorwayMarker.position.clone();

  const syncPair = (marker: Mesh, vector: Vector3, lastMarker: Vector3): void => {
    if (!marker.position.equals(lastMarker)) {
      // Marker drag wins — push to vector.
      vector.copy(marker.position);
    } else if (!vector.equals(marker.position)) {
      // External vector mutation (e.g. saveCurrentAsDoorway) — pull to marker.
      marker.position.copy(vector);
    }
    lastMarker.copy(marker.position);
  };

  const syncToSources = (): void => {
    syncPair(exteriorMarker, exteriorPos, lastExteriorMarker);
    syncPair(doorwayMarker, doorway, lastDoorwayMarker);
  };

  return { exteriorMarker, doorwayMarker, setVisible, hideAll, syncToSources };
}
