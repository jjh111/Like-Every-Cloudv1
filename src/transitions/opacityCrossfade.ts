import type { Material, Mesh, Object3D, Scene } from 'three';
import type { Transition } from './transition';
import type { StateContext } from '../state/types';
import { getStateTag, type StateTag } from '../scene/tagging';

// Sample alternative transition — NOT a chosen UX, just one possibility.
// Notes for production:
//  - Clones materials per mesh, which breaks material/InstancedMesh sharing.
//    Real assets should use a smarter approach (e.g. shader uniform or
//    per-instance attribute).
//  - 'both'-tagged nodes stay fully opaque through the transition.
//
// Cache model: we collect every **outermost** Object3D that carries a
// state tag — i.e., a stated node whose ancestors don't also carry state.
// Each such node gathers all its mesh descendants and the crossfade
// applies opacity to those meshes as a group. Hero roots tagged via
// heroLoader fit this naturally: the root has a state, its children
// don't, and toggling the root's tag flips visibility for the whole
// subtree. Plain scene meshes tagged directly in Blender still work
// because they're their own "outermost stated" node.
interface StatedNode {
  root: Object3D;
  meshes: Mesh[];
}

export class OpacityCrossfade implements Transition {
  private nodes: StatedNode[] = [];

  init(scene: Scene): void {
    this.nodes = [];
    scene.traverse((obj) => {
      const tag = getStateTag(obj);
      // 'both' nodes are always fully opaque — skip.
      if (!tag || tag === 'both') return;
      // Skip if an ancestor is already a stated node — we only manage
      // the outermost stated object so a hero root + tagged inner mesh
      // don't both fight for control.
      let anc = obj.parent;
      while (anc && anc !== scene) {
        const ancTag = getStateTag(anc);
        if (ancTag && ancTag !== 'both') return;
        anc = anc.parent;
      }
      // Gather mesh descendants (including obj itself if it's a mesh).
      const meshes: Mesh[] = [];
      obj.traverse((child) => {
        const m = child as Mesh;
        if (m.isMesh) meshes.push(m);
      });
      if (meshes.length === 0) return;
      // Clone materials so opacity edits don't leak across shared materials.
      for (const mesh of meshes) {
        mesh.material = Array.isArray(mesh.material)
          ? mesh.material.map((m) => m.clone())
          : (mesh.material as Material).clone();
        this.setTransparent(mesh, true);
      }
      this.nodes.push({ root: obj, meshes });
    });
  }

  update(ctx: StateContext): void {
    const transitioning = ctx.current !== ctx.target;
    for (const node of this.nodes) {
      const tag = getStateTag(node.root) as StateTag | undefined;
      // 'both' is filtered at init time; only past/present nodes reach here.
      let op = 0;
      if (transitioning) {
        if (tag === ctx.target) op = ctx.progress;
        else if (tag === ctx.current) op = 1 - ctx.progress;
      } else if (tag === ctx.current) {
        op = 1;
      }
      const visible = op > 0.001;
      for (const mesh of node.meshes) {
        this.setOpacity(mesh, op);
        mesh.visible = visible;
      }
    }
  }

  dispose(): void {
    for (const node of this.nodes) {
      for (const mesh of node.meshes) {
        this.setTransparent(mesh, false);
        this.setOpacity(mesh, 1);
        mesh.visible = true;
      }
    }
    this.nodes = [];
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
