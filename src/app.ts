import { Group, Mesh, type MeshStandardMaterial, type Object3D, Vector3 } from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { createCamera, createRenderer, createScene } from './scene/sceneGraph';
import type { CameraMode } from './camera/cameraMode';
import { FreeformMode } from './camera/freeformMode';
import type { FreeformInitOptions } from './camera/freeformMode';
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
import { AudioManager, type AudioChannel } from './audio/audioManager';
import { AUDIO_ASSETS, type AudioAsset } from './audio/manifest';
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

  const logHeroPositions = () => {
    // manifest.json takes radians for rotation, so the JSON is paste-ready.
    // We also print a degrees readout afterwards because radians are awful
    // to eyeball.
    const out: Record<string, { position: number[]; rotation: number[]; scale: number[] }> = {};
    const deg: Record<string, number[]> = {};
    const r = (n: number) => Math.round(n * 1000) / 1000;
    const RAD2DEG = 180 / Math.PI;
    for (const [id, obj] of heroLookup) {
      out[id] = {
        position: [r(obj.position.x), r(obj.position.y), r(obj.position.z)],
        rotation: [r(obj.rotation.x), r(obj.rotation.y), r(obj.rotation.z)],
        scale:    [r(obj.scale.x),    r(obj.scale.y),    r(obj.scale.z)],
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
    audio,
    getView,
    toggleView: () => setView(getView() === 'exterior' ? 'interior' : 'exterior'),
    heroIds: ['(none)', ...Array.from(heroLookup.keys()).sort()],
    setEditTarget,
    setTransformMode,
    getTransformMode,
    logHeroPositions,
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
