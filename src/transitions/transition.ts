import type { Scene } from 'three';
import type { StateContext } from '../state/types';

// Transition is the swappable strategy that decides how state changes look.
// Keeping this as an interface lets us prototype any UX (instant, fade, wipe,
// material swap, camera move, etc.) without rewiring the rest of the system.
export interface Transition {
  init(scene: Scene): void;
  update(ctx: StateContext): void;
  dispose(): void;
}
