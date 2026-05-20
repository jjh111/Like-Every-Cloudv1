import { type Box3, type Material, type Mesh, type Object3D, type PerspectiveCamera, Plane, type Scene, Vector3 } from 'three';
import type { CameraMode } from '../camera/cameraMode';

// Wall cull (per-fragment clipping plane).
//
// When the freeform camera in interior view zooms out past the room walls,
// a single Plane is positioned on the wall closest to the camera, normal
// facing into the room. Fragments BETWEEN camera and plane (= the wall +
// any geometry occluding the view) are discarded by WebGL; fragments past
// the plane (= room interior + heroes) render normally.
//
// Gating: the cull is inert unless ALL of the following hold —
//   - cullSettings.enabled
//   - view === 'interior'
//   - active camera === cameras['freeform']  (so the entry tween + rails
//     never trigger it; both fly through walls by design)
//   - camera is OUTSIDE the interior AABB
//
// Inert means clipPlane.constant = 1e6 so every fragment lands on the
// positive (kept) side — equivalent to no clipping, with zero per-frame
// branching cost on the shader side.
export interface CullSettings {
  offset: number;
  enabled: boolean;
}

export interface WallCullDeps {
  scene: Scene;
  camera: PerspectiveCamera;
  interiorAABB: Box3;
  cullSettings: CullSettings;
  getView: () => 'exterior' | 'interior';
  getActiveCamera: () => CameraMode;
  /** Reference to the cameras map so we can identify the freeform instance. */
  cameras: Record<string, CameraMode>;
}

export interface WallCull {
  /** Attach the clip plane to every photoscan material in scene (skips hero
   *  subtrees and any object passing the skipPredicate). Idempotent per
   *  material. Call after every late-added GLB / atmosphere mesh that needs
   *  to participate in the cull. */
  attach(skipPredicate?: (mesh: Mesh) => boolean): void;
  /** Per-tick: recompute clip plane normal + position based on camera/AABB. */
  update(): void;
  /** Count of materials currently participating. */
  size(): number;
}

export function createWallCull(deps: WallCullDeps): WallCull {
  const { scene, camera, interiorAABB, cullSettings, getView, getActiveCamera, cameras } = deps;
  // Default to inert. constant=1e6 means every fragment is on the kept side
  // until update() relocates it onto a wall.
  const clipPlane = new Plane(new Vector3(0, 1, 0), 1e6);
  const clippedMaterials = new Set<Material>();

  const attach = (skipPredicate?: (mesh: Mesh) => boolean): void => {
    scene.updateMatrixWorld(true);
    scene.traverse((obj) => {
      const mesh = obj as Mesh;
      if (!mesh.isMesh) return;
      // Skip hero subtrees — they live inside the room and should never clip.
      let cur: Object3D | null = mesh;
      while (cur) {
        if (cur.userData?.hero_id) return;
        // Opt-out flag. Systems that render outside-the-room geometry (the
        // sky dome, ambient particles, anything that exists at "infinity")
        // set `userData.no_cull` so the wall plane never carves them.
        // Without this, the dome material picks up the clipping plane and
        // a vertical seam appears where the plane intersects the sphere.
        if (cur.userData?.no_cull) return;
        cur = cur.parent;
      }
      if (skipPredicate && skipPredicate(mesh)) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const mat of mats) {
        if (!mat) continue;
        if (clippedMaterials.has(mat)) continue;
        mat.clippingPlanes = [clipPlane];
        clippedMaterials.add(mat);
      }
    });
  };

  const aabbCenter = new Vector3();
  const aabbHalf = new Vector3();
  const tmpNormal = new Vector3();
  const tmpPoint = new Vector3();

  const update = (): void => {
    interiorAABB.getCenter(aabbCenter);
    interiorAABB.getSize(aabbHalf).multiplyScalar(0.5);
    if (
      !cullSettings.enabled ||
      getView() === 'exterior' ||
      getActiveCamera() !== cameras['freeform'] ||
      interiorAABB.containsPoint(camera.position)
    ) {
      clipPlane.normal.set(0, 1, 0);
      clipPlane.constant = 1e6;
      return;
    }
    // Camera is outside in interior view. Aim the plane perpendicular to
    // the camera→room-center vector, positioned at the AABB face closest
    // to the camera. `cullSettings.offset` pushes the plane further INTO
    // the room (positive) or toward the camera (negative) — positive
    // means LESS wall is cut.
    tmpNormal.subVectors(aabbCenter, camera.position).normalize();
    const extent =
      Math.abs(aabbHalf.x * tmpNormal.x) +
      Math.abs(aabbHalf.y * tmpNormal.y) +
      Math.abs(aabbHalf.z * tmpNormal.z);
    tmpPoint.copy(aabbCenter).addScaledVector(tmpNormal, -extent + cullSettings.offset);
    clipPlane.setFromNormalAndCoplanarPoint(tmpNormal, tmpPoint);
  };

  return {
    attach,
    update,
    size: () => clippedMaterials.size,
  };
}
