import type { Material, Mesh, Scene } from 'three';
import type { Transition } from './transition';
import type { StateContext } from '../state/types';
import { getStateTag } from '../scene/tagging';

// Sample alternative transition — NOT a chosen UX, just one possibility.
// Notes for production:
//  - Clones materials per mesh, which breaks material/InstancedMesh sharing.
//    Real assets should use a smarter approach (e.g. shader uniform or
//    per-instance attribute).
//  - 'both'-tagged meshes stay fully opaque through the transition.
export class OpacityCrossfade implements Transition {
  private meshes: Mesh[] = [];

  init(scene: Scene): void {
    this.meshes = [];
    scene.traverse((obj) => {
      const tag = getStateTag(obj);
      // 'both'-tagged meshes are always fully opaque — don't mark them
      // transparent. With transparent:true on always-opaque materials,
      // three.js's alpha sort kicks in and back faces can bleed through
      // (visible on the table's lace front panel).
      if (!tag || tag === 'both') return;
      const mesh = obj as Mesh;
      if (!mesh.isMesh) return;
      mesh.material = Array.isArray(mesh.material)
        ? mesh.material.map((m) => m.clone())
        : (mesh.material as Material).clone();
      this.setTransparent(mesh, true);
      this.meshes.push(mesh);
    });
  }

  update(ctx: StateContext): void {
    const transitioning = ctx.current !== ctx.target;
    for (const mesh of this.meshes) {
      const tag = getStateTag(mesh);
      // 'both' is filtered out in init(); only past/present meshes reach here.
      let op = 0;
      if (transitioning) {
        if (tag === ctx.target) op = ctx.progress;
        else if (tag === ctx.current) op = 1 - ctx.progress;
      } else if (tag === ctx.current) {
        op = 1;
      }
      this.setOpacity(mesh, op);
      mesh.visible = op > 0.001;
    }
  }

  dispose(): void {
    for (const mesh of this.meshes) {
      this.setTransparent(mesh, false);
      this.setOpacity(mesh, 1);
      mesh.visible = true;
    }
    this.meshes = [];
  }

  private setTransparent(mesh: Mesh, transparent: boolean) {
    const apply = (m: Material) => {
      m.transparent = transparent;
      m.needsUpdate = true;
    };
    if (Array.isArray(mesh.material)) mesh.material.forEach(apply);
    else apply(mesh.material as Material);
  }

  private setOpacity(mesh: Mesh, op: number) {
    const apply = (m: Material) => {
      (m as Material & { opacity: number }).opacity = op;
    };
    if (Array.isArray(mesh.material)) mesh.material.forEach(apply);
    else apply(mesh.material as Material);
  }
}
