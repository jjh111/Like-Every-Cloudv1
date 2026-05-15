import { Mesh, MeshBasicMaterial, type Scene, SphereGeometry, Vector3 } from 'three';

// Always-visible visualization dots for the two persisted camera points:
//   - green sphere at exteriorPos     (where the camera starts on page load)
//   - cyan sphere at doorway          (the tween waypoint for in/out)
//
// Read-only by design. The UX is camera-snapshot: orbit the live camera to
// the pose you want, hit "set outside view here" / "set doorway here" — those
// flows update the source-of-truth Vector3s, and `syncToSources()` pulls the
// markers along on the next tick so the dots stay aligned with the saved
// values. No marker-drag, no edit dropdown, no hidden state.
//
// Both markers render with depthTest:false so they're never hidden behind
// walls — that's the whole point of "showing where the saved point is".
export interface CameraHandles {
  exteriorMarker: Mesh;
  doorwayMarker: Mesh;
  /** Per-tick: pull each marker to match its Vector3. One-way, since the
   *  markers don't drive anything anymore. */
  syncToSources(): void;
}

const makeHandle = (color: number, scene: Scene, at: Vector3): Mesh => {
  const m = new Mesh(
    new SphereGeometry(0.07, 14, 12),
    new MeshBasicMaterial({
      color,
      depthTest: false,
      transparent: true,
      opacity: 0.8,
    }),
  );
  m.renderOrder = 100;
  m.position.copy(at);
  scene.add(m);
  return m;
};

export function createCameraHandles(
  scene: Scene,
  exteriorPos: Vector3,
  doorway: Vector3,
): CameraHandles {
  const exteriorMarker = makeHandle(0x4dffa6, scene, exteriorPos);
  const doorwayMarker = makeHandle(0x4dc8ff, scene, doorway);

  const syncToSources = (): void => {
    if (!exteriorMarker.position.equals(exteriorPos)) exteriorMarker.position.copy(exteriorPos);
    if (!doorwayMarker.position.equals(doorway)) doorwayMarker.position.copy(doorway);
  };

  return { exteriorMarker, doorwayMarker, syncToSources };
}
