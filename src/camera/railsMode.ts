import { CatmullRomCurve3, type PerspectiveCamera, Vector3 } from 'three';
import type { CameraMode } from './cameraMode';

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

export class RailsMode implements CameraMode {
  private curve: CatmullRomCurve3;
  private t: number;
  private targetT: number;
  private readonly speed: number;
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
    this.t = config.initialT ?? 0;
    this.targetT = this.t;
  }

  init(): void {
    this.applyAt(this.t);
    this.domElement.addEventListener('wheel', this.handleWheel, { passive: false });
  }

  update(): void {
    const diff = this.targetT - this.t;
    if (Math.abs(diff) > 0.00005) {
      this.t += diff * 0.1;
      this.applyAt(this.t);
    }
  }

  dispose(): void {
    this.domElement.removeEventListener('wheel', this.handleWheel);
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
