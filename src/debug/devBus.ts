// Tiny typed pub/sub for dev-side observers.
//
// Runtime modules emit through this bus so the debug HUD (timeline,
// inspector, event log, gizmo overlays) can react without the runtime
// importing or knowing about any debug code. Listeners are explicit and
// optional — when no one is listening, an emit is a single set lookup +
// early return.
//
// Event names are namespaced by subsystem: `audio:play`, `state:target`,
// `time:t`, `cloth:grab`, `hero:hover`, `bookmark:saved`, `dev:mode`. The
// `DevEvents` map below gives each event a typed payload — `on()` and
// `emit()` infer it from the event name so callers get autocomplete and
// the payload shape can't drift.
//
// The bus does NOT batch or coalesce. Per-frame events (cloth particle
// updates, mouse moves) should NOT go through the bus — those belong in
// a polled read-current-state pattern. The bus is for state transitions
// (play→stop, hover→select, snap-to-time) that fire a handful of times
// per second at most.

export type DevEvents = {
  // Audio — emitted by AudioManager hooks on play() / stopEntry().
  'audio:play': { id: string; channel: string };
  'audio:stop': { id: string; channel: string };
  // State morph — emitted by StateController.setTarget / setProgress.
  'state:target': { target: 'past' | 'present' };
  'state:progress': { progress: number };
  // Time-of-day clock — emitted on programmatic t set + running toggle.
  // (Per-frame tick advances are not emitted; consumers poll `clock.t`.)
  'time:t': { t: number };
  'time:running': { running: boolean };
  // Cloth grab — emitted when a cloth particle is pinned/released via the
  // pointer grab interaction.
  'cloth:grab': { cloth: string; particle: number };
  'cloth:release': { cloth: string };
  // Hero hover/select — emitted by HoverHighlight. id=null means cleared.
  'hero:hover': { id: string | null };
  'hero:select': { id: string | null };
  // Bookmarks — fired by the camera-pose save/tween flows.
  'bookmark:saved': { name: string };
  'bookmark:tween': { name: string };
  // Director / dev-mode visibility toggle.
  'dev:mode': { on: boolean };
};

type EventName = keyof DevEvents;
type Listener<K extends EventName> = (payload: DevEvents[K]) => void;

class DevBus {
  private listeners: { [K in EventName]?: Set<Listener<K>> } = {};

  on<K extends EventName>(event: K, fn: Listener<K>): () => void {
    let set = this.listeners[event] as Set<Listener<K>> | undefined;
    if (!set) {
      set = new Set<Listener<K>>();
      this.listeners[event] = set as unknown as typeof this.listeners[K];
    }
    set.add(fn);
    return () => set!.delete(fn);
  }

  off<K extends EventName>(event: K, fn: Listener<K>): void {
    const set = this.listeners[event] as Set<Listener<K>> | undefined;
    set?.delete(fn);
  }

  emit<K extends EventName>(event: K, payload: DevEvents[K]): void {
    const set = this.listeners[event] as Set<Listener<K>> | undefined;
    if (!set || set.size === 0) return;
    for (const fn of set) {
      try { fn(payload); }
      catch (e) { console.warn('[devBus] listener error for', event, e); }
    }
  }

  /** Drop every listener. Used by tests / hot-reload. */
  clear(): void {
    this.listeners = {};
  }
}

/** Process-wide singleton. Cheap to import from anywhere; cheap when
 *  nothing's listening. */
export const devBus = new DevBus();
