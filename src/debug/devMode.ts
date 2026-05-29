import { devBus } from './devBus';

// Dev mode flag — single source of truth for "is the dev HUD visible".
//
// Drives every dev-only surface: lil-gui debug panel, timeline strip,
// inspector, gizmo overlays, event log, hotkey hint, hero audio mixer.
// One toggle hides them all (Phase 7 director mode). Persistent in
// localStorage so a director can reload and stay in clean view.
//
// Initialization precedence (highest first):
//   1. `?dev=1` / `?dev=0` in the URL — explicit per-session override.
//   2. Stored `lec_dev_mode` in localStorage — last user choice.
//   3. Default: on (developers expect dev mode by default).
//
// Subscribers get notified via the devBus `dev:mode` event. No prop
// drilling — every panel can `onDevModeChange(...)` independently.

const LS_KEY = 'lec_dev_mode';

function readInitial(): boolean {
  try {
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      const q = url.searchParams.get('dev');
      if (q === '0' || q === 'false') return false;
      if (q === '1' || q === 'true') return true;
      const stored = localStorage.getItem(LS_KEY);
      if (stored === '0') return false;
      if (stored === '1') return true;
    }
  } catch { /* ignored — sandboxed contexts */ }
  return true;
}

let _on = readInitial();

export function isDevMode(): boolean { return _on; }

export function setDevMode(on: boolean): void {
  if (_on === on) return;
  _on = on;
  try { localStorage.setItem(LS_KEY, on ? '1' : '0'); } catch { /* ignored */ }
  devBus.emit('dev:mode', { on });
}

export function toggleDevMode(): void { setDevMode(!_on); }

/** Convenience: subscribe and immediately fire with the current value so
 *  the subscriber doesn't need to read isDevMode() separately on init. */
export function onDevModeChange(fn: (on: boolean) => void): () => void {
  fn(_on);
  return devBus.on('dev:mode', (p) => fn(p.on));
}
