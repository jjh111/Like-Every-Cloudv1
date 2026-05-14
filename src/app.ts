import { Box3, Euler, Group, type Material, Mesh, MeshBasicMaterial, type MeshStandardMaterial, type Object3D, Plane, Quaternion, SphereGeometry, Vector3 } from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { createCamera, createRenderer, createScene } from './scene/sceneGraph';
import type { CameraMode } from './camera/cameraMode';
import { FreeformMode } from './camera/freeformMode';
import type { FreeformInitOptions } from './camera/freeformMode';
import { RailsMode } from './camera/railsMode';
import { TweenCameraMode } from './camera/tweenMode';
import { StateController } from './state/stateController';
import { InstantSwap } from './transitions/instantSwap';
import { OpacityCrossfade } from './transitions/opacityCrossfade';
import type { Transition } from './transitions/transition';
import { GLBLoader } from './loaders/glbLoader';
import { HeroLoader, type HeroEntry, type HeroPlacement } from './loaders/heroLoader';
import { PointerInteraction } from './interaction/pointer';
import { InteractionEngine } from './interaction/engine';
import { RULES } from './interaction/rules';
import { AudioManager, type AudioChannel } from './audio/audioManager';
import { AUDIO_ASSETS, type AudioAsset } from './audio/manifest';
import { getHeroId } from './scene/tagging';
import { createDebugPanel } from './debug/debugPanel';
import type { Atmosphere } from './atmosphere/atmosphere';
import { NoAtmosphere } from './atmosphere/atmosphere';
import { MorningShaft, type MorningShaftConfig, type ShaftDef } from './atmosphere/morningShaft';

export async function start(container: HTMLElement): Promise<void> {
  const scene = createScene();
  const camera = createCamera(window.innerWidth, window.innerHeight);
  const renderer = createRenderer();
  renderer.setSize(window.innerWidth, window.innerHeight);
  // Per-material clipping planes — the wall cull uses one to cut just the
  // fragments between camera and room, not the whole occluding mesh.
  renderer.localClippingEnabled = true;
  container.appendChild(renderer.domElement);

  // Camera modes.
  // Exterior pose lives in public/camera/positions.json so the user can save
  // a preferred establishing shot via the dev panel. Defaults below are
  // backup values if the file is missing or malformed.
  const exteriorPos = new Vector3(12, 5, 8);
  const exteriorTarget = new Vector3(2.0, 1.5, -1.6);
  // Doorway: the camera tween routes through this point so we curve through
  // the entrance instead of clipping through walls. Default = a point in
  // front of the main door (will be overridden by saved positions.json).
  const doorway = new Vector3(0.5, 1.3, 2.0);
  // Interior bounds: when the freeform camera (in interior view) zooms out
  // past these walls, the photoscan's outside-the-room geometry hides so the
  // user can see in. Loose-ish defaults that we tighten via positions.json.
  const interiorAABB = new Box3(
    new Vector3(-2.75, -0.5, -3.2),
    new Vector3(1.0, 3.5, 2.5),
  );
  // Tunable clip-plane controls. `cullSettings.offset` pushes the plane
  // inward (positive = deeper into the room, less wall cut) along the
  // camera→room axis. `enabled` short-circuits clipping entirely without
  // unwiring the per-material plane list.
  const cullSettings = { offset: 0, enabled: true };
  // Per-camera-mode tunables (damping/rotateSpeed/zoomSpeed for freeform,
  // speed/smoothing for rails). Loaded from positions.json and applied to
  // each camera after construction.
  let cameraTunablesFromDisk: Record<string, Record<string, number>> | null = null;
  try {
    const camRes = await fetch('/camera/positions.json', { cache: 'no-store' });
    if (camRes.ok) {
      const data = (await camRes.json()) as {
        exterior?: { position?: number[]; target?: number[] };
        doorway?: number[];
        interiorAABB?: { min?: number[]; max?: number[] };
        cull?: { offset?: number; enabled?: boolean };
        tunables?: Record<string, Record<string, number>>;
      };
      const p = data.exterior?.position;
      const t = data.exterior?.target;
      if (Array.isArray(p) && p.length === 3) exteriorPos.set(p[0], p[1], p[2]);
      if (Array.isArray(t) && t.length === 3) exteriorTarget.set(t[0], t[1], t[2]);
      if (Array.isArray(data.doorway) && data.doorway.length === 3) {
        doorway.set(data.doorway[0], data.doorway[1], data.doorway[2]);
      }
      const aMin = data.interiorAABB?.min;
      const aMax = data.interiorAABB?.max;
      if (Array.isArray(aMin) && aMin.length === 3) interiorAABB.min.set(aMin[0], aMin[1], aMin[2]);
      if (Array.isArray(aMax) && aMax.length === 3) interiorAABB.max.set(aMax[0], aMax[1], aMax[2]);
      if (typeof data.cull?.offset === 'number') cullSettings.offset = data.cull.offset;
      if (typeof data.cull?.enabled === 'boolean') cullSettings.enabled = data.cull.enabled;
      if (data.tunables) cameraTunablesFromDisk = data.tunables;
    }
  } catch (e) {
    console.warn('[camera] positions.json load failed, using defaults', e);
  }
  // Apply the loaded exterior pose so the page opens at the saved shot
  // rather than the createCamera() boot defaults.
  camera.position.copy(exteriorPos);
  camera.lookAt(exteriorTarget);

  // Interior path lives inside SolidWallStructure's footprint (3.7×5.4m,
  // centered ~(-0.9, _, -0.5)). Tightened to 0.85m inset and routed to pass
  // near each hero's placement so the walk reads as a tour.
  const interiorCenter = new Vector3(-0.9, 1.0, -0.5);
  const interiorPath: Vector3[] = [
    new Vector3( 0.1, 1.0,  1.2),  // front-right (near entrance)
    new Vector3(-1.0, 1.0,  0.8),  // moving toward speaker
    new Vector3(-1.5, 1.0, -0.5),  // mid-room
    new Vector3(-1.0, 1.0, -1.5),  // mid-back
    new Vector3( 0.3, 1.0, -1.8),  // near boombox
    new Vector3( 0.3, 1.0,  0.0),  // right side returning
  ];

  const cameras: Record<string, CameraMode> = {
    'freeform':       new FreeformMode(camera, renderer.domElement, exteriorTarget),
    'interior-walk':  new RailsMode(camera, renderer.domElement, {
      path: interiorPath,
      lookAt: 'ahead',
      closed: true,
    }),
    'interior-orbit': new RailsMode(camera, renderer.domElement, {
      path: interiorPath,
      lookAt: interiorCenter,
      closed: true,
    }),
  };

  // Apply any persisted tunables to each camera by name. Uses the mode's
  // own getTunables() spec list to know which properties are valid.
  const applyCameraTunables = (cam: CameraMode, values: Record<string, number>): void => {
    const { target, specs } = cam.getTunables();
    const t = target as Record<string, number>;
    for (const s of specs) {
      if (typeof values[s.key] === 'number') t[s.key] = values[s.key];
    }
  };
  const snapshotCameraTunables = (cam: CameraMode): Record<string, number> => {
    const { target, specs } = cam.getTunables();
    const t = target as Record<string, number>;
    const out: Record<string, number> = {};
    for (const s of specs) out[s.key] = t[s.key];
    return out;
  };
  if (cameraTunablesFromDisk) {
    for (const [name, cam] of Object.entries(cameras)) {
      const saved = cameraTunablesFromDisk[name];
      if (saved) applyCameraTunables(cam, saved);
    }
  }

  const initialCameraName = 'freeform';
  let activeCamera: CameraMode = cameras[initialCameraName];
  activeCamera.init();

  const setCamera = (name: string) => {
    const next = cameras[name];
    if (!next || next === activeCamera) return;
    activeCamera.dispose();
    activeCamera = next;
    activeCamera.init();
  };
  const getActiveCamera = () => activeCamera;

  // View state — high-level "are we outside or inside" toggle. Animated via
  // TweenCameraMode so the camera glides between exterior/interior poses
  // rather than snapping. After the tween completes, control hands off to
  // freeform (outside) or interior-orbit (inside).
  let view: 'exterior' | 'interior' = 'exterior';
  const VIEW_TWEEN_DURATION = 1.6;
  const currentTarget = (): Vector3 => {
    const t = new Vector3();
    const cur = activeCamera as unknown as { controls?: { target: Vector3 } };
    if (cur.controls) {
      t.copy(cur.controls.target);
    } else {
      // Rails / tween / etc: use a point on the forward ray as a stand-in
      // so the tween rotation matches the current view direction.
      const fwd = new Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
      t.copy(camera.position).add(fwd.multiplyScalar(5));
    }
    return t;
  };
  // Late-bound: assigned once transformControls + morningShaft exist. Keeps
  // setView callable from the dev panel without forcing a big reshuffle of
  // the file. Initial no-op handles any pre-setup invocation (shouldn't
  // happen in practice).
  let detachGizmos: () => void = () => { /* set later */ };
  const setView = (v: 'exterior' | 'interior') => {
    view = v;
    // Drop any active gizmo so the camera tween doesn't drag a visible
    // helper through space and end up in a context where it's irrelevant.
    detachGizmos();
    const fromPos = camera.position.clone();
    const fromTarget = currentTarget();
    const toPos = v === 'exterior' ? exteriorPos.clone() : interiorPath[0].clone();
    const toTarget = v === 'exterior' ? exteriorTarget.clone() : interiorCenter.clone();
    const destName = v === 'exterior' ? 'freeform' : 'interior-orbit';

    // Entering the interior: reset both rails cameras to t=0 so the rails
    // pick up at the entrance (where the tween hands off) instead of
    // snapping back to wherever the user had scrolled last session.
    if (v === 'interior') {
      (cameras['interior-walk'] as RailsMode).t = 0;
      (cameras['interior-orbit'] as RailsMode).t = 0;
    }

    activeCamera.dispose();
    // Pass the doorway as a tween waypoint so the camera curves through
    // the entrance instead of cutting through walls.
    activeCamera = new TweenCameraMode(
      camera,
      { position: fromPos, target: fromTarget },
      { position: toPos, target: toTarget },
      VIEW_TWEEN_DURATION,
      () => setCamera(destName),
      doorway,
    );
    activeCamera.init();
  };
  const getView = () => view;

  // Content root + hero lookup table (heroId -> Object3D).
  const contentRoot = new Group();
  scene.add(contentRoot);

  const heroLookup = new Map<string, Object3D>();
  const indexHeroes = (objects: Object3D[]) => {
    for (const root of objects) {
      root.traverse((obj) => {
        const id = getHeroId(obj);
        if (id) heroLookup.set(id, obj);
      });
    }
  };

  const glb = new GLBLoader();

  // Defensive: glTF materials that came in with alphaMode=BLEND get loaded
  // as transparent=true AND depthWrite=false. transparent breaks alpha sort;
  // depthWrite=false means faces don't occlude what's behind them (visible
  // as the mesh rendering "through itself"). Reset both so heroes render
  // properly opaque. If you need genuinely transparent material later,
  // skip this for that hero.
  const forceOpaqueMaterials = (root: Object3D) => {
    root.traverse((obj) => {
      const m = (obj as Mesh).material;
      if (!m) return;
      const list = Array.isArray(m) ? m : [m];
      for (const mat of list) {
        const ms = mat as MeshStandardMaterial & {
          transparent: boolean;
          depthWrite: boolean;
        };
        if (ms.transparent || !ms.depthWrite) {
          ms.transparent = false;
          ms.depthWrite = true;
          ms.needsUpdate = true;
        }
      }
    });
  };

  // MVP: real Blender-exported geometry replaces the placeholder.
  try {
    const sharedScene = await glb.load('/scene/shared.glb');
    forceOpaqueMaterials(sharedScene);
    contentRoot.add(sharedScene);
    indexHeroes([sharedScene]);
  } catch (e) {
    console.warn('[scene] shared.glb load failed', e);
  }

  const heroes = new HeroLoader(glb);
  try {
    const heroObjects = await heroes.loadFromManifest('/heroes/manifest.json');
    for (const h of heroObjects) {
      forceOpaqueMaterials(h);
      contentRoot.add(h);
    }
    indexHeroes(heroObjects);
  } catch (e) {
    console.warn('[heroes] manifest load failed', e);
  }

  // ── Wall cull (clipping plane) ──────────────────────────────────────────
  // When the camera leaves the interior AABB in interior view, a clip plane
  // sweeps to sit on the wall closest to the camera, oriented to face the
  // room interior. Fragments between camera and plane (= the wall + any
  // outside geometry occluding the view) are discarded by WebGL; everything
  // past the plane (= the room + heroes) renders normally. Walls peel
  // smoothly as the camera orbits; no whole-mesh visibility flipping.
  //
  // Plane is attached as a *local* clippingPlanes entry on every photoscan
  // material so it doesn't affect heroes. Inert when camera is inside the
  // AABB or view is exterior — we set its `constant` to a large value so
  // every fragment ends up on the positive side.
  scene.updateMatrixWorld(true);
  const clipPlane = new Plane(new Vector3(0, 1, 0), 1e6);
  const clippedMaterials = new Set<Material>();
  {
    scene.traverse((obj) => {
      const mesh = obj as Mesh;
      if (!mesh.isMesh) return;
      // Skip hero subtrees — they live inside the room and should never clip.
      let cur: Object3D | null = mesh;
      while (cur) {
        if (cur.userData?.hero_id) return;
        cur = cur.parent;
      }
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const mat of mats) {
        if (!mat) continue;
        if (clippedMaterials.has(mat)) continue;
        mat.clippingPlanes = [clipPlane];
        clippedMaterials.add(mat);
      }
    });
    console.log(`[cull] attached clip plane to ${clippedMaterials.size} materials`);
  }

  const aabbCenter = new Vector3();
  const aabbHalf = new Vector3();
  const tmpNormal = new Vector3();
  const tmpPoint = new Vector3();
  const updateWallCull = (): void => {
    interiorAABB.getCenter(aabbCenter);
    interiorAABB.getSize(aabbHalf).multiplyScalar(0.5);
    // Disabled, exterior view, or camera still inside the room — leave the
    // plane inert so nothing clips. Large `constant` pushes it below every
    // possible fragment, so each one is on the positive side.
    if (
      !cullSettings.enabled ||
      view === 'exterior' ||
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
    // AABB half-extent projected along the normal direction:
    const extent =
      Math.abs(aabbHalf.x * tmpNormal.x) +
      Math.abs(aabbHalf.y * tmpNormal.y) +
      Math.abs(aabbHalf.z * tmpNormal.z);
    tmpPoint.copy(aabbCenter).addScaledVector(tmpNormal, -extent + cullSettings.offset);
    clipPlane.setFromNormalAndCoplanarPoint(tmpNormal, tmpPoint);
  };

  // State + transition wiring.
  const stateController = new StateController();
  const transitions: Record<string, Transition> = {
    'opacity-crossfade': new OpacityCrossfade(),
    'instant-swap': new InstantSwap(),
  };
  const initialName = 'opacity-crossfade';
  let active: Transition = transitions[initialName];
  active.init(scene);

  const setTransition = (name: string) => {
    const next = transitions[name];
    if (!next || next === active) return;
    active.dispose();
    active = next;
    active.init(scene);
  };

  // Atmosphere — pluggable like transitions/cameras. Owns the scene's fog
  // (swaps to FogExp2 + restores on dispose) plus any dust / shaft meshes.
  // Shaft positions/radii live in public/atmosphere/morning-shaft.json; on
  // startup we fetch and pass them in so the user's last-saved values
  // survive a refresh. If the file is missing, MorningShaft falls back to
  // its hardcoded defaults.
  let morningShaftConfig: MorningShaftConfig | undefined;
  try {
    const res = await fetch('/atmosphere/morning-shaft.json', { cache: 'no-store' });
    if (res.ok) {
      const data = (await res.json()) as {
        shafts?: Array<{ origin: number[]; aim: number[]; radius: number }>;
        shaftIntensity?: number;
        fogDensity?: number;
        dustOpacity?: number;
        dustSize?: number;
        dustCount?: number;
      };
      morningShaftConfig = {};
      if (data.shafts && data.shafts.length) {
        morningShaftConfig.shafts = data.shafts.map((s): ShaftDef => ({
          origin: new Vector3(s.origin[0], s.origin[1], s.origin[2]),
          aim: new Vector3(s.aim[0], s.aim[1], s.aim[2]),
          radius: s.radius,
        }));
      }
      if (typeof data.shaftIntensity === 'number') morningShaftConfig.shaftIntensity = data.shaftIntensity;
      if (typeof data.fogDensity === 'number') morningShaftConfig.fogDensity = data.fogDensity;
      if (typeof data.dustOpacity === 'number') morningShaftConfig.dustOpacity = data.dustOpacity;
      if (typeof data.dustSize === 'number') morningShaftConfig.dustSize = data.dustSize;
      if (typeof data.dustCount === 'number') morningShaftConfig.dustCount = data.dustCount;
    }
  } catch (e) {
    console.warn('[atmosphere] config load failed, using defaults', e);
  }

  const atmosphereCtx = { scene, camera };
  const atmospheres: Record<string, Atmosphere> = {
    'morning-shaft': new MorningShaft(morningShaftConfig),
    'none': new NoAtmosphere(),
  };
  const initialAtmosphereName = 'morning-shaft';
  let activeAtmosphere: Atmosphere = atmospheres[initialAtmosphereName];
  activeAtmosphere.init(atmosphereCtx);

  const setAtmosphere = (name: string) => {
    const next = atmospheres[name];
    if (!next || next === activeAtmosphere) return;
    activeAtmosphere.dispose(atmosphereCtx);
    activeAtmosphere = next;
    activeAtmosphere.init(atmosphereCtx);
  };
  const getActiveAtmosphere = () => activeAtmosphere;

  const pointer = new PointerInteraction(renderer.domElement, camera, contentRoot);
  pointer.attach();

  // Compound gizmo: a separate TransformControls for translate and rotate,
  // both attached to the target object. The dev panel shows them
  // simultaneously, so the user can grab an arrow OR a ring without
  // toggling modes. Shaft handles get only the translate gizmo since
  // points have nothing to rotate.
  const tcMove = new TransformControls(camera, renderer.domElement);
  tcMove.setMode('translate');
  const tcRotate = new TransformControls(camera, renderer.domElement);
  tcRotate.setMode('rotate');
  // Slightly larger so the rotation rings sit outside the translate arrows
  // and don't fight for pointer hits.
  tcRotate.setSize(1.25);
  const helperMove = tcMove.getHelper();
  const helperRotate = tcRotate.getHelper();
  helperMove.visible = false;
  helperRotate.visible = false;
  tcMove.enabled = false;
  tcRotate.enabled = false;
  scene.add(helperMove);
  scene.add(helperRotate);
  const onGizmoDrag = (event: unknown) => {
    const dragging = (event as { value: boolean }).value;
    const fm = activeCamera as unknown as { controls?: { enabled: boolean } };
    if (fm.controls) fm.controls.enabled = !dragging;
  };
  tcMove.addEventListener('dragging-changed', onGizmoDrag);
  tcRotate.addEventListener('dragging-changed', onGizmoDrag);

  type GizmoMode = 'compound' | 'translate-only';
  const attachGizmo = (obj: Object3D | null, mode: GizmoMode = 'compound'): void => {
    if (!obj) {
      tcMove.detach();
      tcRotate.detach();
      helperMove.visible = false;
      helperRotate.visible = false;
      tcMove.enabled = false;
      tcRotate.enabled = false;
      return;
    }
    tcMove.attach(obj);
    helperMove.visible = true;
    tcMove.enabled = true;
    if (mode === 'compound') {
      tcRotate.attach(obj);
      helperRotate.visible = true;
      tcRotate.enabled = true;
    } else {
      tcRotate.detach();
      helperRotate.visible = false;
      tcRotate.enabled = false;
    }
  };
  const getGizmoTarget = (): Object3D | null => (tcMove.object as Object3D | null) ?? null;

  const setEditTarget = (heroId: string) => {
    if (heroId === '(none)') {
      attachGizmo(null);
      return;
    }
    const obj = heroLookup.get(heroId);
    if (!obj) return;
    attachGizmo(obj, 'compound');
    // Auto-switch to freeform so the user can orbit around the gizmo —
    // but keep the camera exactly where it is. We park the orbit pivot
    // on the camera's current forward ray (at the hero's depth) so
    // OrbitControls' first update() is a no-op (camera is already looking
    // at the new target). Mouse-orbit will then rotate around that pivot,
    // which lands right around the hero in the view.
    if (activeCamera !== cameras['freeform']) {
      const heroPos = new Vector3();
      obj.getWorldPosition(heroPos);
      const distance = Math.max(0.5, camera.position.distanceTo(heroPos));
      const forward = new Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
      const orbitTarget = camera.position.clone().add(forward.multiplyScalar(distance));
      const options: FreeformInitOptions = { target: orbitTarget };
      activeCamera.dispose();
      activeCamera = cameras['freeform'];
      (activeCamera as FreeformMode).init(options);
    }
  };

  // Round to 3dp — matches what the rest of the manifest already uses.
  const r3 = (n: number) => Math.round(n * 1000) / 1000;

  // Custom formatter for manifest.json: keeps short placements + arrays of
  // primitives on one line, matching the hand-curated style. JSON.stringify
  // with indent=2 explodes them into multi-line blocks and bloats the file.
  const formatScalar = (v: unknown): string => JSON.stringify(v);
  const formatNumArray = (arr: number[]): string => `[${arr.join(', ')}]`;
  const formatPlacement = (p: HeroPlacement): string => {
    const parts: string[] = [`"state": ${formatScalar(p.state)}`];
    if (p.position) parts.push(`"position": ${formatNumArray(p.position)}`);
    if (p.rotation) parts.push(`"rotation": ${formatNumArray(p.rotation)}`);
    if (p.scale !== undefined) {
      parts.push(`"scale": ${Array.isArray(p.scale) ? formatNumArray(p.scale) : p.scale}`);
    }
    if (p.material_variant !== undefined) parts.push(`"material_variant": ${formatScalar(p.material_variant)}`);
    if (p.visible !== undefined) parts.push(`"visible": ${p.visible}`);
    let hasUserData = false;
    if (p.userData) {
      hasUserData = true;
      const ud = Object.entries(p.userData)
        .map(([k, v]) => `${formatScalar(k)}: ${formatScalar(v)}`)
        .join(', ');
      parts.push(`"userData": { ${ud} }`);
    }
    const oneLine = `{ ${parts.join(', ')} }`;
    // Placements with userData are conceptually richer — keep them expanded
    // for readability even if they'd fit on one line.
    if (!hasUserData && oneLine.length <= 110) return oneLine;
    return '{\n          ' + parts.join(',\n          ') + '\n        }';
  };
  const formatHero = (entry: HeroEntry): string => {
    const lines: string[] = [];
    lines.push(`      "id": ${formatScalar(entry.id)},`);
    lines.push(`      "url": ${formatScalar(entry.url)},`);
    if (entry.interactive !== undefined) {
      lines.push(`      "interactive": ${entry.interactive},`);
    }
    const placements = (entry.placements ?? []).map((p) => '        ' + formatPlacement(p)).join(',\n');
    lines.push('      "placements": [\n' + placements + '\n      ]');
    return '    {\n' + lines.join('\n') + '\n    }';
  };
  const formatManifest = (manifest: { heroes: HeroEntry[] }): string => {
    const heroes = (manifest.heroes ?? []).map(formatHero).join(',\n');
    return '{\n  "heroes": [\n' + heroes + '\n  ]\n}\n';
  };

  const saveHeroPositions = async () => {
    // Strategy: load the manifest fresh, snapshot each placement's WORLD
    // transform from the live scene (so any "#all" group offset is baked
    // in), then write that snapshot back into the manifest. Singletons use
    // their entry.id; multi-placement uses entry.id#index.
    //
    // For multi-placement we also normalize the live scene afterwards —
    // group back at identity, children re-localized to the captured world
    // transforms — so the user can immediately drag the group again
    // without compounding the previous offset on top of the new manifest.
    try {
      const res = await fetch('/heroes/manifest.json', { cache: 'no-store' });
      if (!res.ok) throw new Error('manifest fetch: ' + res.status);
      const manifest = (await res.json()) as { heroes: HeroEntry[] };

      const updated: string[] = [];
      const skipped: string[] = [];
      const writePlacement = (
        placement: HeroPlacement,
        pos: Vector3,
        quat: Quaternion,
        scale: Vector3,
      ): void => {
        placement.position = [r3(pos.x), r3(pos.y), r3(pos.z)];
        const e = new Euler().setFromQuaternion(quat);
        const ax = r3(e.x), ay = r3(e.y), az = r3(e.z);
        if (ax === 0 && ay === 0 && az === 0) delete placement.rotation;
        else placement.rotation = [ax, ay, az];
        const sx = r3(scale.x), sy = r3(scale.y), sz = r3(scale.z);
        if (sx === 1 && sy === 1 && sz === 1) delete placement.scale;
        else if (sx === sy && sy === sz) placement.scale = sx;
        else placement.scale = [sx, sy, sz];
      };

      for (const entry of manifest.heroes ?? []) {
        const placements = entry.placements ?? [];
        const multi = placements.length > 1;

        // Pass 1: snapshot world transforms BEFORE mutating anything, so
        // resetting the group later doesn't yank the children.
        const snaps = placements.map((_, i) => {
          const instanceId = multi ? `${entry.id}#${i}` : entry.id;
          const obj = heroLookup.get(instanceId);
          const pos = new Vector3();
          const quat = new Quaternion();
          const scale = new Vector3();
          if (obj) {
            obj.getWorldPosition(pos);
            obj.getWorldQuaternion(quat);
            obj.getWorldScale(scale);
          }
          return { instanceId, obj, pos, quat, scale };
        });

        // Pass 2 (multi only): normalize the live scene — group to identity,
        // children to the captured world transforms — so the manifest stays
        // the single source of truth for what's on screen.
        if (multi) {
          const group = heroLookup.get(entry.id + '#all');
          if (group) {
            group.position.set(0, 0, 0);
            group.quaternion.identity();
            group.scale.set(1, 1, 1);
            for (const snap of snaps) {
              if (!snap.obj) continue;
              snap.obj.position.copy(snap.pos);
              snap.obj.quaternion.copy(snap.quat);
              snap.obj.scale.copy(snap.scale);
            }
          }
        }

        // Pass 3: write snapshots into the manifest. Also pull the live
        // state tag off the Object3D so the bottom-right state panel's
        // checkbox toggles persist alongside the gizmo edits.
        for (let i = 0; i < placements.length; i++) {
          const snap = snaps[i];
          if (!snap.obj) {
            skipped.push(snap.instanceId + ' (not in scene)');
            continue;
          }
          writePlacement(placements[i], snap.pos, snap.quat, snap.scale);
          const liveState = snap.obj.userData.state;
          if (liveState === 'past' || liveState === 'present' || liveState === 'both') {
            placements[i].state = liveState;
          }
          updated.push(snap.instanceId);
        }
      }

      const saveRes = await fetch('/__lec/save-manifest', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: formatManifest(manifest),
      });
      if (!saveRes.ok) {
        const msg = await saveRes.text();
        throw new Error(`save responded ${saveRes.status}: ${msg}`);
      }
      const result = (await saveRes.json()) as { saved?: string };
      console.log('[manifest] saved →', result.saved);
      console.log('[manifest] updated:', updated);
      if (skipped.length) console.log('[manifest] skipped:', skipped);
    } catch (e) {
      console.warn('[manifest] save failed', e);
    }
  };

  // Shaft handle editing — re-uses the same TransformControls. Picks one of
  // the colored spheres MorningShaft drops at each shaft endpoint and lets
  // the user drag it; the cone follows automatically via MorningShaft.update.
  const morningShaft = atmospheres['morning-shaft'] as MorningShaft;
  const shaftHandleIds: string[] = ['(none)'];
  for (let i = 0; i < morningShaft.getShaftCount(); i++) {
    shaftHandleIds.push(`shaft ${i} origin`, `shaft ${i} aim`);
  }

  // Camera-handle markers — colored spheres at the exterior pose + doorway
  // waypoint. Hidden until the user picks one in the dev panel. Dragging
  // them updates exteriorPos / doorway (positions are aliased to the
  // marker.position vectors so a drag mutation flows through).
  const makeCameraHandle = (color: number, at: Vector3): Mesh => {
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
  const exteriorMarker = makeCameraHandle(0x4dffa6, exteriorPos);
  const doorwayMarker = makeCameraHandle(0x4dc8ff, doorway);
  // Re-alias the existing Vector3s onto the markers so a drag mutation is
  // automatically reflected in the source of truth (these are the same
  // refs the tween destinations + save flow already use).
  exteriorPos.copy(exteriorMarker.position);
  // Note: exteriorPos and exteriorMarker.position are separate Vector3s.
  // Sync from marker → exteriorPos happens in the tick below.

  type CameraHandleId = '(none)' | 'exterior' | 'doorway';
  const setCameraHandleEditTarget = (id: CameraHandleId) => {
    exteriorMarker.visible = false;
    doorwayMarker.visible = false;
    if (id === '(none)') {
      attachGizmo(null);
      return;
    }
    const marker = id === 'exterior' ? exteriorMarker : doorwayMarker;
    marker.visible = true;
    attachGizmo(marker, 'translate-only');
    // Land in freeform so the user can orbit around the handle.
    if (activeCamera !== cameras['freeform']) {
      const handlePos = marker.position.clone();
      const distance = Math.max(0.5, camera.position.distanceTo(handlePos));
      const forward = new Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
      const orbitTarget = camera.position.clone().add(forward.multiplyScalar(distance));
      activeCamera.dispose();
      activeCamera = cameras['freeform'];
      (activeCamera as FreeformMode).init({ target: orbitTarget });
    }
  };

  // Per-tick: mirror marker positions to the source-of-truth Vector3s so a
  // gizmo drag flows through to the tween + save flow without extra plumbing.
  const syncCameraHandles = () => {
    if (!exteriorPos.equals(exteriorMarker.position)) exteriorPos.copy(exteriorMarker.position);
    if (!doorway.equals(doorwayMarker.position)) doorway.copy(doorwayMarker.position);
  };

  // Now that the gizmo + MorningShaft both exist, wire the detach helper
  // that setView calls before its camera tween.
  detachGizmos = () => {
    attachGizmo(null);
    morningShaft.setHandlesVisible(false);
    exteriorMarker.visible = false;
    doorwayMarker.visible = false;
  };

  const setShaftEditTarget = (id: string) => {
    if (id === '(none)') {
      morningShaft.setHandlesVisible(false);
      attachGizmo(null);
      return;
    }
    const m = id.match(/^shaft (\d+) (origin|aim)$/);
    if (!m) return;
    const index = parseInt(m[1], 10);
    const role = m[2] as 'origin' | 'aim';
    const handle = morningShaft.getShaftHandle(index, role);
    if (!handle) return;
    morningShaft.setHandlesVisible(true);
    // Endpoints are points — only translate makes sense.
    attachGizmo(handle, 'translate-only');
    // Land in freeform so the user can orbit around the handle.
    if (activeCamera !== cameras['freeform']) {
      const handlePos = handle.position.clone();
      const distance = Math.max(0.5, camera.position.distanceTo(handlePos));
      const forward = new Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
      const orbitTarget = camera.position.clone().add(forward.multiplyScalar(distance));
      activeCamera.dispose();
      activeCamera = cameras['freeform'];
      (activeCamera as FreeformMode).init({ target: orbitTarget });
    }
  };

  // Snapshot current camera pose + per-mode tunables for save → positions.json.
  const snapshotCameraPose = (): { position: [number, number, number]; target: [number, number, number] } => {
    const r = (n: number) => Math.round(n * 1000) / 1000;
    const tgt = currentTarget();
    return {
      position: [r(camera.position.x), r(camera.position.y), r(camera.position.z)],
      target: [r(tgt.x), r(tgt.y), r(tgt.z)],
    };
  };

  const r3v = (v: Vector3): [number, number, number] => {
    const r = (n: number) => Math.round(n * 1000) / 1000;
    return [r(v.x), r(v.y), r(v.z)];
  };
  const formatCameraPositions = (data: {
    exterior: { position: [number, number, number]; target: [number, number, number] };
    doorway: [number, number, number];
    interiorAABB: { min: [number, number, number]; max: [number, number, number] };
    cull: { offset: number; enabled: boolean };
    tunables: Record<string, Record<string, number>>;
  }): string => {
    const ex = data.exterior;
    const ai = data.interiorAABB;
    const tunableLines = Object.entries(data.tunables).map(([name, vals]) => {
      const pairs = Object.entries(vals).map(([k, v]) => `"${k}": ${v}`).join(', ');
      return `    "${name}": { ${pairs} }`;
    });
    return (
      '{\n' +
      '  "exterior": {\n' +
      `    "position": [${ex.position.join(', ')}],\n` +
      `    "target": [${ex.target.join(', ')}]\n` +
      '  },\n' +
      `  "doorway": [${data.doorway.join(', ')}],\n` +
      '  "interiorAABB": {\n' +
      `    "min": [${ai.min.join(', ')}],\n` +
      `    "max": [${ai.max.join(', ')}]\n` +
      '  },\n' +
      `  "cull": { "offset": ${data.cull.offset}, "enabled": ${data.cull.enabled} },\n` +
      '  "tunables": {\n' +
      tunableLines.join(',\n') + '\n' +
      '  }\n' +
      '}\n'
    );
  };

  const buildCameraPayload = () => {
    const pose = snapshotCameraPose();
    const tunables: Record<string, Record<string, number>> = {};
    for (const [name, cam] of Object.entries(cameras)) {
      tunables[name] = snapshotCameraTunables(cam);
    }
    const r = (n: number) => Math.round(n * 1000) / 1000;
    return {
      exterior: pose,
      doorway: r3v(doorway),
      interiorAABB: { min: r3v(interiorAABB.min), max: r3v(interiorAABB.max) },
      cull: { offset: r(cullSettings.offset), enabled: cullSettings.enabled },
      tunables,
    };
  };

  const postCameraConfig = async (label: string) => {
    try {
      const payload = buildCameraPayload();
      const body = formatCameraPositions(payload);
      const res = await fetch('/__lec/save-camera', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      });
      if (!res.ok) throw new Error(`save responded ${res.status}: ${await res.text()}`);
      const result = (await res.json()) as { saved?: string };
      console.log(`[camera] ${label} → ${result.saved}`, payload);
    } catch (e) {
      console.warn('[camera] save failed', e);
    }
  };

  const saveCameraPose = () => postCameraConfig('exterior pose saved');

  // Capture the camera's CURRENT world position as the doorway waypoint,
  // then save. Workflow: orbit to the threshold of the entrance, click
  // this, and the next inside↔outside tween will route through it.
  const saveCurrentAsDoorway = () => {
    doorway.copy(camera.position);
    return postCameraConfig('doorway saved');
  };

  // Compact formatter to match the hand-curated layout of the existing
  // atmosphere JSON — one shaft per line, tunables on their own lines.
  const formatAtmosphereConfig = (cfg: ReturnType<MorningShaft['getCurrentConfig']>): string => {
    const shaftLines = cfg.shafts.map((s) =>
      `    { "origin": [${s.origin.join(', ')}], "aim": [${s.aim.join(', ')}], "radius": ${s.radius} }`,
    );
    return (
      '{\n' +
      '  "shafts": [\n' + shaftLines.join(',\n') + '\n  ],\n' +
      `  "shaftIntensity": ${cfg.shaftIntensity},\n` +
      `  "fogDensity": ${cfg.fogDensity},\n` +
      `  "dustOpacity": ${cfg.dustOpacity},\n` +
      `  "dustSize": ${cfg.dustSize},\n` +
      `  "dustCount": ${cfg.dustCount}\n` +
      '}\n'
    );
  };

  const saveShaftConfig = async () => {
    try {
      const config = morningShaft.getCurrentConfig();
      const body = formatAtmosphereConfig(config);
      const res = await fetch('/__lec/save-atmosphere', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      });
      if (!res.ok) {
        const msg = await res.text();
        throw new Error(`save responded ${res.status}: ${msg}`);
      }
      const result = (await res.json()) as { saved?: string };
      console.log('[atmosphere] saved →', result.saved, config);
    } catch (e) {
      console.warn('[atmosphere] save failed', e);
    }
  };

  // Audio + interaction engine.
  const audio = new AudioManager();
  await Promise.all(AUDIO_ASSETS.map((a) => audio.load(a.id, a.url)));

  const engine = new InteractionEngine({
    audio,
    state: stateController,
    setCamera,
    pointer,
    rules: RULES,
    getObjectByHeroId: (id) => heroLookup.get(id),
  });
  engine.arm();

  const debugPanel = createDebugPanel({
    state: stateController,
    transitions,
    setTransition,
    initialTransition: initialName,
    cameras,
    setCamera,
    initialCamera: initialCameraName,
    getActiveCamera,
    atmospheres,
    setAtmosphere,
    initialAtmosphere: initialAtmosphereName,
    getActiveAtmosphere,
    audio,
    getView,
    toggleView: () => setView(getView() === 'exterior' ? 'interior' : 'exterior'),
    heroIds: buildHeroDropdownMap(heroLookup),
    setEditTarget,
    saveHeroPositions,
    shaftHandleIds,
    setShaftEditTarget,
    saveShaftConfig,
    saveCameraPose,
    saveCurrentAsDoorway,
    setCameraHandleEditTarget,
    cullSettings,
  });

  // Bottom-left audio controls: mute toggle + master volume. Volume slider
  // is always editable; mute starts on and is the user's "begin" action.
  createAudioControls(audio);

  // Bottom-center: every loaded track + what's currently playing per channel.
  createTracksBar(audio, AUDIO_ASSETS);

  // Bottom-right: hero state panel — every hero in heroLookup with a
  // past / present / both radio. Toggling updates userData.state in place
  // and re-inits the active transition so its visibility cache picks up
  // the new tag immediately. Save flow (saveHeroPositions) reads state
  // off the live Object3D, so toggles persist when the user clicks
  // "save → manifest.json".
  createHeroStatePanel(heroLookup, stateController, () => {
    // Re-cache the transition's mesh list against the new state tags so
    // visibility flips immediately as the user toggles a radio.
    active.dispose();
    active.init(scene);
    // Rebuild the edit-hero dropdown so its labels match the new tags.
    debugPanel.refreshHeroDropdown(buildHeroDropdownMap(heroLookup));
  });

  window.addEventListener('resize', () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  });

  const updateBoomboxEmissive = (heroId: string, on: boolean): void => {
    const obj = heroLookup.get(heroId);
    if (!obj) return;
    const mesh = obj as Mesh;
    if (!mesh.isMesh) return;
    const mat = mesh.material as MeshStandardMaterial;
    mat.emissiveIntensity = on ? 0.6 : 0;
  };

  // Debug hook for runtime inspection. Exposed surfaces let you poke at
  // every subsystem from DevTools without re-wiring buttons:
  //   __lec.heroLookup.get('hero_boombox')
  //   __lec.morningShaft.getCurrentConfig()
  //   __lec.audio.listPlaying()
  //   __lec.activeCamera, __lec.activeAtmosphere
  (window as Window & { __lec?: unknown }).__lec = {
    scene,
    camera,
    renderer,
    heroLookup,
    tcMove,
    tcRotate,
    get gizmoTarget() { return getGizmoTarget(); },
    audio,
    atmospheres,
    morningShaft,
    cameras,
    get activeCamera() { return activeCamera; },
    get activeAtmosphere() { return activeAtmosphere; },
  };

  let prev = performance.now();
  const tick = (now: number) => {
    const dt = (now - prev) / 1000;
    prev = now;
    stateController.tick(dt);
    active.update(stateController.context);
    activeCamera.update(dt);
    activeAtmosphere.update(atmosphereCtx, dt);
    // Mirror any gizmo-driven marker changes into the source-of-truth
    // vectors that the tween + save flow read.
    syncCameraHandles();
    // Run cull AFTER transition update — wall cull is the final say on
    // outside-mesh visibility regardless of state opacity.
    updateWallCull();
    audio.syncSpatial(camera);

    const musicActive = audio.isChannelActive('music');
    const isPast = stateController.current === 'past';
    updateBoomboxEmissive('hero_boombox_past', musicActive && isPast);
    updateBoomboxEmissive('hero_boombox_present', musicActive && !isPast);

    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// Build the edit-hero dropdown map. Keys are display labels with a state
// suffix (e.g. `hero_speaker (past)`); values are the bare hero ids that
// setEditTarget understands. lil-gui treats object-shaped option lists as
// label→value, so we get readable labels without changing the setter.
function buildHeroDropdownMap(heroLookup: Map<string, Object3D>): Record<string, string> {
  const map: Record<string, string> = { '(none)': '(none)' };
  for (const k of Array.from(heroLookup.keys()).sort()) {
    const obj = heroLookup.get(k);
    if (!obj) continue;
    if (k.endsWith('#all')) {
      map[`${k} (group)`] = k;
      continue;
    }
    const tag = obj.userData.state as string | undefined;
    map[tag ? `${k} (${tag})` : k] = k;
  }
  return map;
}

// Hero state panel — bottom-right, replaces the old read-only "scene info"
// pill. Each row is one heroLookup entry with three radio buttons for
// past / present / both. Toggling sets userData.state on the Object3D and
// invokes onStateToggled (which app.ts uses to refresh the transition
// cache + rebuild the edit-hero dropdown labels).
function createHeroStatePanel(
  heroLookup: Map<string, Object3D>,
  state: StateController,
  onStateToggled: () => void,
): void {
  const panel = document.createElement('div');
  panel.style.cssText = [
    'position: fixed',
    'bottom: 16px',
    'right: 16px',
    'padding: 10px 14px',
    'background: rgba(15, 15, 15, 0.72)',
    'color: #ddd',
    'font: 11px/1.35 system-ui, sans-serif',
    'border-radius: 12px',
    'backdrop-filter: blur(6px)',
    'z-index: 1000',
    'user-select: none',
    'min-width: 250px',
    'max-height: 70vh',
    'overflow-y: auto',
  ].join('; ');
  document.body.appendChild(panel);

  const header = document.createElement('div');
  header.style.cssText = 'font-weight: 600; margin-bottom: 8px; display: flex; gap: 8px; align-items: center; justify-content: space-between;';
  const headerName = document.createElement('span');
  const headerStateBadge = document.createElement('span');
  headerStateBadge.style.cssText = 'padding: 1px 7px; border-radius: 999px; background: rgba(159, 214, 107, 0.18); color: #cfe9b3; font-weight: 500; font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em;';
  header.appendChild(headerName);
  header.appendChild(headerStateBadge);
  panel.appendChild(header);

  // Column headers — small caption row above the radio columns.
  const colHeader = document.createElement('div');
  colHeader.style.cssText = 'display: grid; grid-template-columns: 1fr 36px 36px 36px; gap: 4px; font-size: 9px; text-transform: uppercase; letter-spacing: 0.08em; color: #888; padding: 2px 0 4px;';
  colHeader.innerHTML = '<span></span><span style="text-align:center">past</span><span style="text-align:center">pres</span><span style="text-align:center">both</span>';
  panel.appendChild(colHeader);

  const rowsRoot = document.createElement('div');
  panel.appendChild(rowsRoot);

  interface RowRefs {
    radios: Record<'past' | 'present' | 'both', HTMLInputElement>;
  }
  const rows = new Map<string, RowRefs>();

  const states: Array<'past' | 'present' | 'both'> = ['past', 'present', 'both'];

  const buildRows = () => {
    while (rowsRoot.firstChild) rowsRoot.removeChild(rowsRoot.firstChild);
    rows.clear();

    const keys = Array.from(heroLookup.keys()).sort();
    for (const id of keys) {
      const obj = heroLookup.get(id);
      if (!obj) continue;
      // Groups (#all) have no state — skip in the panel.
      if (id.endsWith('#all')) continue;

      const row = document.createElement('div');
      row.style.cssText = 'display: grid; grid-template-columns: 1fr 36px 36px 36px; gap: 4px; padding: 2px 0; align-items: center; border-top: 1px solid rgba(255,255,255,0.05);';

      const label = document.createElement('span');
      label.textContent = id;
      label.style.cssText = 'opacity: 0.85; font-family: ui-monospace, Menlo, monospace; font-size: 10.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;';
      row.appendChild(label);

      // Per-row radio name — keeps the three options mutually exclusive
      // within the row without colliding across rows.
      const groupName = 'state-' + id.replace(/[^a-z0-9]/gi, '-');
      const radios: Partial<Record<'past' | 'present' | 'both', HTMLInputElement>> = {};
      for (const s of states) {
        const cell = document.createElement('label');
        cell.style.cssText = 'display: flex; justify-content: center; align-items: center; cursor: pointer;';
        const input = document.createElement('input');
        input.type = 'radio';
        input.name = groupName;
        input.value = s;
        input.style.cssText = 'accent-color: #9fd66b; cursor: pointer;';
        input.addEventListener('change', () => {
          if (!input.checked) return;
          // Update every instance of this hero_id so multi-placement
          // heroes stay consistent (e.g. all four cassettes flip together).
          // Note: heroLookup is instance-keyed, so the change targets only
          // this specific instance unless the id matches multiple lookups.
          obj.userData.state = s;
          onStateToggled();
        });
        cell.appendChild(input);
        row.appendChild(cell);
        radios[s] = input;
      }
      rowsRoot.appendChild(row);
      rows.set(id, { radios: radios as RowRefs['radios'] });
    }
  };

  buildRows();

  // Polling tick: keep the header and the radio selections in sync with
  // current data so external changes (e.g. a save that reloads tags, or
  // future per-state edits) reflect here.
  const render = () => {
    const count = rows.size;
    headerName.textContent = `${count} hero${count === 1 ? '' : 'es'}`;
    headerStateBadge.textContent = state.current;
    for (const [id, refs] of rows) {
      const obj = heroLookup.get(id);
      if (!obj) continue;
      const tag = (obj.userData.state ?? 'past') as 'past' | 'present' | 'both';
      for (const s of states) {
        const input = refs.radios[s];
        const shouldBe = s === tag;
        if (input.checked !== shouldBe) input.checked = shouldBe;
      }
    }
  };
  render();
  setInterval(render, 500);
}

function createTracksBar(audio: AudioManager, assets: AudioAsset[]): void {
  // Centered bottom strip: top row shows per-channel "now playing" labels,
  // bottom row is the catalog of tracks lit up when active. The whole thing
  // polls audio.listPlaying() — no events plumbed through — because the
  // playing set churns rarely enough that 200ms is fine.
  const wrapper = document.createElement('div');
  wrapper.style.cssText = [
    'position: fixed',
    'bottom: 16px',
    'left: 50%',
    'transform: translateX(-50%)',
    'display: flex',
    'flex-direction: column',
    'gap: 6px',
    'align-items: center',
    'padding: 8px 14px',
    'background: rgba(15, 15, 15, 0.7)',
    'color: #ddd',
    'font: 12px/1.3 system-ui, sans-serif',
    'border-radius: 12px',
    'backdrop-filter: blur(6px)',
    'z-index: 1000',
    'user-select: none',
    'max-width: min(640px, 60vw)',
  ].join('; ');

  const channels: AudioChannel[] = ['ambient', 'music', 'narration', 'sfx'];

  const channelRow = document.createElement('div');
  channelRow.style.cssText = 'display: flex; gap: 8px; flex-wrap: wrap; justify-content: center;';
  const channelLabels: Record<AudioChannel, HTMLDivElement> = {} as Record<AudioChannel, HTMLDivElement>;
  for (const ch of channels) {
    const div = document.createElement('div');
    div.style.cssText = 'padding: 2px 8px; border-radius: 999px; background: rgba(255,255,255,0.06); white-space: nowrap;';
    channelLabels[ch] = div;
    channelRow.appendChild(div);
  }

  const trackRow = document.createElement('div');
  trackRow.style.cssText = 'display: flex; gap: 6px; flex-wrap: wrap; justify-content: center;';
  const trackChips = new Map<string, HTMLDivElement>();
  for (const a of assets) {
    const chip = document.createElement('div');
    chip.style.cssText = 'padding: 2px 8px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.15); transition: background 120ms, color 120ms, border-color 120ms;';
    chip.textContent = a.id;
    trackChips.set(a.id, chip);
    trackRow.appendChild(chip);
  }

  wrapper.appendChild(channelRow);
  wrapper.appendChild(trackRow);
  document.body.appendChild(wrapper);

  const ACTIVE = '#9fd66b';
  const IDLE = '#8a8a8a';

  const render = () => {
    const playing = audio.listPlaying();
    const byChannel: Partial<Record<AudioChannel, string>> = {};
    const playingIds = new Set<string>();
    for (const p of playing) {
      // If somehow two sources hit the same channel, keep the first seen —
      // ambient/music are designed to be one-at-a-time per channel.
      if (!byChannel[p.channel]) byChannel[p.channel] = p.id;
      playingIds.add(p.id);
    }
    for (const ch of channels) {
      const id = byChannel[ch];
      channelLabels[ch].textContent = id ? `${ch}: ${id}` : `${ch}: —`;
      channelLabels[ch].style.color = id ? ACTIVE : IDLE;
    }
    for (const [id, chip] of trackChips) {
      const on = playingIds.has(id);
      chip.style.background = on ? 'rgba(159, 214, 107, 0.18)' : 'transparent';
      chip.style.borderColor = on ? 'rgba(159, 214, 107, 0.55)' : 'rgba(255,255,255,0.15)';
      chip.style.color = on ? '#cfe9b3' : IDLE;
    }
  };
  render();
  setInterval(render, 200);
}

function createAudioControls(audio: AudioManager): void {
  const wrapper = document.createElement('div');
  wrapper.style.cssText = [
    'position: fixed',
    'bottom: 16px',
    'left: 16px',
    'display: flex',
    'align-items: center',
    'gap: 10px',
    'padding: 8px 14px',
    'background: rgba(15, 15, 15, 0.7)',
    'color: #ddd',
    'font: 13px/1.3 system-ui, sans-serif',
    'border-radius: 999px',
    'backdrop-filter: blur(6px)',
    'z-index: 1000',
    'user-select: none',
  ].join('; ');

  const muteBtn = document.createElement('button');
  muteBtn.type = 'button';
  muteBtn.style.cssText = [
    'background: none',
    'border: 1px solid rgba(255,255,255,0.25)',
    'color: #ddd',
    'padding: 4px 10px',
    'border-radius: 999px',
    'cursor: pointer',
    'font: inherit',
    'min-width: 92px',
  ].join('; ');
  const renderBtn = () => {
    muteBtn.textContent = audio.muted ? '🔇 muted' : '🔊 sound on';
  };
  renderBtn();
  muteBtn.addEventListener('click', async () => {
    try { await audio.resume(); } catch { /* ignored */ }
    // Auto-bump from near-zero so unmute actually produces sound.
    if (audio.muted && audio.getMasterVolume() < 0.05) {
      audio.setMasterVolume(0.7);
      slider.value = '0.7';
    }
    audio.setMuted(!audio.muted);
    renderBtn();
  });

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = '0';
  slider.max = '1';
  slider.step = '0.01';
  slider.value = String(audio.getMasterVolume());
  slider.style.cssText = 'width: 120px; accent-color: #ddd; cursor: pointer;';
  slider.addEventListener('input', () => {
    audio.setMasterVolume(Number(slider.value));
  });

  wrapper.appendChild(muteBtn);
  wrapper.appendChild(slider);
  document.body.appendChild(wrapper);

  // Keep button + slider in sync if mute/volume change elsewhere (dev panel).
  setInterval(() => {
    renderBtn();
    const cur = String(audio.getMasterVolume());
    if (slider.value !== cur && document.activeElement !== slider) {
      slider.value = cur;
    }
  }, 200);
}
