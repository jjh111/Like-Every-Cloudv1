import {
  AmbientLight,
  DirectionalLight,
  Fog,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  WebGLRenderer,
} from 'three';

// Color that matches the CSS body gradient's horizon stop. Used as fog
// color so the ground plane fades into the horizon line of the sky.
const HORIZON_COLOR = 0xc9a878;

export function createScene(): Scene {
  const scene = new Scene();
  // Renderer is alpha:true; the CSS body gradient (set in index.html) shows
  // through. scene.background stays null.
  scene.background = null;
  scene.fog = new Fog(HORIZON_COLOR, 35, 110);

  // Warm daylight: a bright key + soft warm fill.
  const ambient = new AmbientLight(0xfff2dd, 0.7);
  scene.add(ambient);

  const sun = new DirectionalLight(0xfff2dd, 1.3);
  sun.position.set(15, 20, 10);
  scene.add(sun);

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
