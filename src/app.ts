import { Box3, Group, type Mesh, type MeshStandardMaterial, type Object3D, Vector3 } from 'three';
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
import { HeroLoader } from './loaders/heroLoader';
import { PointerInteraction } from './interaction/pointer';
import { InteractionEngine } from './interaction/engine';
import { RULES } from './interaction/rules';
import { AudioManager } from './audio/audioManager';
import { AUDIO_ASSETS } from './audio/manifest';
import { getHeroId } from './scene/tagging';
import { createDebugPanel } from './debug/debugPanel';
import type { Atmosphere } from './atmosphere/atmosphere';
import { NoAtmosphere } from './atmosphere/atmosphere';
import { MorningShaft, type MorningShaftConfig, type ShaftDef } from './atmosphere/morningShaft';
import { loadStateConfig, buildStateRules } from './state/stateConfig';
import { createWallCull, type CullSettings } from './scene/wallCull';
import { createCameraHandles } from './scene/cameraHandles';
import { createSaveFlows, applyCameraTunables } from './persist/saveFlows';
import { createGizmoUndo } from './scene/gizmoUndo';
import { createAudioControls } from './ui/audioControls';
import { createTracksBar } from './ui/tracksBar';
import { createHeroStatePanel, buildHeroDropdownMap } from './ui/heroStatePanel';
import { createHoverLabel } from './ui/hoverLabel';

interface CameraBookmark { position: [number, number, number]; target: [number, number, number] }

export async function start(container: HTMLElement): Promise<void> {
  const scene = createScene();
  const camera = createCamera(window.innerWidth, window.innerHeight);
  const renderer = createRenderer();
  renderer.setSize(window.innerWidth, window.innerHeight);
  // Per-material clipping planes — the wall cull uses one to cut just the
  // fragments between camera and room, not the whole occluding mesh.
  renderer.localClippingEnabled = true;
  container.appendChild(renderer.domElement);

  // ── Camera config load ───────────────────────────────────────────────
  // Defaults are the backup if positions.json is missing/malformed.
  const exteriorPos = new Vector3(12, 5, 8);
  const exteriorTarget = new Vector3(2.0, 1.5, -1.6);
  const doorway = new Vector3(0.5, 1.3, 2.0);
  const interiorAABB = new Box3(
    new Vector3(-2.75, -0.5, -3.2),
    new Vector3(1.0, 3.5, 2.5),
  );
  const cullSettings: CullSettings = { offset: 0, enabled: true };
  let cameraTunablesFromDisk: Record<string, Record<string, number>> | null = null;
  // Bookmarks: named camera poses surfaced in the dev panel. Persisted
  // alongside the rest of positions.json. Empty map until the user saves one.
  const bookmarks: Record<string, CameraBookmark> = {};
  try {
    const camRes = await fetch('/camera/positions.json', { cache: 'no-store' });
    if (camRes.ok) {
      const data = (await camRes.json()) as {
        exterior?: { position?: number[]; target?: number[] };
        doorway?: number[];
        interiorAABB?: { min?: number[]; max?: number[] };
        cull?: { offset?: number; enabled?: boolean };
        tunables?: Record<string, Record<string, number>>;
        bookmarks?: Record<string, { position: number[]; target: number[] }>;
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
      if (data.bookmarks) {
        for (const [name, b] of Object.entries(data.bookmarks)) {
          if (Array.isArray(b.position) && b.position.length === 3 &&
              Array.isArray(b.target) && b.target.length === 3) {
            bookmarks[name] = {
              position: [b.position[0], b.position[1], b.position[2]],
              target: [b.target[0], b.target[1], b.target[2]],
            };
          }
        }
      }
    }
  } catch (e) {
    console.warn('[camera] positions.json load failed, using defaults', e);
  }
  camera.position.copy(exteriorPos);
  camera.lookAt(exteriorTarget);
  // Boot-time diagnostic so we can confirm positions.json actually applied.
  console.log('[camera] applied exterior pose:',
    `pos=[${camera.position.toArray().map((v) => v.toFixed(2)).join(', ')}]`,
    `target=[${exteriorTarget.toArray().map((v) => v.toFixed(2)).join(', ')}]`,
    `doorway=[${doorway.toArray().map((v) => v.toFixed(2)).join(', ')}]`,
  );

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
  if (cameraTunablesFromDisk) {
    for (const [name, cam] of Object.entries(cameras)) {
      const saved = cameraTunablesFromDisk[name];
      if (saved) applyCameraTunables(cam, saved);
    }
  }

  const initialCameraName = 'freeform';
  let activeCamera: CameraMode = cameras[initialCameraName];
  activeCamera.init();

  const setCamera = (name: string): void => {
    const next = cameras[name];
    if (!next || next === activeCamera) return;
    activeCamera.dispose();
    activeCamera = next;
    activeCamera.init();
  };
  const getActiveCamera = (): CameraMode => activeCamera;

  // currentTarget(): a Vector3 representing what the camera is currently
  // pointed at. For freeform that's controls.target; for any other mode we
  // synthesize a point on the forward ray so a tween's rotation lerp
  // matches what's currently on screen.
  const currentTarget = (): Vector3 => {
    const t = new Vector3();
    const cur = activeCamera as unknown as { controls?: { target: Vector3 } };
    if (cur.controls) {
      t.copy(cur.controls.target);
    } else {
      const fwd = new Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
      t.copy(camera.position).add(fwd.multiplyScalar(5));
    }
    return t;
  };

  // ── View state (outside/inside) + tween helpers ───────────────────────
  let view: 'exterior' | 'interior' = 'exterior';
  const VIEW_TWEEN_DURATION = 1.6;

  // Late-bound: assigned once gizmos + atmosphere exist. The initial no-op
  // covers any pre-setup invocation.
  let detachGizmos: () => void = () => { /* set later */ };

  /** Cross-fades the camera from current pose to (toPos, toTarget). Hands
   *  off to `destCamera` after the tween. Optionally routes through a
   *  waypoint (used by setView to clear the doorway without clipping). */
  const tweenToPose = (
    toPos: Vector3,
    toTarget: Vector3,
    destCamera: string,
    waypoint?: Vector3,
  ): void => {
    detachGizmos();
    const fromPos = camera.position.clone();
    const fromTarget = currentTarget();
    activeCamera.dispose();
    activeCamera = new TweenCameraMode(
      camera,
      { position: fromPos, target: fromTarget },
      { position: toPos.clone(), target: toTarget.clone() },
      VIEW_TWEEN_DURATION,
      () => setCamera(destCamera),
      waypoint,
    );
    activeCamera.init();
  };

  const setView = (v: 'exterior' | 'interior'): void => {
    view = v;
    const toPos = v === 'exterior' ? exteriorPos : interiorPath[0];
    const toTarget = v === 'exterior' ? exteriorTarget : interiorCenter;
    const destName = v === 'exterior' ? 'freeform' : 'interior-orbit';
    // Entering the interior: reset both rails cameras to t=0 so the rails
    // pick up at the entrance (where the tween hands off) instead of
    // snapping back to wherever the user had scrolled last session.
    if (v === 'interior') {
      (cameras['interior-walk'] as RailsMode).t = 0;
      (cameras['interior-orbit'] as RailsMode).t = 0;
    }
    // Always route through the doorway — the camera tween otherwise cuts
    // through walls on the way in or out.
    tweenToPose(toPos, toTarget, destName, doorway);
  };
  const getView = (): 'exterior' | 'interior' => view;

  /** Tween to a bookmark. Auto-routes through the doorway if the bookmark
   *  is on the opposite side of the wall, and updates the view flag so
   *  wall cull behaves correctly post-landing. */
  const goToBookmark = (name: string): void => {
    const b = bookmarks[name];
    if (!b) return;
    const toPos = new Vector3(b.position[0], b.position[1], b.position[2]);
    const toTarget = new Vector3(b.target[0], b.target[1], b.target[2]);
    const destIsInside = interiorAABB.containsPoint(toPos);
    const fromIsInside = interiorAABB.containsPoint(camera.position);
    view = destIsInside ? 'interior' : 'exterior';
    // Always land in freeform — bookmarks are user-curated single poses,
    // not loops to ride.
    tweenToPose(toPos, toTarget, 'freeform', destIsInside !== fromIsInside ? doorway : undefined);
  };

  // ── Content load ─────────────────────────────────────────────────────
  // Pointer raycasts against contentRoot — scoping it tight keeps gizmo
  // helpers, lights, and the camera-handle markers out of the hit list.
  const contentRoot = new Group();
  scene.add(contentRoot);

  const heroLookup = new Map<string, Object3D>();
  const indexHeroes = (objects: Object3D[]): void => {
    for (const root of objects) {
      root.traverse((obj) => {
        const id = getHeroId(obj);
        if (id) heroLookup.set(id, obj);
      });
    }
  };
  const glb = new GLBLoader();

  // Defensive: glTF materials with alphaMode=BLEND import as transparent
  // and depthWrite=false. Both break opaque hero rendering — reset them.
  const forceOpaqueMaterials = (root: Object3D): void => {
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

  // ── Cross-hero groups ───────────────────────────────────────────────
  // Any placement with `userData.group_id: "<name>"` joins a shared parent
  // empty so the dev-panel gizmo can drag the whole group as one. Members
  // keep their identity (per-instance hero_id, individual gizmo edit still
  // works) — the group is just an additional handle.
  //
  // Save flow uses getWorldPosition(), so moving the group bakes the
  // translation into each member's stored position on the next save. The
  // group itself returns to identity on reload (re-built from manifest).
  {
    const byGroupId = new Map<string, Object3D[]>();
    for (const obj of heroLookup.values()) {
      const gid = obj.userData?.group_id;
      if (typeof gid === 'string' && gid.length > 0) {
        if (!byGroupId.has(gid)) byGroupId.set(gid, []);
        byGroupId.get(gid)!.push(obj);
      }
    }
    for (const [groupId, members] of byGroupId) {
      const groupObj = new Group();
      groupObj.userData.hero_id = `group:${groupId}`;
      groupObj.userData.group_id_self = groupId;
      contentRoot.add(groupObj);
      // .attach() reparents while preserving world transforms — members
      // visually stay put, but moving groupObj.position now moves all of them.
      for (const member of members) {
        groupObj.attach(member);
      }
      heroLookup.set(`group:${groupId}`, groupObj);
    }
    if (byGroupId.size > 0) {
      console.log(`[heroes] built ${byGroupId.size} cross-hero group(s):`,
        Array.from(byGroupId.keys()));
    }
  }

  // ── Atmosphere ───────────────────────────────────────────────────────
  // Shaft positions/radii/tunables live in public/atmosphere/morning-shaft.json
  // so the user's last-saved values survive a refresh.
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

  const setAtmosphere = (name: string): void => {
    const next = atmospheres[name];
    if (!next || next === activeAtmosphere) return;
    activeAtmosphere.dispose(atmosphereCtx);
    activeAtmosphere = next;
    activeAtmosphere.init(atmosphereCtx);
    // Re-attach the cull plane to any new atmosphere materials. Idempotent.
    // Skip shaft handles — they're editor helpers, not world geometry.
    wallCull.attach((mesh) => !!mesh.userData.atmosphereHandle);
  };
  const getActiveAtmosphere = (): Atmosphere => activeAtmosphere;

  // ── Wall cull ────────────────────────────────────────────────────────
  // Construct AFTER atmosphere init so cones/dust participate in the clip.
  // Atmosphere handles (shaft origin/aim spheres) are excluded — they're
  // helpers, not part of the world geometry.
  const wallCull = createWallCull({
    scene,
    camera,
    interiorAABB,
    cullSettings,
    getView,
    getActiveCamera,
    cameras,
  });
  wallCull.attach((mesh) => !!mesh.userData.atmosphereHandle);
  console.log(`[cull] attached clip plane to ${wallCull.size()} materials`);

  // ── State + transition ──────────────────────────────────────────────
  const stateController = new StateController();
  const transitions: Record<string, Transition> = {
    'opacity-crossfade': new OpacityCrossfade(),
    'instant-swap': new InstantSwap(),
  };
  const initialName = 'opacity-crossfade';
  let active: Transition = transitions[initialName];
  active.init(scene);

  const setTransition = (name: string): void => {
    const next = transitions[name];
    if (!next || next === active) return;
    active.dispose();
    active = next;
    active.init(scene);
  };

  // ── Pointer + interaction engine ────────────────────────────────────
  const pointer = new PointerInteraction(renderer.domElement, camera, contentRoot);
  pointer.attach();

  // Per-state ambient music is data-driven from public/states.json. Generated
  // rules go FIRST so they fire before the static rules can do anything
  // contradictory on the same event.
  const stateConfig = await loadStateConfig();
  const composedRules = [...buildStateRules(stateConfig), ...RULES];

  const audio = new AudioManager();
  await Promise.all(AUDIO_ASSETS.map((a) => audio.load(a.id, a.url)));

  const engine = new InteractionEngine({
    audio,
    state: stateController,
    setCamera,
    pointer,
    rules: composedRules,
    getObjectByHeroId: (id) => heroLookup.get(id),
  });
  engine.arm();

  // ── Gizmos (compound translate + rotate) ────────────────────────────
  const tcMove = new TransformControls(camera, renderer.domElement);
  tcMove.setMode('translate');
  const tcRotate = new TransformControls(camera, renderer.domElement);
  tcRotate.setMode('rotate');
  // Larger so rotation rings sit outside translate arrows and don't fight
  // for pointer hits.
  tcRotate.setSize(1.25);
  const helperMove = tcMove.getHelper();
  const helperRotate = tcRotate.getHelper();
  helperMove.visible = false;
  helperRotate.visible = false;
  tcMove.enabled = false;
  tcRotate.enabled = false;
  scene.add(helperMove);
  scene.add(helperRotate);
  const onGizmoDrag = (event: unknown): void => {
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

  // Undo/redo for gizmo edits. Captures pre/post matrices on every drag.
  // Cmd/Ctrl-Z to undo, Cmd/Ctrl-Shift-Z (or Cmd-Y) to redo.
  const gizmoUndo = createGizmoUndo({ controls: [tcMove, tcRotate] });

  /** Park the freeform orbit pivot on the camera's forward ray so the next
   *  init() is a visual no-op — preserves the user's current view when
   *  switching modes to manipulate an object. */
  const switchToFreeformPreservingView = (focusObj: Object3D): void => {
    if (activeCamera === cameras['freeform']) return;
    const focusPos = new Vector3();
    focusObj.getWorldPosition(focusPos);
    const distance = Math.max(0.5, camera.position.distanceTo(focusPos));
    const forward = new Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const orbitTarget = camera.position.clone().add(forward.multiplyScalar(distance));
    const options: FreeformInitOptions = { target: orbitTarget };
    activeCamera.dispose();
    activeCamera = cameras['freeform'];
    (activeCamera as FreeformMode).init(options);
  };

  const setEditTarget = (heroId: string): void => {
    if (heroId === '(none)') {
      attachGizmo(null);
      return;
    }
    const obj = heroLookup.get(heroId);
    if (!obj) return;
    attachGizmo(obj, 'compound');
    switchToFreeformPreservingView(obj);
  };

  // ── Camera handles ──────────────────────────────────────────────────
  const cameraHandles = createCameraHandles(scene, exteriorPos, doorway);

  type CameraHandleId = '(none)' | 'exterior' | 'doorway';
  const setCameraHandleEditTarget = (id: CameraHandleId): void => {
    cameraHandles.setVisible(id);
    if (id === '(none)') {
      attachGizmo(null);
      return;
    }
    const marker = id === 'exterior' ? cameraHandles.exteriorMarker : cameraHandles.doorwayMarker;
    attachGizmo(marker, 'translate-only');
    switchToFreeformPreservingView(marker);
  };

  // ── Shaft handles ───────────────────────────────────────────────────
  const morningShaft = atmospheres['morning-shaft'] as MorningShaft;
  const shaftHandleIds: string[] = ['(none)'];
  for (let i = 0; i < morningShaft.getShaftCount(); i++) {
    shaftHandleIds.push(`shaft ${i} origin`, `shaft ${i} aim`);
  }
  const setShaftEditTarget = (id: string): void => {
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
    attachGizmo(handle, 'translate-only');
    switchToFreeformPreservingView(handle);
  };

  // Now that all gizmo targets exist, wire the detach helper that
  // tweenToPose / setView call before re-attaching the camera mode.
  detachGizmos = () => {
    attachGizmo(null);
    morningShaft.setHandlesVisible(false);
    cameraHandles.hideAll();
  };

  // ── Save flows ──────────────────────────────────────────────────────
  const r3 = (n: number): number => Math.round(n * 1000) / 1000;
  const r3v = (v: Vector3): [number, number, number] => [r3(v.x), r3(v.y), r3(v.z)];
  const snapshotPose = (): { position: [number, number, number]; target: [number, number, number] } => ({
    position: r3v(camera.position),
    target: r3v(currentTarget()),
  });

  const saves = createSaveFlows({
    heroLookup,
    morningShaft,
    cameras,
    exteriorPos,
    exteriorTarget,
    doorway,
    interiorAABB,
    cullSettings,
    bookmarks,
    snapshotPose,
    // The exterior/doorway markers are visible iff the user picked
    // "edit handle: exterior/doorway" in the dev panel — that's our
    // signal to preserve the gizmo-driven pose on save instead of
    // snapping to the current camera position.
    isEditingExteriorMarker: () => cameraHandles.exteriorMarker.visible,
    isEditingDoorwayMarker: () => cameraHandles.doorwayMarker.visible,
  });

  // ── Dev panel + side-panel UIs ──────────────────────────────────────
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
    saveHeroPositions: () => { void saves.saveHeroPositions(); },
    shaftHandleIds,
    setShaftEditTarget,
    saveShaftConfig: () => { void saves.saveShaftConfig(); },
    saveCameraPose: () => { void saves.saveCameraPose(); },
    saveCurrentAsDoorway: () => { void saves.saveCurrentAsDoorway(); },
    setCameraHandleEditTarget,
    cullSettings,
    // Bookmarks: list, go-to, save, delete. Panel rebuilds the dropdown
    // when bookmarks change so the user sees their new entry immediately.
    bookmarks,
    goToBookmark,
    saveCurrentAsBookmark: (name: string) => { void saves.saveCurrentAsBookmark(name); },
    deleteBookmark: (name: string) => { void saves.deleteBookmark(name); },
  });

  createAudioControls(audio);
  createTracksBar(audio, AUDIO_ASSETS);
  createHeroStatePanel(heroLookup, stateController, () => {
    // Re-cache the transition's mesh list against the new state tags so
    // visibility flips immediately as the user toggles a radio.
    active.dispose();
    active.init(scene);
    debugPanel.refreshHeroDropdown(buildHeroDropdownMap(heroLookup));
  });
  // Hover label: small floating chip showing the hero_id of whatever's
  // under the cursor. Useful for picking the right hero by sight.
  createHoverLabel({ pointer, domElement: renderer.domElement });

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
  //   __lec.gizmoUndo.undo() / .redo()
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
    bookmarks,
    gizmoUndo,
    get activeCamera() { return activeCamera; },
    get activeAtmosphere() { return activeAtmosphere; },
  };

  let prev = performance.now();
  const tick = (now: number): void => {
    const dt = (now - prev) / 1000;
    prev = now;
    stateController.tick(dt);
    active.update(stateController.context);
    activeCamera.update(dt);
    activeAtmosphere.update(atmosphereCtx, dt);
    // Mirror any gizmo-driven marker changes into the source-of-truth
    // vectors that the tween + save flow read.
    cameraHandles.syncToSources();
    // Run cull AFTER transition update — wall cull is the final say on
    // outside-mesh visibility regardless of state opacity.
    wallCull.update();
    audio.syncSpatial(camera);

    // Boombox glows while music plays. Only the past placement exists
    // today; when a present-state boombox lands, extend this loop.
    updateBoomboxEmissive('hero_boombox', audio.isChannelActive('music'));

    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
