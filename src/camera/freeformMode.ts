import type { Camera, Vector3 } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { CameraMode } from './cameraMode';

export class FreeformMode implements CameraMode {
  private controls: OrbitControls | null = null;

  constructor(
    private camera: Camera,
    private domElement: HTMLElement,
    private target: Vector3,
  ) {}

  init(): void {
    this.controls = new OrbitControls(this.camera, this.domElement);
    this.controls.enableDamping = true;
    this.controls.target.copy(this.target);
    this.controls.update();
  }

  update(): void {
    this.controls?.update();
  }

  dispose(): void {
    this.controls?.dispose();
    this.controls = null;
  }
}
