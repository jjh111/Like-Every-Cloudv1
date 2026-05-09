import { Group, Vector3 } from 'three';
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
import { buildPlaceholderScene } from './placeholder/placeholderScene';
import { createDebugPanel } from './debug/debugPanel';

export async function start(container: HTMLElement): Promise<void> {
  const scene = createScene();
  const camera = createCamera(window.innerWidth, window.innerHeight);
  const renderer = createRenderer();
  renderer.setSize(window.innerWidth, window.innerHeight);
  container.appendChild(renderer.domElement);

  // Camera modes — pluggable like transitions. Eventual UX will likely be rails;
  // freeform stays around for debug & exploration.
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

  // Everything state-tagged lives under contentRoot.
  // GLBs from /public/scene/* land here once the asset pipeline produces them.
  const contentRoot = new Group();
  scene.add(contentRoot);

  for (const obj of buildPlaceholderScene()) contentRoot.add(obj);

  const glb = new GLBLoader();
  const heroes = new HeroLoader(glb);
  try {
    const heroObjects = await heroes.loadFromManifest('/heroes/manifest.json');
    for (const h of heroObjects) contentRoot.add(h);
  } catch (e) {
    console.warn('[heroes] manifest load failed', e);
  }

  // State + transition wiring. Transitions are pluggable so the eventual UX
  // (chosen with the client) can swap in here without touching the rest.
  const stateController = new StateController();
  const transitions: Record<string, Transition> = {
    'instant-swap': new InstantSwap(),
    'opacity-crossfade (sample)': new OpacityCrossfade(),
  };
  const initialName = 'instant-swap';
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
  pointer.onClick = ({ heroId }) => {
    console.log('[interaction] hero clicked:', heroId);
  };
  pointer.attach();

  createDebugPanel({
    state: stateController,
    transitions,
    setTransition,
    initialTransition: initialName,
    cameras,
    setCamera,
    initialCamera: initialCameraName,
  });

  window.addEventListener('resize', () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  });

  let prev = performance.now();
  const tick = (now: number) => {
    const dt = (now - prev) / 1000;
    prev = now;
    stateController.tick(dt);
    active.update(stateController.context);
    activeCamera.update(dt);
    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
