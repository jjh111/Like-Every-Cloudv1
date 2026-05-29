import {
  ArrowHelper,
  Box3,
  Box3Helper,
  Color,
  type Group,
  type Object3D,
  PlaneHelper,
  Vector3,
} from 'three';
import type { SunRig } from '../atmosphere/sunRig';
import type { WallCull } from '../scene/wallCull';

// Scene gizmos — interior AABB, wall-cull plane, sun arrow, hero AABBs.
//
// Each piece is a thin wrapper around a built-in Three.js helper plus the
// usual no_cull / raycastIgnore / no_outline opt-outs so the dev viz layer
// never interferes with raycasting, hover, or the wall clip.
//
// Hero AABBs use Box3Helper, color-coded:
//   interactive (player-selectable) → dev cyan      (#66ffe6)
//   set         (decorative/static) → muted gray    (#7a7f88)
// AABBs are computed from world bounds at register time and refreshed
// each frame in case a hero moves (the gizmo system in dev mode + the
// state morph push heroes around).

const HERO_INTERACTIVE = 0x66ffe6;
const HERO_SET = 0x7a7f88;
const SUN_COLOR = 0xffcc66;
const AABB_INTERIOR = 0x5588aa;
const PLANE_COLOR = 0xff6b6b;

interface HeroEntry {
  root: Object3D;
  interactive: boolean;
  helper: Box3Helper;
  box: Box3;
}

export interface SceneGizmosOpts {
  /** Lighting group — sun arrow + (future) hero AABBs land here. */
  lightingGroup: Group;
  /** Culling group — interior AABB + wall-cull plane land here. */
  cullingGroup: Group;
  /** Camera group — bookmark markers + (future) camera frustums land here. */
  camerasGroup: Group;
  interiorAABB: Box3;
  sunRig: SunRig;
  wallCull: WallCull;
}

export class SceneGizmos {
  private interiorHelper: Box3Helper;
  private planeHelper: PlaneHelper;
  private sunArrow: ArrowHelper;
  private heroes: HeroEntry[] = [];
  private opts: SceneGizmosOpts;
  private scratchBox = new Box3();

  constructor(opts: SceneGizmosOpts) {
    this.opts = opts;

    // Interior AABB — single box wireframe in the culling group.
    this.interiorHelper = new Box3Helper(opts.interiorAABB.clone(), new Color(AABB_INTERIOR));
    markDevOnly(this.interiorHelper);
    opts.cullingGroup.add(this.interiorHelper);

    // Wall-cull plane helper. PlaneHelper draws a colored quad on the
    // plane's surface, sized to the second arg. 6m is generous; the
    // plane itself is "infinite" so the size is just visual.
    this.planeHelper = new PlaneHelper(opts.wallCull.clipPlane, 6, PLANE_COLOR);
    markDevOnly(this.planeHelper);
    opts.cullingGroup.add(this.planeHelper);

    // Sun arrow — origin → sunDirection × 8m. Color = warm gold.
    this.sunArrow = new ArrowHelper(
      opts.sunRig.sunDirection.clone(),
      new Vector3(),
      8,
      SUN_COLOR,
      1.2,
      0.6,
    );
    markDevOnly(this.sunArrow);
    opts.lightingGroup.add(this.sunArrow);
  }

  /** Register a hero subtree. Walks the root once to compute its world
   *  AABB and attaches a Box3Helper colored by interactive flag. */
  registerHero(root: Object3D, interactive: boolean): void {
    if (this.heroes.some((h) => h.root === root)) return;
    const box = new Box3().setFromObject(root);
    const helper = new Box3Helper(box, new Color(interactive ? HERO_INTERACTIVE : HERO_SET));
    markDevOnly(helper);
    this.opts.lightingGroup.add(helper);
    this.heroes.push({ root, interactive, helper, box });
  }

  /** Per-frame refresh. Sun direction + hero AABBs are the things that
   *  move; the interior AABB + plane helper update themselves from the
   *  underlying objects they wrap. */
  update(): void {
    // Sun arrow
    if (this.opts.lightingGroup.visible) {
      this.sunArrow.setDirection(this.opts.sunRig.sunDirection);
    }
    // Hero AABBs — recompute from current world matrices. Cheap for a
    // dozen heroes; if hero count grows we can dirty-flag this.
    if (this.opts.lightingGroup.visible) {
      for (const h of this.heroes) {
        this.scratchBox.setFromObject(h.root);
        h.box.copy(this.scratchBox);
        // Box3Helper bakes the geometry from the box on construction;
        // updateMatrixWorld + setBox keeps it in sync.
        (h.helper as Box3Helper & { box: Box3 }).box = h.box;
        h.helper.updateMatrixWorld(true);
      }
    }
  }

  dispose(): void {
    this.opts.cullingGroup.remove(this.interiorHelper);
    this.opts.cullingGroup.remove(this.planeHelper);
    this.opts.lightingGroup.remove(this.sunArrow);
    for (const h of this.heroes) this.opts.lightingGroup.remove(h.helper);
    this.heroes = [];
  }
}

function markDevOnly(o: Object3D): void {
  o.userData.no_cull = true;
  o.userData.raycastIgnore = true;
  o.userData.no_outline = true;
  o.userData.no_highlight = true;
  o.traverse((child) => {
    child.userData.no_cull = true;
    child.userData.raycastIgnore = true;
    child.userData.no_outline = true;
    child.userData.no_highlight = true;
  });
}
