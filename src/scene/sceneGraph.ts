import {
  Fog,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  WebGLRenderer,
} from 'three';

// Color that matches the CSS body gradient's horizon stop. Used as initial
// fog color so the ground plane fades cleanly before SunRig boots and
// starts driving the fog colour from its palette each frame.
const HORIZON_COLOR = 0xc9a878;

// Sun + ambient lights are NOT created here anymore — they live on SunRig
// (src/atmosphere/sunRig.ts), which owns the entire palette and drives them
// from the TimeOfDayClock each frame. createScene only sets up the things
// SunRig doesn't touch: the fog, the ground plane, the scene container.
export function createScene(): Scene {
  const scene = new Scene();
  // CloudSky paints a sky dome that fills the background; the renderer
  // stays alpha:true so the CSS body gradient remains the load-time
  // fallback under the canvas until the dome is up.
  scene.background = null;
  scene.fog = new Fog(HORIZON_COLOR, 35, 110);

  // Ground plane extending to the fog horizon. y matches the photoscan's dirt
  // level so the boundary blends rather than floating/clipping.
  const floor = new Mesh(
    new PlaneGeometry(500, 500),
    new MeshStandardMaterial({ color: 0xa68a64, roughness: 0.95 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.6;
  scene.add(floor);

  return scene;
}

export function createCamera(width: number, height: number): PerspectiveCamera {
  // 75° vertical FOV ≈ 24mm equivalent on full-frame — wide enough to feel
  // immersive in the interior without distorting facades from outside.
  const camera = new PerspectiveCamera(75, width / height, 0.1, 200);
  camera.position.set(12, 5, 8);
  camera.lookAt(2.0, 1.5, -1.6);
  return camera;
}

export function createRenderer(): WebGLRenderer {
  const renderer = new WebGLRenderer({ antialias: true, alpha: true });
  renderer.setClearAlpha(0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  return renderer;
}
