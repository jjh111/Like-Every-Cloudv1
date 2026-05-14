import { Euler, Group, Mesh, type MeshStandardMaterial, type Object3D, Quaternion, Vector3 } from 'three';
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
  container.appendChild(renderer.domElement);

  // Camera modes.
  // Exterior pose lives in public/camera/positions.json so the user can save
  // a preferred establishing shot via the dev panel. Defaults below are
  // backup values if the file is missing or malformed.
  const exteriorPos = new Vector3(12, 5, 8);
  const exteriorTarget = new Vector3(2.0, 1.5, -1.6);
  try {
    const camRes = await fetch('/camera/positions.json', { cache: 'no-store' });
    if (camRes.ok) {
      const data = (await camRes.json()) as {
        exterior?: { position?: number[]; target?: number[] };
      };
      const p = data.exterior?.position;
      const t = data.exterior?.target;
      if (Array.isArray(p) && p.length === 3) exteriorPos.set(p[0], p[1], p[2]);
      if (Array.isArray(t) && t.length === 3) exteriorTarget.set(t[0], t[1], t[2]);
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
  const setView = (v: 'exterior' | 'interior') => {
    view = v;
    const fromPos = camera.position.clone();
    const fromTarget = currentTarget();
    const toPos = v === 'exterior' ? exteriorPos.clone() : interiorPath[0].clone();
    const toTarget = v === 'exterior' ? exteriorTarget.clone() : interiorCenter.clone();
    const destName = v === 'exterior' ? 'freeform' : 'interior-orbit';

    activeCamera.dispose();
    activeCamera = new TweenCameraMode(
      camera,
      { position: fromPos, target: fromTarget },
      { position: toPos, target: toTarget },
      VIEW_TWEEN_DURATION,
      () => setCamera(destName),
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
      };
      if (data.shafts && data.shafts.length) {
        morningShaftConfig = {
          shafts: data.shafts.map((s): ShaftDef => ({
            origin: new Vector3(s.origin[0], s.origin[1], s.origin[2]),
            aim: new Vector3(s.aim[0], s.aim[1], s.aim[2]),
            radius: s.radius,
          })),
        };
      }
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

  // Debug gizmo for moving heroes around at runtime. Attached on demand from
  // the dev panel. Disables OrbitControls while dragging so the camera
  // doesn't fight the user. In recent three.js, the visible gizmo is a
  // separate helper Object3D — add that to the scene, not TransformControls
  // itself.
  const transformControls = new TransformControls(camera, renderer.domElement);
  const transformHelper = transformControls.getHelper();
  transformHelper.visible = false;
  transformControls.enabled = false;
  scene.add(transformHelper);
  transformControls.addEventListener('dragging-changed', (event) => {
    const dragging = (event as unknown as { value: boolean }).value;
    // Reach the OrbitControls instance inside FreeformMode if active
    const fm = activeCamera as unknown as { controls?: { enabled: boolean } };
    if (fm.controls) fm.controls.enabled = !dragging;
  });

  const setEditTarget = (heroId: string) => {
    if (heroId === '(none)') {
      transformControls.detach();
      transformHelper.visible = false;
      transformControls.enabled = false;
      return;
    }
    const obj = heroLookup.get(heroId);
    if (!obj) return;
    transformControls.attach(obj);
    transformHelper.visible = true;
    transformControls.enabled = true;
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

  let currentTransformMode: 'translate' | 'rotate' | 'scale' = 'translate';
  const setTransformMode = (mode: 'translate' | 'rotate' | 'scale') => {
    currentTransformMode = mode;
    transformControls.setMode(mode);
  };
  const getTransformMode = () => currentTransformMode;

  // Blender/Maya-ish shortcuts so I can flip the gizmo while dragging the
  // camera around: W=translate, E=rotate, R=scale. Only fire when something
  // is actually attached and the user isn't typing in a dev-panel input.
  window.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (!transformControls.object) return;
    if (e.key === 'w' || e.key === 'W') setTransformMode('translate');
    else if (e.key === 'e' || e.key === 'E') setTransformMode('rotate');
    else if (e.key === 'r' || e.key === 'R') setTransformMode('scale');
  });

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

        // Pass 3: write snapshots into the manifest.
        for (let i = 0; i < placements.length; i++) {
          const snap = snaps[i];
          if (!snap.obj) {
            skipped.push(snap.instanceId + ' (not in scene)');
            continue;
          }
          writePlacement(placements[i], snap.pos, snap.quat, snap.scale);
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

  const setShaftEditTarget = (id: string) => {
    if (id === '(none)') {
      morningShaft.setHandlesVisible(false);
      transformControls.detach();
      transformHelper.visible = false;
      transformControls.enabled = false;
      return;
    }
    const m = id.match(/^shaft (\d+) (origin|aim)$/);
    if (!m) return;
    const index = parseInt(m[1], 10);
    const role = m[2] as 'origin' | 'aim';
    const handle = morningShaft.getShaftHandle(index, role);
    if (!handle) return;
    morningShaft.setHandlesVisible(true);
    transformControls.attach(handle);
    transformHelper.visible = true;
    transformControls.enabled = true;
    // Endpoints are points — only translate makes sense.
    setTransformMode('translate');
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

  const logShaftConfig = () => morningShaft.logShaftConfig();

  // Snapshot current camera pose (position + OrbitControls target if any).
  // Used by both log and save.
  const snapshotCameraPose = (): { position: [number, number, number]; target: [number, number, number] } => {
    const r = (n: number) => Math.round(n * 1000) / 1000;
    const tgt = currentTarget();
    return {
      position: [r(camera.position.x), r(camera.position.y), r(camera.position.z)],
      target: [r(tgt.x), r(tgt.y), r(tgt.z)],
    };
  };

  const logCameraPose = () => {
    console.log('[camera] exterior pose\n' + JSON.stringify(snapshotCameraPose(), null, 2));
  };

  const formatCameraPositions = (data: {
    exterior: { position: [number, number, number]; target: [number, number, number] };
  }): string => {
    const ex = data.exterior;
    return (
      '{\n' +
      '  "exterior": {\n' +
      `    "position": [${ex.position.join(', ')}],\n` +
      `    "target": [${ex.target.join(', ')}]\n` +
      '  }\n' +
      '}\n'
    );
  };

  const saveCameraPose = async () => {
    try {
      const pose = snapshotCameraPose();
      const body = formatCameraPositions({ exterior: pose });
      const res = await fetch('/__lec/save-camera', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      });
      if (!res.ok) throw new Error(`save responded ${res.status}: ${await res.text()}`);
      const result = (await res.json()) as { saved?: string };
      console.log('[camera] saved →', result.saved, pose);
    } catch (e) {
      console.warn('[camera] save failed', e);
    }
  };

  // Compact formatter to match the hand-curated layout of the existing
  // atmosphere JSON — one shaft per line, primitives inline.
  const formatShaftsManifest = (shafts: ReturnType<MorningShaft['getCurrentShafts']>): string => {
    const lines = shafts.map((s) =>
      `    { "origin": [${s.origin.join(', ')}], "aim": [${s.aim.join(', ')}], "radius": ${s.radius} }`,
    );
    return '{\n  "shafts": [\n' + lines.join(',\n') + '\n  ]\n}\n';
  };

  const saveShaftConfig = async () => {
    try {
      const shafts = morningShaft.getCurrentShafts();
      const body = formatShaftsManifest(shafts);
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
      console.log('[atmosphere] saved →', result.saved);
    } catch (e) {
      console.warn('[atmosphere] save failed', e);
    }
  };

  const logHeroPositions = () => {
    // manifest.json takes radians for rotation, so the JSON is paste-ready.
    // The degrees readout that follows is purely for eyeballing.
    const out: Record<string, { position: number[]; rotation: number[]; scale: number[] }> = {};
    const deg: Record<string, number[]> = {};
    const RAD2DEG = 180 / Math.PI;
    for (const [id, obj] of heroLookup) {
      out[id] = {
        position: [r3(obj.position.x), r3(obj.position.y), r3(obj.position.z)],
        rotation: [r3(obj.rotation.x), r3(obj.rotation.y), r3(obj.rotation.z)],
        scale:    [r3(obj.scale.x),    r3(obj.scale.y),    r3(obj.scale.z)],
      };
      deg[id] = [
        Math.round(obj.rotation.x * RAD2DEG * 10) / 10,
        Math.round(obj.rotation.y * RAD2DEG * 10) / 10,
        Math.round(obj.rotation.z * RAD2DEG * 10) / 10,
      ];
    }
    console.log('[positions]\n' + JSON.stringify(out, null, 2));
    console.log('[rotations (deg)]', deg);
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

  createDebugPanel({
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
    heroIds: ['(none)', ...Array.from(heroLookup.keys()).sort()],
    setEditTarget,
    setTransformMode,
    getTransformMode,
    logHeroPositions,
    saveHeroPositions,
    shaftHandleIds,
    setShaftEditTarget,
    logShaftConfig,
    saveShaftConfig,
    logCameraPose,
    saveCameraPose,
  });

  // Bottom-left audio controls: mute toggle + master volume. Volume slider
  // is always editable; mute starts on and is the user's "begin" action.
  createAudioControls(audio);

  // Bottom-center: every loaded track + what's currently playing per channel.
  createTracksBar(audio, AUDIO_ASSETS);

  // Bottom-right info pill — heroes loaded + current state.
  createSceneInfo(heroLookup, stateController);

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

  // Debug hook for runtime inspection — read from devtools as `__lec.heroes`.
  (window as Window & { __lec?: unknown }).__lec = { scene, heroLookup, transformControls };

  let prev = performance.now();
  const tick = (now: number) => {
    const dt = (now - prev) / 1000;
    prev = now;
    stateController.tick(dt);
    active.update(stateController.context);
    activeCamera.update(dt);
    activeAtmosphere.update(atmosphereCtx, dt);
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

function createSceneInfo(heroLookup: Map<string, Object3D>, state: StateController): void {
  const pill = document.createElement('div');
  pill.style.cssText = [
    'position: fixed',
    'bottom: 16px',
    'right: 16px',
    'padding: 8px 14px',
    'background: rgba(15, 15, 15, 0.7)',
    'color: #ddd',
    'font: 12px/1.4 system-ui, sans-serif',
    'border-radius: 12px',
    'backdrop-filter: blur(6px)',
    'z-index: 1000',
    'user-select: none',
    'min-width: 140px',
    'max-width: 220px',
  ].join('; ');
  document.body.appendChild(pill);

  const render = () => {
    while (pill.firstChild) pill.removeChild(pill.firstChild);
    const names = Array.from(heroLookup.keys()).sort();
    const header = document.createElement('div');
    header.style.cssText = 'font-weight: 600; margin-bottom: 4px; letter-spacing: 0.02em;';
    header.textContent = `${names.length} hero${names.length === 1 ? '' : 'es'} • ${state.current}`;
    pill.appendChild(header);

    const list = document.createElement('ul');
    list.style.cssText = 'margin: 0; padding: 0; list-style: none; opacity: 0.8;';
    for (const n of names) {
      const li = document.createElement('li');
      li.style.cssText = 'padding: 1px 0;';
      li.textContent = '• ' + n;
      list.appendChild(li);
    }
    pill.appendChild(list);
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
