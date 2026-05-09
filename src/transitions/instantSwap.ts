import type { Object3D, Scene } from 'three';
import type { Transition } from './transition';
import type { StateContext } from '../state/types';
import { getStateTag } from '../scene/tagging';

// Baseline transition: hide/show by current state. Ignores progress.
// Exists so the system runs end-to-end without committing to any UX yet.
export class InstantSwap implements Transition {
  private targets: Object3D[] = [];

  init(scene: Scene): void {
    this.targets = [];
    scene.traverse((obj) => {
      if (getStateTag(obj)) this.targets.push(obj);
    });
    this.targets.forEach((o) => (o.visible = true));
  }

  update(ctx: StateContext): void {
    for (const obj of this.targets) {
      const tag = getStateTag(obj);
      obj.visible = tag === 'both' || tag === ctx.current;
    }
  }

  dispose(): void {
    for (const obj of this.targets) obj.visible = true;
    this.targets = [];
  }
}
