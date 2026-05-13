import type { Camera, Scene } from 'three';
import type { TunableSpec } from '../camera/cameraMode';

// Swappable atmosphere strategy. Same pluggability pattern as Transition /
// CameraMode — lets us prototype "morning shaft", "dusk haze", "no atmosphere"
// and eventually tie a variant to the past/present state.
export interface AtmosphereContext {
  scene: Scene;
  camera: Camera;
}

export interface AtmosphereTunables {
  /** Object whose properties are tunables. Dev panel binds to it directly. */
  target: object;
  specs: TunableSpec[];
}

export interface Atmosphere {
  init(ctx: AtmosphereContext): void;
  update(ctx: AtmosphereContext, dt: number): void;
  dispose(ctx: AtmosphereContext): void;
  getTunables?(): AtmosphereTunables;
}

export class NoAtmosphere implements Atmosphere {
  init(): void { /* no-op */ }
  update(): void { /* no-op */ }
  dispose(): void { /* no-op */ }
}
