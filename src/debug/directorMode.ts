import { isDevMode, setDevMode, toggleDevMode, onDevModeChange } from './devMode';

// Director mode — single master flag that hides every dev surface for
// a clean viewer view. Built on top of devMode (Phase 1): devMode=true
// means "dev HUD visible", devMode=false means "director mode (no HUD)".
//
// The new dev surfaces (gizmo dock, timeline, inspector, event log,
// hotkey hint) each subscribe to onDevModeChange and hide themselves.
// This module handles the EXISTING dev surfaces that don't know about
// devMode — lil-gui, hero state panel, tracks bar, hero audio mixer —
// by toggling a `lec-director` class on <body> and shipping a CSS rule
// set that hides them by id when that class is present.
//
// Also wires the global D hotkey and a small floating pill (top-left
// under the logo) that lets the director toggle between modes by
// clicking, not just keystroking.
//
// Initial wiring is done at app startup. The hotkey + pill stay
// installed for the session.

const STYLE_ID = 'lec-director-style';
const BODY_CLASS = 'lec-director';

// IDs we control directly (set in this module's wiring step):
//   lil-gui          → assigned after createDebugPanel returns
//   hero-state-panel → set in createHeroStatePanel (Phase 7 prep)
//   tracks-bar       → set in createTracksBar
//   hero-audio-mixer → set in createHeroAudioMixer
//   logo-badge       → kept VISIBLE in director mode (it's a brand mark,
//                       not a dev affordance) — handled in markup, not here

const HIDDEN_IDS = [
  '#lec-debug-panel',
  '#lec-hero-state-panel',
  '#lec-tracks-bar',
  '#lec-hero-audio-mixer',
];

function ensureCss(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  // !important so we beat any inline styles the original panels set.
  // Comma-list keeps the rule a single selector group — short + cheap.
  style.textContent =
    `body.${BODY_CLASS} ${HIDDEN_IDS.join(`, body.${BODY_CLASS} `)} { display: none !important; }\n`;
  document.head.appendChild(style);
}

function applyBodyClass(on: boolean): void {
  if (on) {
    document.body.classList.remove(BODY_CLASS);
  } else {
    document.body.classList.add(BODY_CLASS);
  }
}

/** Initialise director mode plumbing. Call once at startup, after the
 *  Logo Badge mounts (so the toggle pill anchors below it). */
export function initDirectorMode(): { dispose(): void } {
  ensureCss();
  applyBodyClass(isDevMode());

  // Subscribe so the body class stays in sync with subsequent toggles.
  const unsubDev = onDevModeChange((on) => applyBodyClass(on));

  // Pill control. Sits top-left below the logo (which is ~72px tall +
  // a 12px margin). Click toggles director mode.
  const pill = document.createElement('div');
  pill.id = 'lec-director-pill';
  Object.assign(pill.style, {
    position: 'fixed',
    top: '88px',
    left: '12px',
    zIndex: '50',
    background: 'rgba(18, 22, 28, 0.82)',
    color: '#e6ebef',
    font: '10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    padding: '4px 10px',
    borderRadius: '12px',
    border: '1px solid rgba(255,255,255,0.10)',
    cursor: 'pointer',
    userSelect: 'none',
    backdropFilter: 'blur(6px)',
    WebkitBackdropFilter: 'blur(6px)',
  });
  function refreshPill(): void {
    const on = isDevMode();
    pill.textContent = on ? 'dev (D)' : 'director (D)';
    pill.style.color = on ? '#66ffe6' : '#9aa3ad';
  }
  refreshPill();
  pill.addEventListener('click', () => toggleDevMode());
  // The pill itself is dev-flavoured but we keep it visible in BOTH
  // modes so the director can return to dev view. Subscribe just to
  // refresh the label.
  const unsubPill = onDevModeChange(refreshPill);
  document.body.appendChild(pill);

  // Hotkey: D toggles director mode. Ignored inside text inputs.
  const onKey = (e: KeyboardEvent): void => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'd' || e.key === 'D') {
      e.preventDefault();
      toggleDevMode();
    }
  };
  window.addEventListener('keydown', onKey);

  return {
    dispose(): void {
      unsubDev();
      unsubPill();
      window.removeEventListener('keydown', onKey);
      pill.remove();
      document.body.classList.remove(BODY_CLASS);
    },
  };
}

/** Explicit setters in case some caller wants to flip director mode
 *  without going through the hotkey/pill (e.g. on first load before the
 *  pill exists). */
export { setDevMode, toggleDevMode, isDevMode };
