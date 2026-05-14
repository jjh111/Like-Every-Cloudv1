import { CatmullRomCurve3, Vector3, type PerspectiveCamera } from 'three';
import type { CameraMode, Tunables } from './cameraMode';

export interface CameraPose {
  position: Vector3;
  target: Vector3;
}

/**
 * Transient camera mode that animates between two poses then hands off via
 * onComplete(). Not registered in the cameras map — instantiated on demand
 * from setView() to animate the outside↔inside transition.
 *
 * Pass `waypoint` (e.g. the doorway threshold) to route the camera through
 * an intermediate point — a Catmull-Rom spline through [from, waypoint, to]
 * curves the path so it doesn't clip walls. Without a waypoint, the path
 * is a straight lerp.
 */
export class TweenCameraMode implements CameraMode {
  private elapsed = 0;
  private done = false;
  private curve: CatmullRomCurve3 | null = null;
  private tempPos = new Vector3();

  constructor(
    private camera: PerspectiveCamera,
    private from: CameraPose,
    private to: CameraPose,
    private duration: number,
    private onComplete: () => void,
    waypoint?: Vector3,
  ) {
    if (waypoint) {
      this.curve = new CatmullRomCurve3([
        this.from.position.clone(),
        waypoint.clone(),
        this.to.position.clone(),
      ]);
    }
  }

  init(): void { /* no-op — pose is set per update() */ }

  update(dt: number): void {
    if (this.done) return;
    this.elapsed += dt;
    const t = Math.min(1, this.elapsed / this.duration);
    // Smootherstep — slow start + slow end. Reads as cinematic vs linear lerp.
    const e = t * t * t * (t * (t * 6 - 15) + 10);

    if (this.curve) {
      this.curve.getPointAt(e, this.tempPos);
      this.camera.position.copy(this.tempPos);
    } else {
      this.camera.position.copy(this.from.position).lerp(this.to.position, e);
    }
    const target = this.from.target.clone().lerp(this.to.target, e);
    this.camera.lookAt(target);

    if (t >= 1 && !this.done) {
      this.done = true;
      // Hand off to the destination camera. setCamera will dispose us.
      this.onComplete();
    }
  }

  dispose(): void { /* no-op — no resources held */ }

  getTunables(): Tunables {
    return { target: {}, specs: [] };
  }
}
