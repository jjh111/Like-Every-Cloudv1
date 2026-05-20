import {
  AdditiveBlending,
  BackSide,
  Color,
  Mesh,
  MeshBasicMaterial,
  type MeshStandardMaterial,
  type Object3D,
} from 'three';
import type { PointerInteraction } from '../interaction/pointer';

// Visual feedback for hovered + selected hero objects.
//
// Two tiers stacked on top of the existing boombox emissive trick:
//
//   - HOVER  — boost emissiveIntensity on every MeshStandardMaterial in the
//              hovered subtree. Restore on hoverOut. Near-zero per-frame
//              cost: one material walk per hover transition.
//   - SELECT — same emissive boost (slightly stronger) + an inverted-hull
//              outline mesh. A clone of the hovered object's geometry,
//              scaled 1.04, rendered back-face only with a constant
//              additive color. One extra draw call per selected hero.
//
// State model:
//   - Click a hero        → selects it (replaces any prior selection)
//   - Click the same hero → deselects (toggle)
//   - Click empty space   → deselects
//
// Per-hero opt-outs via userData on the hero root:
//   - `no_outline:    true` — skip the inverted-hull pass (use for open
//                              surfaces like cloth where the hull doesn't
//                              work cleanly). Emissive boost still applied.
//   - `no_highlight:  true` — skip the entire highlight system. Useful for
//                              decorative meshes that should react via
//                              their own custom shader.
//
// Material-of-record:
//   We mutate `emissive` + `emissiveIntensity` on each MeshStandardMaterial
//   we touch, AFTER snapshotting the originals so dispose() can restore. If
//   a material is shared across multiple heroes, this is broken (snapshot
//   gets overwritten). In practice GLTFLoader clones materials per primitive
//   in this project so it's safe; if a future material gets explicitly
//   shared, opt that hero out via `no_highlight`.

export interface HoverHighlightDeps {
  pointer: PointerInteraction;
  /** Hover emissive intensity (added to original). 0.35 reads as "subtle pop". */
  hoverEmissive?: number;
  /** Selection emissive intensity (added to original). 0.7 reads as "this is
   *  actively chosen — and stays so after pointer leaves". */
  selectEmissive?: number;
  /** Highlight color. Warm cream by default so it reads against the room's
   *  warm/amber palette without screaming neon. */
  color?: Color;
}

interface MaterialSnapshot {
  mat: MeshStandardMaterial;
  emissive: Color;
  intensity: number;
}

export class HoverHighlight {
  private hoverEmissive: number;
  private selectEmissive: number;
  private color: Color;

  private hoveredRoot: Object3D | null = null;
  private selectedRoot: Object3D | null = null;
  private hoverSnapshots: MaterialSnapshot[] = [];
  private selectSnapshots: MaterialSnapshot[] = [];
  private outlineMesh: Object3D | null = null;
  private outlineParent: Object3D | null = null;
  private disposeHandlers: Array<() => void> = [];

  constructor(deps: HoverHighlightDeps) {
    this.hoverEmissive = deps.hoverEmissive ?? 0.35;
    this.selectEmissive = deps.selectEmissive ?? 0.7;
    this.color = (deps.color ?? new Color(0xfff2c8)).clone();

    this.disposeHandlers.push(
      deps.pointer.on('hoverIn', (info) => this.handleHoverIn(info.object)),
    );
    this.disposeHandlers.push(
      deps.pointer.on('hoverOut', () => this.handleHoverOut()),
    );
    this.disposeHandlers.push(
      deps.pointer.on('click', (info) => this.handleClick(info.object)),
    );
  }

  /** Programmatically clear selection — e.g. when a UI panel changes state
   *  and the previously-selected hero shouldn't read as "still selected".
   *  Hover state is independent and stays put. */
  clearSelection(): void {
    if (this.selectedRoot) {
      this.restoreSnapshots(this.selectSnapshots);
      this.selectSnapshots = [];
      this.removeOutline();
      this.selectedRoot = null;
    }
  }

  dispose(): void {
    this.clearSelection();
    this.handleHoverOut();
    for (const fn of this.disposeHandlers) fn();
    this.disposeHandlers = [];
  }

  // ── private ────────────────────────────────────────────────────────────

  private isOptedOut(root: Object3D): boolean {
    return root.userData?.no_highlight === true;
  }

  private skipOutline(root: Object3D): boolean {
    return root.userData?.no_outline === true;
  }

  /** Walk the root's subtree, collect MeshStandardMaterials whose emissive
   *  we can safely boost. Snapshots are pushed onto the provided array so
   *  restore() can undo exactly what we did. */
  private collectAndBoost(root: Object3D, intensity: number, snapshots: MaterialSnapshot[]): void {
    root.traverse((child) => {
      const mesh = child as Mesh;
      if (!mesh.isMesh) return;
      const mat = mesh.material as MeshStandardMaterial | MeshStandardMaterial[];
      const materials = Array.isArray(mat) ? mat : [mat];
      for (const m of materials) {
        // Duck-check rather than instanceof — bundlers sometimes split three
        // across versions and break instanceof, but the .emissive field is
        // stable since r80.
        if (!m || !(m as MeshStandardMaterial).emissive) continue;
        const std = m as MeshStandardMaterial;
        snapshots.push({
          mat: std,
          emissive: std.emissive.clone(),
          intensity: std.emissiveIntensity,
        });
        // Add (not replace) so a material that's already emissive (the
        // boombox in "playing" state) doesn't visually reset on hover.
        std.emissive.copy(std.emissive).add(this.color.clone().multiplyScalar(intensity));
        std.emissiveIntensity = std.emissiveIntensity + intensity;
      }
    });
  }

  private restoreSnapshots(snapshots: MaterialSnapshot[]): void {
    for (const s of snapshots) {
      s.mat.emissive.copy(s.emissive);
      s.mat.emissiveIntensity = s.intensity;
    }
  }

  private handleHoverIn(obj: Object3D): void {
    const root = this.resolveRoot(obj);
    if (!root || this.isOptedOut(root)) return;
    // Don't re-apply hover boost if this root is already the selection —
    // selection already wins visually (stronger boost), and double-applying
    // would shift the values out of bounds.
    if (root === this.selectedRoot) {
      this.hoveredRoot = root;
      return;
    }
    if (this.hoveredRoot === root) return;
    this.handleHoverOut();
    this.hoveredRoot = root;
    this.collectAndBoost(root, this.hoverEmissive, this.hoverSnapshots);
  }

  private handleHoverOut(): void {
    if (!this.hoveredRoot) return;
    this.restoreSnapshots(this.hoverSnapshots);
    this.hoverSnapshots = [];
    this.hoveredRoot = null;
  }

  private handleClick(obj: Object3D): void {
    const root = this.resolveRoot(obj);
    if (!root) {
      // Empty-space click would route to a different code path; the pointer
      // system only fires `click` on interactive hits.
      return;
    }
    if (this.isOptedOut(root)) return;
    // Toggle if clicking the same selection.
    if (root === this.selectedRoot) {
      this.clearSelection();
      // Hover-in-place after deselect — restore hover boost (if user is
      // still over the same hero).
      this.handleHoverIn(obj);
      return;
    }
    // Promote: clear old selection + clear current hover boost (which would
    // double-stack), then apply selection boost.
    this.clearSelection();
    this.handleHoverOut();
    this.selectedRoot = root;
    this.collectAndBoost(root, this.selectEmissive, this.selectSnapshots);
    if (!this.skipOutline(root)) this.addOutline(root);
  }

  /** Walk up to the topmost ancestor still carrying `hero_id` userData. The
   *  pointer system already gives us the hero root, but a future click that
   *  bypasses the engine might pass an inner mesh; resolving here is cheap
   *  insurance. */
  private resolveRoot(obj: Object3D): Object3D | null {
    let cur: Object3D | null = obj;
    while (cur) {
      if (cur.userData?.hero_id) return cur;
      cur = cur.parent;
    }
    return obj; // fall back to whatever the pointer handed us
  }

  /** Inverted-hull outline: clone meshes in the subtree, render back-faces
   *  only at a slight outset, additive blend, depthWrite off. Looks like a
   *  thin colored rim around the silhouette without any post-processing. */
  private addOutline(root: Object3D): void {
    const outline = root.clone(true);
    // Strip userData so the clone can't be raycast / interacted with — it's
    // pure decoration. Also strip children that lack geometry.
    outline.traverse((child) => {
      const mesh = child as Mesh;
      if (!mesh.isMesh) {
        child.userData = {};
        return;
      }
      const outlineMat = new MeshBasicMaterial({
        color: this.color,
        side: BackSide,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
        blending: AdditiveBlending,
      });
      mesh.material = outlineMat;
      mesh.renderOrder = 999;
      mesh.userData = {};
      mesh.scale.multiplyScalar(1.04);
    });
    // Match the original's world transform exactly. addOutline runs after
    // selection has been committed, so root's matrix is already current.
    outline.position.copy(root.position);
    outline.quaternion.copy(root.quaternion);
    outline.scale.copy(root.scale).multiplyScalar(1.04);
    // Outline is parented to the root's parent so it follows world drags
    // without needing manual sync.
    const parent = root.parent ?? root;
    parent.add(outline);
    this.outlineMesh = outline;
    this.outlineParent = parent;
  }

  private removeOutline(): void {
    if (!this.outlineMesh) return;
    if (this.outlineParent) this.outlineParent.remove(this.outlineMesh);
    this.outlineMesh.traverse((c) => {
      const mesh = c as Mesh;
      if (mesh.isMesh) {
        const m = mesh.material as MeshBasicMaterial | MeshBasicMaterial[];
        if (Array.isArray(m)) m.forEach((x) => x.dispose());
        else m.dispose();
      }
    });
    this.outlineMesh = null;
    this.outlineParent = null;
  }
}
