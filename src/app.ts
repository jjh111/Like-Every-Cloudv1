import { Box3, DoubleSide, Group, type Mesh, type MeshStandardMaterial, type Object3D, Quaternion, Vector3 } from 'three';
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
import { getHeroId, buildHeroDropdownMap } from './scene/tagging';
import { createDebugPanel } from './debug/debugPanel';
import { devBus } from './debug/devBus';
import { DebugVizScene } from './debug/dvScene';
import { AudioGizmos } from './debug/audioGizmos';
import { ClothGizmos } from './debug/clothGizmos';
import { SceneGizmos } from './debug/sceneGizmos';
import { createTimeline } from './debug/timeline';
import { createInspector } from './debug/inspector';
import { createEventLog } from './debug/eventLog';
import { createHotkeyHint } from './debug/hotkeyHint';
import { initDirectorMode } from './debug/directorMode';
import type { Atmosphere } from './atmosphere/atmosphere';
import { NoAtmosphere } from './atmosphere/atmosphere';
import { MorningShaft, type MorningShaftConfig, type ShaftDef } from './atmosphere/morningShaft';
import { TimeOfDayClock } from './atmosphere/timeOfDayClock';
import { SunRig } from './atmosphere/sunRig';
import { CloudSky } from './atmosphere/cloudSky';
import { loadStateConfig, buildStateRules } from './state/stateConfig';
import { createWallCull, type CullSettings } from './scene/wallCull';
import { createCameraHandles } from './scene/cameraHandles';
import { createSaveFlows, applyCameraTunables } from './persist/saveFlows';
import { createGizmoUndo } from './scene/gizmoUndo';
import { createAudioControls } from './ui/audioControls';
import { createLogoBadge } from './ui/logoBadge';
import { HoverHighlight } from './scene/hoverHighlight';
import { ClothPatch } from './scene/clothPatch';
import { ClothGrabController } from './interaction/clothGrab';
import { createHoverLabel } from './ui/hoverLabel';
import { createViewToggle } from './ui/viewToggle';
import { createDevToggle } from './ui/devToggle';
import { createControlsHint } from './ui/controlsHint';

interface CameraBookmark { position: [number, number, number]; target: [number, number, number] }

export async function start(container: HTMLElement): Promise<void> {
  // `?dev=1` (or `?dev`) unlocks the authoring surfaces: the lil-gui dev
  // panel, the per-hero state radio panel, and the green/cyan camera
  // anchor markers. Default load is the polished demo view.
  const devMode = new URLSearchParams(window.location.search).has('dev');

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
  // Post-init log: OrbitControls.update() runs during init() and shouldn't
  // change camera.position when the spherical round-trip is lossless. If
  // this value drifts from the "applied exterior pose" log above, something
  // is moving the camera between those two points.
  console.log('[camera] post-init pose:',
    `pos=[${camera.position.toArray().map((v) => v.toFixed(3)).join(', ')}]`,
  );

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
   *  waypoint (used by setView to clear the doorway without clipping).
   *
   *  Waypoint sanity check: if the proposed waypoint isn't on the path
   *  between fromPos and toPos — measured by projecting it onto the
   *  from→to line — we drop it and tween straight. Without this, a
   *  doorway saved behind the exterior pose (e.g. further east than the
   *  outside camera) creates a Catmull-Rom curve that lurches east first
   *  then U-turns west into the interior. Better to go direct than to
   *  detour through an off-path waypoint. */
  const tweenToPose = (
    toPos: Vector3,
    toTarget: Vector3,
    destCamera: string,
    waypoint?: Vector3,
  ): void => {
    detachGizmos();
    const fromPos = camera.position.clone();
    const fromTarget = currentTarget();

    let effectiveWaypoint = waypoint;
    if (waypoint) {
      const dir = new Vector3().subVectors(toPos, fromPos);
      const lenSq = dir.lengthSq();
      if (lenSq < 1e-6) {
        effectiveWaypoint = undefined;
      } else {
        const fromW = new Vector3().subVectors(waypoint, fromPos);
        const t = fromW.dot(dir) / lenSq;
        // [0.05, 0.95] = waypoint is meaningfully between endpoints. Outside
        // that range it'd just be a detour. The tight inner bound also avoids
        // jitter when the camera is already sitting on the waypoint.
        if (t < 0.05 || t > 0.95) {
          console.warn(
            `[camera] doorway at (${waypoint.x.toFixed(2)}, ${waypoint.y.toFixed(2)}, ${waypoint.z.toFixed(2)}) ` +
            `isn't on the path from (${fromPos.x.toFixed(2)}, ${fromPos.y.toFixed(2)}, ${fromPos.z.toFixed(2)}) → ` +
            `(${toPos.x.toFixed(2)}, ${toPos.y.toFixed(2)}, ${toPos.z.toFixed(2)}) — ` +
            `t=${t.toFixed(2)}. Skipping waypoint; tweening straight. ` +
            `Drag the cyan doorway marker onto the actual door opening to use it as a waypoint.`,
          );
          effectiveWaypoint = undefined;
        }
      }
    }

    activeCamera.dispose();
    activeCamera = new TweenCameraMode(
      camera,
      { position: fromPos, target: fromTarget },
      { position: toPos.clone(), target: toTarget.clone() },
      VIEW_TWEEN_DURATION,
      () => setCamera(destCamera),
      effectiveWaypoint,
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
    devBus.emit('bookmark:tween', { name });
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
  const glb = new GLBLoader(renderer);

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

  // Hero-only: force every material to render both sides. Blender exports
  // `doubleSided: false` for any material with backface-culling enabled, and
  // imported props frequently have a few inverted normals from their source —
  // the combination makes front faces silently invisible (you see through
  // the prop to its inside). DoubleSide eliminates the dependency on
  // per-mesh normal correctness, which is the kind of data hygiene we don't
  // want to enforce per export. Not applied to shared.glb because walls
  // SHOULD stay single-sided (you don't want to see interior textures from
  // outside).
  const forceDoubleSidedMaterials = (root: Object3D): void => {
    root.traverse((obj) => {
      const m = (obj as Mesh).material;
      if (!m) return;
      const list = Array.isArray(m) ? m : [m];
      for (const mat of list) {
        if (mat.side !== DoubleSide) {
          mat.side = DoubleSide;
          mat.needsUpdate = true;
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
      forceDoubleSidedMaterials(h);
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
  //
  // Hierarchy preference: when a multi-placement hero has an `#all` wrapper
  // AND all its placements agree on group_id, we attach the `#all` group to
  // the cross-group (not its individual children). That preserves the
  // per-hero "(set)" handle — picking `hero_cassette_raw_a (set)` from the
  // dropdown still drags all of that hero's cassettes as one. Yanking the
  // children out instead would orphan `#all` and the (set) handle would
  // drag nothing.
  {
    const byGroupId = new Map<string, Object3D[]>();
    const consumed = new Set<Object3D>();

    // Pass 1: #all wrappers whose children unanimously agree on a group_id.
    for (const [id, obj] of heroLookup) {
      if (!id.endsWith('#all')) continue;
      const children = obj.children;
      if (children.length === 0) continue;
      const gids = new Set<string>();
      for (const c of children) {
        const gid = c.userData?.group_id;
        if (typeof gid === 'string' && gid.length > 0) gids.add(gid);
        else { gids.clear(); break; }  // any disagreement disqualifies the wrapper
      }
      if (gids.size !== 1) continue;
      const gid = gids.values().next().value as string;
      if (!byGroupId.has(gid)) byGroupId.set(gid, []);
      byGroupId.get(gid)!.push(obj);
      // Mark children as consumed so pass 2 doesn't double-attach them.
      for (const c of children) consumed.add(c);
    }

    // Pass 2: individual instances not already covered by an #all wrapper.
    for (const obj of heroLookup.values()) {
      if (consumed.has(obj)) continue;
      const gid = obj.userData?.group_id;
      if (typeof gid !== 'string' || gid.length === 0) continue;
      if (!byGroupId.has(gid)) byGroupId.set(gid, []);
      byGroupId.get(gid)!.push(obj);
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

  // Time-of-day clock + SunRig — unified lighting source. Created BEFORE
  // atmospheres so MorningShaft.init() can read the sun direction. Clock
  // defaults to t=0.42 (warm late morning) to match the existing scene's
  // visual baseline; auto-cycle is OFF by default — dev controls it.
  const clock = new TimeOfDayClock({ initialT: 0.42, dayLengthSeconds: 600, running: false });
  const sunRig = new SunRig(scene, clock);

  // CloudSky is the 3D sky dome. Lives alongside the atmosphere selector
  // (not part of it) so MorningShaft / NoAtmosphere swaps don't affect
  // the sky. Always on.
  const cloudSky = new CloudSky(sunRig);
  cloudSky.add(scene);

  const atmosphereCtx = { scene, camera, sunRig };
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

  // ── Hover + selection highlight ─────────────────────────────────────
  // Always-on visual feedback: emissive boost on hover, stronger boost +
  // inverted-hull outline on click-selected hero. Independent of the rules
  // engine — even heroes with no click rule (placeholder spheres, cloth
  // pieces) still light up on hover.
  new HoverHighlight({ pointer });

  // ── Cloth sim on the table ──────────────────────────────────────────
  // Two cloth patches replace the static fabric meshes that used to ship
  // inside hero_table.glb (FrontCloth-table_hero, Sidecloth-table_hero
  // were removed in Blender + re-exported). Pin lines are derived from
  // the live table's world bbox so any future dev-panel reposition of
  // the table carries the cloths along without code changes.
  //
  // Front cloth: pinned along the table's front edge (the +Z face that
  //              faces the doorway camera) — spans the full table width.
  // Side cloth:  pinned along the table's right edge (+X face) — spans
  //              the full table depth.
  //
  // 4mm forward / sideways inset on the pin line so the cloth doesn't
  // z-fight the table top at the seam.
  const cloths: ClothPatch[] = [];
  const tableRoot = heroLookup.get('hero_table');
  if (tableRoot) {
    const tableBox = new Box3().setFromObject(tableRoot);
    const topY = tableBox.max.y;
    const minX = tableBox.min.x;
    const maxX = tableBox.max.x;
    const minZ = tableBox.min.z;
    const maxZ = tableBox.max.z;
    // floor a touch below the table-bottom so the cloth can settle to a
    // natural drape (legs go nearly to ground).
    const floorY = tableBox.min.y - 0.02;

    // Pin lines are pulled in 1cm from the geometric edge so the cloth
    // overlap reads as the cloth draping from the top instead of clipping
    // through the table top corner.
    const inset = 0.01;
    const frontPinZ = maxZ - inset;
    const sidePinX = maxX - inset;
    // Vertical drop: from table-top down to a hair above floor (let the
    // last row dangle into the floor slightly so it reads as resting).
    const hangHeight = topY - floorY - 0.02;

    const frontCloth = new ClothPatch({
      id: 'tablecloth_front',
      pinStart: new Vector3(minX + inset, topY, frontPinZ),
      pinEnd:   new Vector3(maxX - inset, topY, frontPinZ),
      height: hangHeight,
      cols: 14,
      rows: 10,
      windStrength: 1.0,
      gravity: 3.0,
      floorY,
    });
    frontCloth.mesh.userData.hero_id = 'cloth_table_front';
    frontCloth.mesh.userData.interactive = true;
    contentRoot.add(frontCloth.mesh);
    cloths.push(frontCloth);

    const sideCloth = new ClothPatch({
      id: 'tablecloth_side',
      pinStart: new Vector3(sidePinX, topY, minZ + inset),
      pinEnd:   new Vector3(sidePinX, topY, maxZ - inset),
      height: hangHeight,
      cols: 12,
      rows: 10,
      windStrength: 0.8,
      gravity: 3.0,
      floorY,
    });
    sideCloth.mesh.userData.hero_id = 'cloth_table_side';
    sideCloth.mesh.userData.interactive = true;
    contentRoot.add(sideCloth.mesh);
    cloths.push(sideCloth);
  } else {
    console.warn('[cloth] hero_table not found — skipping cloth instantiation');
  }

  // Mute OrbitControls during cloth grab by reaching into whatever camera
  // is active — mirrors the gizmo-drag suppression pattern below.
  const cameraControlsToggle = {
    get enabled(): boolean {
      const c = (activeCamera as unknown as { controls?: { enabled: boolean } }).controls;
      return c?.enabled ?? true;
    },
    set enabled(v: boolean) {
      const c = (activeCamera as unknown as { controls?: { enabled: boolean } }).controls;
      if (c) c.enabled = v;
    },
  };
  const clothGrab = new ClothGrabController({
    camera,
    domElement: renderer.domElement,
    controlsToggle: cameraControlsToggle,
  });
  for (const cloth of cloths) clothGrab.register(cloth);
  clothGrab.attach();

  // ── Dev viz layer (Phase 2 gizmos) ───────────────────────────────────
  // Single root Group with per-category subgroups. Master + per-category
  // visibility toggles persist in localStorage. Hotkey: G toggles the
  // master. The toggle UI is folded into the inspector (Phase B).
  //
  // SINGLE DEV GATE: every dev surface — 3D gizmos, timeline, event log,
  // hotkey hint, inspector, lil-gui — exists only under `?dev`. Demo /
  // viewer view is therefore truly clean. Director mode (D key) hides
  // the created surfaces within dev without destroying them. Hoisted to
  // `let … = null` so the render tick + the later dev-panel block can
  // reference them; null-guarded at the callsites.
  let dvScene: DebugVizScene | null = null;
  let audioGizmos: AudioGizmos | null = null;
  let clothGizmos: ClothGizmos | null = null;
  let sceneGizmos: SceneGizmos | null = null;
  if (devMode) {
    dvScene = new DebugVizScene();
    dvScene.add(scene);
    audioGizmos = new AudioGizmos(dvScene.groups.audio, audio);
    clothGizmos = new ClothGizmos(dvScene.groups.cloth);
    for (const cloth of cloths) clothGizmos.register(cloth);
    sceneGizmos = new SceneGizmos({
      lightingGroup: dvScene.groups.lighting,
      cullingGroup: dvScene.groups.culling,
      camerasGroup: dvScene.groups.cameras,
      interiorAABB,
      sunRig,
      wallCull,
    });
    for (const [, obj] of heroLookup) {
      if (!obj.userData?.hero_id) continue;
      // interactive defaults to true if the manifest didn't set it explicitly.
      const interactive = obj.userData.interactive !== false;
      sceneGizmos.registerHero(obj, interactive);
    }
    // Timeline strip — bottom of viewport, two lanes (time of day + state
    // morph), transport + hotkeys. Polls clock/state for the playhead each
    // frame; mutates them on scrub.
    createTimeline({ clock, state: stateController });
    // Event log — narrator strip above the timeline. Subscribes to every
    // devBus event and surfaces them as fading one-liners.
    createEventLog();
    // Hotkey cheatsheet — '?' opens a modal listing every shortcut.
    createHotkeyHint();
  }

  // ── Gizmo ───────────────────────────────────────────────────────────
  // ONE TransformControls. Mode toggle lives in the dev panel "edit" folder:
  // translate by default, switch to rotate when needed (E key as shortcut).
  // Showing both gizmos at once meant translate arrows and rotate rings
  // shared the same gizmo origin and converged at small camera distances —
  // grabbing one frequently caught the other, producing rotations during
  // what felt like a translate drag. Single gizmo = no overlap, no surprise.
  //
  // `editable` targets respect the mode dropdown. `translate-only` targets
  // (shaft handles) force translate and reject mode-switch attempts —
  // rotating a position-only handle is meaningless.
  const tc = new TransformControls(camera, renderer.domElement);
  tc.setMode('translate');
  const helper = tc.getHelper();
  helper.visible = false;
  tc.enabled = false;
  scene.add(helper);
  const onGizmoDrag = (event: unknown): void => {
    const dragging = (event as { value: boolean }).value;
    const fm = activeCamera as unknown as { controls?: { enabled: boolean } };
    if (fm.controls) fm.controls.enabled = !dragging;
  };
  tc.addEventListener('dragging-changed', onGizmoDrag);

  type GizmoTargetMode = 'editable' | 'translate-only';
  let currentTargetMode: GizmoTargetMode = 'editable';
  // Visible to the dev panel + the W/E shortcuts. Reads as the displayed
  // gizmo mode (translate or rotate). Only meaningful for `editable` targets.
  let gizmoMode: 'translate' | 'rotate' = 'translate';

  const attachGizmo = (obj: Object3D | null, mode: GizmoTargetMode = 'editable'): void => {
    if (!obj) {
      tc.detach();
      helper.visible = false;
      tc.enabled = false;
      return;
    }
    tc.attach(obj);
    currentTargetMode = mode;
    // Locked targets always translate. Editable targets honor whatever the
    // user last set via the dropdown — but a fresh pick resets to translate
    // so the safer action is always one click away.
    if (mode === 'translate-only') {
      tc.setMode('translate');
    } else {
      gizmoMode = 'translate';
      tc.setMode('translate');
    }
    helper.visible = true;
    tc.enabled = true;
  };
  const getGizmoTarget = (): Object3D | null => (tc.object as Object3D | null) ?? null;
  const getGizmoMode = (): 'translate' | 'rotate' => gizmoMode;
  const setGizmoMode = (m: 'translate' | 'rotate'): void => {
    // Translate-only targets ignore rotate requests — keeps the dropdown
    // sane when a shaft handle is selected.
    if (currentTargetMode === 'translate-only' && m === 'rotate') return;
    gizmoMode = m;
    if (tc.object) tc.setMode(m);
  };

  // W = translate, E = rotate. Identical to the dropdown, just faster.
  window.addEventListener('keydown', (e) => {
    if (!tc.object) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement | null)?.isContentEditable) return;
    if (e.key === 'w' || e.key === 'W') { e.preventDefault(); setGizmoMode('translate'); }
    else if (e.key === 'e' || e.key === 'E') { e.preventDefault(); setGizmoMode('rotate'); }
  });

  // Translate-purity watchdog. Empirically: while the gizmo is in 'translate'
  // mode, dragging an arrow sometimes also mutates the target's quaternion
  // / scale — visible as the hero spinning around the axis you're sliding
  // along. The translate handler in three.js TransformControls only writes
  // to object.position, so whatever's leaking rotation must be downstream
  // (cross-hero group transform accumulating, glTF root with non-identity
  // TRS, etc.). Cheap defense: snapshot quaternion + scale at drag start,
  // restore on every objectChange while in translate. The first leak per
  // drag logs to console so we can find the root cause.
  let translateBaseline: { obj: Object3D; quaternion: Quaternion; scale: Vector3 } | null = null;
  let translateLeakLogged = false;
  tc.addEventListener('mouseDown', () => {
    const obj = tc.object;
    if (!obj || tc.getMode() !== 'translate') {
      translateBaseline = null;
      return;
    }
    translateBaseline = {
      obj,
      quaternion: obj.quaternion.clone(),
      scale: obj.scale.clone(),
    };
    translateLeakLogged = false;
  });
  tc.addEventListener('objectChange', () => {
    if (!translateBaseline) return;
    const { obj, quaternion, scale } = translateBaseline;
    if (!obj.quaternion.equals(quaternion)) {
      if (!translateLeakLogged) {
        console.warn('[gizmo] translate drag mutated quaternion; restoring.',
          { heroId: obj.userData?.hero_id,
            baseline: quaternion.toArray(),
            leaked: obj.quaternion.toArray() });
        translateLeakLogged = true;
      }
      obj.quaternion.copy(quaternion);
    }
    if (!obj.scale.equals(scale)) {
      obj.scale.copy(scale);
    }
  });
  tc.addEventListener('mouseUp', () => {
    translateBaseline = null;
  });

  // Undo/redo for gizmo edits. Captures pre/post matrices on every drag.
  // Cmd/Ctrl-Z to undo, Cmd/Ctrl-Shift-Z (or Cmd-Y) to redo.
  const gizmoUndo = createGizmoUndo({ controls: [tc] });

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

  let currentEditTarget = '(none)';
  const setEditTarget = (heroId: string): void => {
    currentEditTarget = heroId;
    if (heroId === '(none)') {
      attachGizmo(null);
      return;
    }
    const obj = heroLookup.get(heroId);
    if (!obj) return;
    attachGizmo(obj, 'editable');
    switchToFreeformPreservingView(obj);
  };
  const getEditTarget = (): string => currentEditTarget;

  // ── Camera handles ──────────────────────────────────────────────────
  // Two always-visible read-only markers (green = exterior, cyan = doorway)
  // showing where the saved camera anchors live. Editing is camera-snapshot
  // only: orbit the live camera, hit "set outside view here" or "set doorway
  // here" — the corresponding Vector3 updates and the marker follows on the
  // next syncToSources tick. No gizmo attaches to these markers.
  const cameraHandles = createCameraHandles(scene, exteriorPos, doorway);

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
  // (Camera handle markers are passive visualizations — nothing to detach.)
  detachGizmos = () => {
    attachGizmo(null);
    morningShaft.setHandlesVisible(false);
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
  });

  // ── UI ──────────────────────────────────────────────────────────────
  // Player-facing surfaces (always visible): logo badge, mute pill + master
  // volume, view toggle. The dev surfaces (lil-gui panel, per-hero state
  // radios, hero-id hover chip, camera anchor markers, the verbose tracks
  // bar listing every audio asset) only show under `?dev=1`.
  const toggleView = (): void => setView(getView() === 'exterior' ? 'interior' : 'exterior');

  // Top-left brand badge — present in both demo and dev views. The hero
  // audio mixer (dev-only) tucks under this when it mounts. Clicking the
  // badge opens the project brief (public/brief.html) in a new tab.
  createLogoBadge({ href: '/brief.html' });

  createAudioControls(audio);
  createViewToggle(getView, toggleView);

  // (Asset audition chips + per-hero ambient beds are now folded into the
  //  inspector AUDIO tab — see createInspector below.)

  // Small ⚙ button top-right in demo view → opens dev view via ?dev=1.
  // Not shown in dev view because lil-gui already lives top-right there.
  if (!devMode) createDevToggle(false);

  // One-time controls hint for first-time visitors. Suppresses itself on
  // localStorage flag so returning visitors don't see the same chip again.
  // Only shown in demo view — devs don't need it.
  if (!devMode) createControlsHint();

  // Camera anchor markers (green = exterior pose, cyan = doorway) are
  // authoring aids — hide them on the demo view so directors don't see
  // floating dots in the scene.
  if (!devMode) {
    cameraHandles.exteriorMarker.visible = false;
    cameraHandles.doorwayMarker.visible = false;
  }

  if (devMode) {
    // Director mode plumbing — D hotkey + toggle pill + body-class CSS
    // that hides the legacy dev surfaces (lil-gui, hero state panel,
    // tracks bar, hero audio mixer) when director mode is active.
    // The new dev surfaces (gizmo dock, timeline, inspector, event log)
    // hide themselves via onDevModeChange subscriptions.
    initDirectorMode();

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
      toggleView,
      heroIds: buildHeroDropdownMap(heroLookup),
      setEditTarget,
      getGizmoMode,
      setGizmoMode,
      saveHeroPositions: () => { void saves.saveHeroPositions(); },
      shaftHandleIds,
      setShaftEditTarget,
      saveShaftConfig: () => { void saves.saveShaftConfig(); },
      saveCameraPose: () => { void saves.saveCameraPose(); },
      saveCurrentAsDoorway: () => { void saves.saveCurrentAsDoorway(); },
      cullSettings,
      // Bookmarks: list, go-to, save, delete. Panel rebuilds the dropdown
      // when bookmarks change so the user sees their new entry immediately.
      bookmarks,
      goToBookmark,
      saveCurrentAsBookmark: (name: string) => {
        void saves.saveCurrentAsBookmark(name);
        devBus.emit('bookmark:saved', { name });
      },
      deleteBookmark: (name: string) => { void saves.deleteBookmark(name); },
      clock,
      morningShaft,
    });

    // Inspector — left-edge engine-style HUD with HEROES / AUDIO /
    // ATMOSPHERE / PERF tabs. Mirrors the lil-gui edit-hero dropdown
    // and audio folder in a discoverable, scrollable surface. Atmosphere
    // shows live palette swatches + tunables; Perf charts frame time +
    // renderer.info + subsystem counts. Refreshes its heroes list
    // whenever state tags change (same hook as the lil-gui dropdown).
    const inspector = createInspector({
      audio,
      heroLookup,
      heroIds: buildHeroDropdownMap(heroLookup),
      setEditTarget,
      getEditTarget,
      sunRig,
      atmospheres,
      getActiveAtmosphere,
      setAtmosphere,
      renderer,
      cloths,
      // dvScene is created in the same `if (devMode)` gate above, so it's
      // non-null here. The inspector's gizmo footer drives it.
      dv: dvScene!,
      // AUDIO tab authoring (absorbed hero-audio-mixer + tracks-bar):
      // per-hero ambient beds bound to the live AudioManager + stateConfig,
      // plus the full asset catalogue for the audition chip grid.
      state: stateController,
      stateConfig,
      saveStatesConfig: (cfg) => saves.saveStatesConfig(cfg),
      audioAssets: AUDIO_ASSETS,
      // Fired when the HEROES tab retags a hero (past/present/both) — the
      // absorbed hero-state-panel behaviour. Re-cache the transition's mesh
      // list against the new tags so visibility flips immediately, and
      // refresh the dropdown labels everywhere.
      onHeroRetag: () => {
        active.dispose();
        active.init(scene);
        const newMap = buildHeroDropdownMap(heroLookup);
        debugPanel.refreshHeroDropdown(newMap);
        inspector.refreshHeroes(newMap);
      },
    });

    // Hover label: small floating chip showing the hero_id of whatever's
    // under the cursor. Useful for picking the right hero by sight.
    createHoverLabel({ pointer, domElement: renderer.domElement });
  }

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
    tc,
    get gizmoTarget() { return getGizmoTarget(); },
    audio,
    atmospheres,
    morningShaft,
    cameras,
    bookmarks,
    gizmoUndo,
    clock,
    sunRig,
    cloudSky,
    get activeCamera() { return activeCamera; },
    get activeAtmosphere() { return activeAtmosphere; },
  };

  // Fade out the index.html loading overlay now that the scene is wired
  // and the first render is about to happen. CSS handles the transition;
  // we just toggle the class.
  const loadingOverlay = document.getElementById('lec-loading');
  if (loadingOverlay) {
    loadingOverlay.classList.add('hidden');
    // Remove from the DOM after the CSS transition so it can't catch input.
    setTimeout(() => loadingOverlay.remove(), 800);
  }

  let prev = performance.now();
  const tick = (now: number): void => {
    const dt = (now - prev) / 1000;
    prev = now;
    stateController.tick(dt);
    active.update(stateController.context);
    activeCamera.update(dt);

    // Time-of-day + lighting unification. Order matters:
    //   1. clock.tick advances t if running.
    //   2. sunRig.update recomputes sun direction + palette + DirectionalLight
    //      + AmbientLight from the new t. Atmospheres downstream see the
    //      fresh state via ctx.sunRig.
    //   3. cloudSky reads sunRig + re-centres on the camera (sphere tracks
    //      camera so the sky stays at infinity).
    //   4. atmosphere update (MorningShaft) reads sunRig, rotates its
    //      cones + scales intensity by altitude.
    //   5. Fog colour mirrors palette bottom so the horizon line of the
    //      cloud sky meets the fog softly. Works for both Fog and FogExp2.
    clock.tick(dt);
    sunRig.update();
    cloudSky.update(camera.position, dt);
    activeAtmosphere.update(atmosphereCtx, dt);
    if (scene.fog) scene.fog.color.copy(sunRig.palette.bottom);
    for (const cloth of cloths) cloth.tick(dt);
    // Mirror any gizmo-driven marker changes into the source-of-truth
    // vectors that the tween + save flow read.
    cameraHandles.syncToSources();
    // Run cull AFTER transition update — wall cull is the final say on
    // outside-mesh visibility regardless of state opacity.
    wallCull.update();
    audio.syncSpatial(camera);

    // Dev viz refresh — each gizmo system early-returns if its group is
    // hidden, so total cost is near-zero when gizmos are off. Null in the
    // demo/viewer view (dev surfaces aren't created without ?dev).
    audioGizmos?.update(camera);
    clothGizmos?.update();
    sceneGizmos?.update();

    // Boombox glows while music plays. Only the past placement exists
    // today; when a present-state boombox lands, extend this loop.
    updateBoomboxEmissive('hero_boombox', audio.isChannelActive('music'));

    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
