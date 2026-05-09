import type { Camera, Vector3 } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { CameraMode, TunableSpec } from './cameraMode';

const TUNABLES: TunableSpec[] = [
  { key: 'damping', label: 'damping', min: 0, max: 0.3, step: 0.01 },
  { key: 'rotateSpeed', label: 'rotate speed', min: 0.1, max: 3, step: 0.1 },
  { key: 'zoomSpeed', label: 'zoom speed', min: 0.1, max: 3, step: 0.1 },
];

export class FreeformMode implements CameraMode {
  private controls: OrbitControls | null = null;

  private _damping = 0.05;
  private _rotateSpeed = 1;
  private _zoomSpeed = 1;

  get damping(): number { return this._damping; }
  set damping(v: number) {
    this._damping = v;
    if (this.controls) this.controls.dampingFactor = v;
  }

  get rotateSpeed(): number { return this._rotateSpeed; }
  set rotateSpeed(v: number) {
    this._rotateSpeed = v;
    if (this.controls) this.controls.rotateSpeed = v;
  }

  get zoomSpeed(): number { return this._zoomSpeed; }
  set zoomSpeed(v: number) {
    this._zoomSpeed = v;
    if (this.controls) this.controls.zoomSpeed = v;
  }

  constructor(
    private camera: Camera,
    private domElement: HTMLElement,
    private target: Vector3,
  ) {}

  init(): void {
    this.controls = new OrbitControls(this.camera, this.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = this._damping;
    this.controls.rotateSpeed = this._rotateSpeed;
    this.controls.zoomSpeed = this._zoomSpeed;
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

  getTunables() {
    return { target: this, specs: TUNABLES };
  }
}
