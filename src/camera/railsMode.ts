import { CatmullRomCurve3, type PerspectiveCamera, Vector3 } from 'three';
import type { CameraMode, TunableSpec } from './cameraMode';

export interface RailsConfig {
  /** Waypoints in world space; camera moves along the spline through them. */
  path: Vector3[];
  /** Either a fixed point to look at, or 'ahead' (look forward along the path). */
  lookAt: Vector3 | 'ahead';
  closed?: boolean;
  /** Wheel deltaY → t multiplier. Smaller = slower. */
  speed?: number;
  initialT?: number;
}

const TUNABLES: TunableSpec[] = [
  { key: 't', label: 'rails t', min: 0, max: 1, step: 0.001 },
  { key: 'speed', label: 'wheel speed', min: 0.0001, max: 0.005, step: 0.0001 },
  { key: 'smoothing', label: 'smoothing', min: 0.01, max: 1, step: 0.01 },
];

export class RailsMode implements CameraMode {
  private curve: CatmullRomCurve3;
  private _t: number;
  private targetT: number;
  speed: number;
  smoothing = 0.1;
  private readonly closed: boolean;

  constructor(
    private camera: PerspectiveCamera,
    private domElement: HTMLElement,
    private config: RailsConfig,
  ) {
    this.curve = new CatmullRomCurve3(
      config.path.map((p) => p.clone()),
      config.closed ?? false,
    );
    this.speed = config.speed ?? 0.0006;
    this.closed = config.closed ?? false;
    this._t = config.initialT ?? 0;
    this.targetT = this._t;
  }

  get t(): number { return this._t; }
  set t(v: number) {
    this._t = this.clampT(v);
    this.targetT = this._t;
    this.applyAt(this._t);
  }

  init(): void {
    this.applyAt(this._t);
    this.domElement.addEventListener('wheel', this.handleWheel, { passive: false });
  }

  update(): void {
    let diff = this.targetT - this._t;
    // For a closed loop, wrap diff into the shorter direction so the camera
    // doesn't lerp the long way across the seam (e.g. 0.95 -> 0.05 should
    // travel +0.10, not -0.90).
    if (this.closed) {
      if (diff > 0.5) diff -= 1;
      else if (diff < -0.5) diff += 1;
    }
    if (Math.abs(diff) > 0.00005) {
      this._t = this.clampT(this._t + diff * this.smoothing);
      this.applyAt(this._t);
    }
  }

  dispose(): void {
    this.domElement.removeEventListener('wheel', this.handleWheel);
  }

  getTunables() {
    return { target: this, specs: TUNABLES };
  }

  private clampT(v: number): number {
    if (this.closed) return ((v % 1) + 1) % 1;
    return Math.max(0, Math.min(1, v));
  }

  private handleWheel = (e: WheelEvent) => {
    e.preventDefault();
    this.targetT = this.clampT(this.targetT + e.deltaY * this.speed);
  };

  private applyAt(t: number): void {
    const tt = this.clampT(t);
    const pos = this.curve.getPointAt(tt);
    this.camera.position.copy(pos);

    if (this.config.lookAt === 'ahead') {
      const lookT = this.closed ? this.clampT(tt + 0.01) : Math.min(1, tt + 0.01);
      const ahead = this.curve.getPointAt(lookT);
      if (ahead.distanceToSquared(pos) > 1e-6) this.camera.lookAt(ahead);
    } else {
      this.camera.lookAt(this.config.lookAt);
    }
  }
}
