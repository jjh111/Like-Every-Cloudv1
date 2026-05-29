import { Group, type Scene } from 'three';
import { isDevMode, onDevModeChange } from './devMode';

// DebugVizScene — the single Three.js Group that owns every dev-only
// visualization in Phase 2 (audio spheres, cloth wireframes, sun arrow,
// hero AABBs, wall-cull plane, etc.).
//
// One root → five named child groups, each toggled independently. The
// dock widget reads/writes those flags via `setCategoryEnabled`. The
// master flag in `enabled` short-circuits everything below it.
//
// Lifecycle:
//   const dv = new DebugVizScene();
//   dv.add(scene);
//   ... pass dv.groups.audio etc. to gizmo modules so they parent there.
//
// Opt-outs already wired into the root so wallCull, hover highlight, and
// raycasts all treat the entire viz subtree as transparent.

export type GizmoCategory = 'audio' | 'cloth' | 'lighting' | 'culling' | 'cameras';

const LS_KEY_PREFIX = 'lec_dev_gizmo_';
const LS_MASTER_KEY = 'lec_dev_gizmos_master';

function readBool(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    if (v === '1' || v === 'true') return true;
    if (v === '0' || v === 'false') return false;
  } catch { /* ignored */ }
  return fallback;
}
function writeBool(key: string, v: boolean): void {
  try { localStorage.setItem(key, v ? '1' : '0'); } catch { /* ignored */ }
}

export class DebugVizScene {
  readonly root: Group;
  readonly groups: Record<GizmoCategory, Group>;
  private categoryEnabled: Record<GizmoCategory, boolean>;
  private _enabled: boolean;
  private listeners: Array<(state: { enabled: boolean; categories: Record<GizmoCategory, boolean> }) => void> = [];

  constructor() {
    this.root = new Group();
    this.root.name = 'DebugVizRoot';
    // Make the whole viz subtree invisible to wall-cull, raycasts, and
    // hover/selection. Children inherit nothing automatically (Three.js
    // doesn't auto-propagate userData), but the wallCull attach() walks
    // ancestors so the root opt-out is enough for it. Per-child opt-outs
    // for raycast/hover are set in each gizmo module.
    this.root.userData.no_cull = true;

    this.groups = {
      audio: new Group(),
      cloth: new Group(),
      lighting: new Group(),
      culling: new Group(),
      cameras: new Group(),
    };
    for (const [name, g] of Object.entries(this.groups)) {
      g.name = `DebugViz_${name}`;
      g.userData.no_cull = true;
      this.root.add(g);
    }

    // Restore preferred state. Default: master off, every category on.
    // When master flips on for the first time, all categories will be
    // visible — feels like "show me everything" by default.
    this._enabled = readBool(LS_MASTER_KEY, false);
    this.categoryEnabled = {
      audio: readBool(LS_KEY_PREFIX + 'audio', true),
      cloth: readBool(LS_KEY_PREFIX + 'cloth', true),
      lighting: readBool(LS_KEY_PREFIX + 'lighting', true),
      culling: readBool(LS_KEY_PREFIX + 'culling', true),
      cameras: readBool(LS_KEY_PREFIX + 'cameras', true),
    };
    this.applyVisibility();
    // Director mode hides the entire viz tree — the stored master flag
    // is preserved so exiting director restores whatever the user had.
    onDevModeChange(() => this.applyVisibility());
  }

  add(scene: Scene): void { scene.add(this.root); }
  remove(scene: Scene): void { scene.remove(this.root); }

  get enabled(): boolean { return this._enabled; }
  setEnabled(on: boolean): void {
    if (this._enabled === on) return;
    this._enabled = on;
    writeBool(LS_MASTER_KEY, on);
    this.applyVisibility();
    this.notify();
  }
  toggle(): void { this.setEnabled(!this._enabled); }

  isCategoryEnabled(name: GizmoCategory): boolean { return this.categoryEnabled[name]; }
  setCategoryEnabled(name: GizmoCategory, on: boolean): void {
    if (this.categoryEnabled[name] === on) return;
    this.categoryEnabled[name] = on;
    writeBool(LS_KEY_PREFIX + name, on);
    this.applyVisibility();
    this.notify();
  }

  /** Subscribe to flag changes. Use to keep the dock widget in sync if
   *  flags get toggled elsewhere (e.g. hotkey). Fires immediately with
   *  the current state. */
  onChange(fn: (state: { enabled: boolean; categories: Record<GizmoCategory, boolean> }) => void): () => void {
    this.listeners.push(fn);
    fn({ enabled: this._enabled, categories: { ...this.categoryEnabled } });
    return () => {
      const i = this.listeners.indexOf(fn);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  private applyVisibility(): void {
    // Final visibility = stored master flag AND dev mode on. Director
    // mode (devMode off) hides the viz subtree without touching the
    // stored flag so toggling director back restores whatever the user
    // had.
    this.root.visible = this._enabled && isDevMode();
    for (const [name, g] of Object.entries(this.groups)) {
      g.visible = this.categoryEnabled[name as GizmoCategory];
    }
  }
  private notify(): void {
    const snap = { enabled: this._enabled, categories: { ...this.categoryEnabled } };
    for (const fn of this.listeners) {
      try { fn(snap); } catch (e) { console.warn('[dvScene] listener error', e); }
    }
  }
}
