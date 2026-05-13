import { Group, Mesh, type MeshStandardMaterial, type Object3D, Vector3 } from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { createCamera, createRenderer, createScene } from './scene/sceneGraph';
import type { CameraMode } from './camera/cameraMode';
import { FreeformMode } from './camera/freeformMode';
import { RailsMode } from './camera/railsMode';
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

export async function start(container: HTMLElement): Promise<void> {
  const scene = createScene();
  const camera = createCamera(window.innerWidth, window.innerHeight);
  const renderer = createRenderer();
  renderer.setSize(window.innerWidth, window.innerHeight);
  container.appendChild(renderer.domElement);

  // Camera modes.
  // Exterior target = photoscan center, used for the freeform orbit.
  // Interior path lives inside SolidWallStructure's footprint (3.7×5.4m,
  // centered ~(-0.9, _, -0.5)). Tightened to 0.85m inset and routed to pass
  // near each hero's placement so the walk reads as a tour.
  const exteriorTarget = new Vector3(2.0, 1.5, -1.6);
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

  // View state — high-level "are we outside or inside" toggle. The dev panel
  // exposes a single button that flips this, which in turn picks the camera
  // mode. Users can still fine-tune via the camera mode dropdown.
  let view: 'exterior' | 'interior' = 'exterior';
  const setView = (v: 'exterior' | 'interior') => {
    view = v;
    if (v === 'exterior') {
      // Snap camera back to the establishing shot before re-engaging freeform.
      camera.position.set(12, 5, 8);
      camera.lookAt(2.0, 1.5, -1.6);
      setCamera('freeform');
    } else {
      setCamera('interior-orbit');
    }
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
    // Auto-switch to freeform so the user can orbit around the gizmo.
    if (activeCamera !== cameras['freeform']) {
      setCamera('freeform');
    }
  };

  const setTransformMode = (mode: 'translate' | 'rotate' | 'scale') => {
    transformControls.setMode(mode);
  };

  const logHeroPositions = () => {
    const out: Record<string, { position: number[]; rotation: number[]; scale: number[] }> = {};
    const r = (n: number) => Math.round(n * 1000) / 1000;
    for (const [id, obj] of heroLookup) {
      out[id] = {
        position: [r(obj.position.x), r(obj.position.y), r(obj.position.z)],
        rotation: [r(obj.rotation.x), r(obj.rotation.y), r(obj.rotation.z)],
        scale:    [r(obj.scale.x),    r(obj.scale.y),    r(obj.scale.z)],
      };
    }
    console.log('[positions]\n' + JSON.stringify(out, null, 2));
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
    audio,
    getView,
    toggleView: () => setView(getView() === 'exterior' ? 'interior' : 'exterior'),
    heroIds: ['(none)', ...Array.from(heroLookup.keys()).sort()],
    setEditTarget,
    setTransformMode,
    logHeroPositions,
  });

  // Bottom-left audio controls: mute toggle + master volume. Volume slider
  // is always editable; mute starts on and is the user's "begin" action.
  createAudioControls(audio);

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
