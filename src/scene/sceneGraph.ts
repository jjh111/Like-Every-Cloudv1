import {
  AmbientLight,
  Color,
  DirectionalLight,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
} from 'three';

export function createScene(): Scene {
  const scene = new Scene();
  scene.background = new Color(0x111111);

  const ambient = new AmbientLight(0xffffff, 0.4);
  scene.add(ambient);

  const dir = new DirectionalLight(0xffffff, 1.0);
  dir.position.set(5, 8, 4);
  scene.add(dir);

  return scene;
}

export function createCamera(width: number, height: number): PerspectiveCamera {
  const camera = new PerspectiveCamera(50, width / height, 0.1, 100);
  camera.position.set(0, 1.6, 2.5);
  camera.lookAt(0, 1.6, 0);
  return camera;
}

export function createRenderer(): WebGLRenderer {
  const renderer = new WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  return renderer;
}
