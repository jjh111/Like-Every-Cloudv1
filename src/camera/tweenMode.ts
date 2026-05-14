import { Vector3, type PerspectiveCamera } from 'three';
import type { CameraMode, Tunables } from './cameraMode';

export interface CameraPose {
  position: Vector3;
  target: Vector3;
}

/**
 * Transient camera mode that lerps position + lookAt between two poses, then
 * hands off to a destination camera by invoking onComplete(). Not registered
 * in the cameras map — instantiated on demand from setView() to animate the
 * outside↔inside transition. After completion the destination camera mode
 * resumes control.
 */
export class TweenCameraMode implements CameraMode {
  private elapsed = 0;
  private done = false;

  constructor(
    private camera: PerspectiveCamera,
    private from: CameraPose,
    private to: CameraPose,
    private duration: number,
    private onComplete: () => void,
  ) {}

  init(): void { /* no-op — pose is set per update() */ }

  update(dt: number): void {
    if (this.done) return;
    this.elapsed += dt;
    const t = Math.min(1, this.elapsed / this.duration);
    // Smootherstep — slow start + slow end. Reads as cinematic vs linear lerp.
    const e = t * t * t * (t * (t * 6 - 15) + 10);

    this.camera.position.copy(this.from.position).lerp(this.to.position, e);
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
