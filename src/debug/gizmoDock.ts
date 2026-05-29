import type { DebugVizScene, GizmoCategory } from './dvScene';
import { onDevModeChange } from './devMode';

// Gizmo dock — top-right corner dev-only widget. Five collapsible
// per-category switches + a master toggle, plus a hotkey hint.
//
// Minimal vibe: black background at low opacity, mono font, single cyan
// accent for "active" toggles. Persists nothing of its own — every
// switch goes through the DebugVizScene which owns the localStorage
// state, so the widget is purely a renderer.
//
// The widget hides when devMode flips off (Phase 7 director mode).

const PANEL_BG = 'rgba(18, 22, 28, 0.78)';
const ACCENT = '#66ffe6';
const MUTED = '#6c7480';
const TEXT = '#e6ebef';

const CATEGORY_LABELS: Record<GizmoCategory, string> = {
  audio: 'audio',
  cloth: 'cloth',
  lighting: 'lighting',
  culling: 'culling',
  cameras: 'cameras',
};

export interface GizmoDockOpts {
  dv: DebugVizScene;
}

export function createGizmoDock(opts: GizmoDockOpts): { root: HTMLElement; dispose(): void } {
  const root = document.createElement('div');
  root.id = 'lec-gizmo-dock';
  Object.assign(root.style, {
    position: 'fixed',
    top: '12px',
    right: '12px',
    zIndex: '40',
    background: PANEL_BG,
    color: TEXT,
    font: '11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    padding: '8px 10px',
    borderRadius: '6px',
    border: '1px solid rgba(255,255,255,0.08)',
    minWidth: '120px',
    userSelect: 'none',
    backdropFilter: 'blur(6px)',
    WebkitBackdropFilter: 'blur(6px)',
  });

  // Header row — master toggle + collapse caret.
  const header = document.createElement('div');
  Object.assign(header.style, {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8px',
    marginBottom: '6px',
    cursor: 'pointer',
  });
  const headerLabel = document.createElement('span');
  headerLabel.textContent = 'gizmos';
  headerLabel.style.fontWeight = '600';
  const headerToggle = document.createElement('span');
  headerToggle.textContent = opts.dv.enabled ? '●' : '○';
  headerToggle.style.color = opts.dv.enabled ? ACCENT : MUTED;
  headerToggle.style.fontSize = '12px';
  header.appendChild(headerLabel);
  header.appendChild(headerToggle);
  header.addEventListener('click', (e) => {
    // Click anywhere on the header toggles master, except if the user
    // clicked the caret (handled separately below).
    e.stopPropagation();
    opts.dv.toggle();
  });
  root.appendChild(header);

  // Hotkey hint — one-line muted reminder. G toggles master, click rows
  // for per-category. Keeps the widget self-explanatory.
  const hint = document.createElement('div');
  hint.textContent = 'G: master · click row';
  Object.assign(hint.style, {
    color: MUTED,
    fontSize: '9px',
    marginBottom: '6px',
  });
  root.appendChild(hint);

  // Category rows.
  const rowEls: Record<GizmoCategory, { row: HTMLDivElement; dot: HTMLSpanElement }> = {} as never;
  for (const name of Object.keys(CATEGORY_LABELS) as GizmoCategory[]) {
    const row = document.createElement('div');
    Object.assign(row.style, {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '2px 0',
      cursor: 'pointer',
    });
    const label = document.createElement('span');
    label.textContent = CATEGORY_LABELS[name];
    const dot = document.createElement('span');
    dot.textContent = opts.dv.isCategoryEnabled(name) ? '●' : '○';
    dot.style.fontSize = '11px';
    row.appendChild(label);
    row.appendChild(dot);
    row.addEventListener('click', (e) => {
      e.stopPropagation();
      opts.dv.setCategoryEnabled(name, !opts.dv.isCategoryEnabled(name));
    });
    root.appendChild(row);
    rowEls[name] = { row, dot };
  }

  // Wire the dv → DOM. dv.onChange fires immediately with current state
  // so initial paint is in sync.
  const unsubDv = opts.dv.onChange((state) => {
    headerToggle.textContent = state.enabled ? '●' : '○';
    headerToggle.style.color = state.enabled ? ACCENT : MUTED;
    root.style.opacity = state.enabled ? '1' : '0.72';
    for (const [name, { dot }] of Object.entries(rowEls) as [GizmoCategory, { row: HTMLDivElement; dot: HTMLSpanElement }][]) {
      const on = state.categories[name];
      dot.textContent = on ? '●' : '○';
      dot.style.color = on ? ACCENT : MUTED;
    }
  });

  // Hide in director mode.
  const unsubDev = onDevModeChange((on) => {
    root.style.display = on ? 'block' : 'none';
  });

  // Hotkey: G toggles master. Lives here so the dock + hotkey are wired
  // together — kill on dispose.
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (e.key === 'g' || e.key === 'G') {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      e.preventDefault();
      opts.dv.toggle();
    }
  };
  window.addEventListener('keydown', onKeyDown);

  document.body.appendChild(root);

  return {
    root,
    dispose(): void {
      unsubDv();
      unsubDev();
      window.removeEventListener('keydown', onKeyDown);
      root.remove();
    },
  };
}
