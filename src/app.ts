import { Group, Mesh, type MeshStandardMaterial, type Object3D, Vector3 } from 'three';
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
import { buildPlaceholderScene } from './placeholder/placeholderScene';
import { getHeroId } from './scene/tagging';
import { createDebugPanel } from './debug/debugPanel';

export async function start(container: HTMLElement): Promise<void> {
  const scene = createScene();
  const camera = createCamera(window.innerWidth, window.innerHeight);
  const renderer = createRenderer();
  renderer.setSize(window.innerWidth, window.innerHeight);
  container.appendChild(renderer.domElement);

  // Camera modes — pluggable like transitions.
  const lookAtCenter = new Vector3(0, 1.6, 0);
  const railsPath: Vector3[] = [
    new Vector3(0, 1.6, 2.5),
    new Vector3(-1.5, 1.6, 1),
    new Vector3(-1.5, 1.6, -1),
    new Vector3(0, 1.6, -1.2),
    new Vector3(1.5, 1.6, -1),
    new Vector3(1.5, 1.6, 1),
    new Vector3(0, 1.6, 2.5),
  ];

  const cameras: Record<string, CameraMode> = {
    'freeform': new FreeformMode(camera, renderer.domElement, lookAtCenter),
    'rails-walk': new RailsMode(camera, renderer.domElement, {
      path: railsPath,
      lookAt: 'ahead',
      closed: true,
    }),
    'rails-orbit': new RailsMode(camera, renderer.domElement, {
      path: railsPath,
      lookAt: lookAtCenter,
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

  const placeholders = buildPlaceholderScene();
  for (const obj of placeholders) contentRoot.add(obj);
  indexHeroes(placeholders);

  const glb = new GLBLoader();
  const heroes = new HeroLoader(glb);
  try {
    const heroObjects = await heroes.loadFromManifest('/heroes/manifest.json');
    for (const h of heroObjects) contentRoot.add(h);
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
  });

  // Bottom-left audio controls: mute toggle + master volume. Volume slider
  // is always editable; mute starts on and is the user's "begin" action.
  createAudioControls(audio);

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
