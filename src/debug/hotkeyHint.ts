import { onDevModeChange } from './devMode';

// Hotkey cheatsheet — modal overlay opened by '?'. Lists every
// shortcut wired by the dev HUD + main scene.
//
// Closes on:
//   - '?' again
//   - Esc
//   - click outside the modal
//   - click the close button
//
// The overlay sits above every other dev surface (zIndex 60) and
// blocks interaction with what's underneath while open. Hidden in
// director mode (Phase 7) — though the '?' key still listens, just
// pops nothing.

const PANEL_BG = 'rgba(14, 18, 24, 0.96)';
const ACCENT = '#66ffe6';
const MUTED = '#9aa3ad';
const TEXT = '#e6ebef';

interface HotkeySection {
  title: string;
  rows: Array<[string, string]>; // [keys, description]
}

const SECTIONS: HotkeySection[] = [
  {
    title: 'navigation',
    rows: [
      ['V', 'toggle view (exterior / interior)'],
      ['Space', 'play/pause time of day'],
      ['[ / ]', 'step time by ±30 minutes'],
      [', / .', 'step morph progress by ±5%'],
    ],
  },
  {
    title: 'editing',
    rows: [
      ['W', 'translate gizmo'],
      ['E', 'rotate gizmo'],
      ['R', 'clear selection'],
      ['⌘Z / Ctrl-Z', 'undo gizmo edit'],
      ['⌘⇧Z / Ctrl-Shift-Z', 'redo gizmo edit'],
    ],
  },
  {
    title: 'dev HUD',
    rows: [
      ['G', 'toggle gizmo visualizations (master)'],
      ['D', 'director mode (hide all dev surfaces)'],
      ['?', 'this cheatsheet'],
    ],
  },
];

export function createHotkeyHint(): { dispose(): void } {
  let overlay: HTMLDivElement | null = null;

  function open(): void {
    if (overlay) return;
    overlay = document.createElement('div');
    Object.assign(overlay.style, {
      position: 'fixed',
      inset: '0',
      zIndex: '60',
      background: 'rgba(0,0,0,0.45)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      backdropFilter: 'blur(4px)',
      WebkitBackdropFilter: 'blur(4px)',
      font: '12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    });

    const modal = document.createElement('div');
    Object.assign(modal.style, {
      background: PANEL_BG,
      color: TEXT,
      borderRadius: '8px',
      border: '1px solid rgba(255,255,255,0.08)',
      padding: '20px 24px',
      minWidth: '420px',
      maxWidth: '90vw',
      maxHeight: '80vh',
      overflowY: 'auto',
      boxShadow: '0 20px 60px rgba(0,0,0,0.45)',
    });
    // Stop click-through so clicking inside doesn't close.
    modal.addEventListener('click', (e) => e.stopPropagation());

    // Header
    const header = document.createElement('div');
    Object.assign(header.style, {
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      marginBottom: '16px',
    });
    const title = document.createElement('span');
    title.textContent = 'hotkeys';
    title.style.fontWeight = '600';
    title.style.fontSize = '14px';
    title.style.color = ACCENT;
    const close = document.createElement('button');
    close.textContent = '×';
    Object.assign(close.style, {
      background: 'transparent',
      color: MUTED,
      border: 'none',
      fontSize: '18px',
      cursor: 'pointer',
      padding: '0 4px',
      lineHeight: '1',
    });
    close.addEventListener('click', closeOverlay);
    header.appendChild(title);
    header.appendChild(close);
    modal.appendChild(header);

    // Sections
    for (const section of SECTIONS) {
      const heading = document.createElement('div');
      heading.textContent = section.title;
      Object.assign(heading.style, {
        color: MUTED,
        fontSize: '10px',
        letterSpacing: '0.5px',
        textTransform: 'uppercase',
        marginTop: '12px',
        marginBottom: '6px',
      });
      modal.appendChild(heading);
      const list = document.createElement('div');
      Object.assign(list.style, { display: 'grid', gridTemplateColumns: '120px 1fr', rowGap: '4px', columnGap: '12px' });
      for (const [keys, desc] of section.rows) {
        const k = document.createElement('span');
        k.textContent = keys;
        k.style.color = ACCENT;
        k.style.fontWeight = '600';
        const d = document.createElement('span');
        d.textContent = desc;
        d.style.color = TEXT;
        list.appendChild(k);
        list.appendChild(d);
      }
      modal.appendChild(list);
    }

    // Footer hint
    const footer = document.createElement('div');
    footer.textContent = 'press ? or Esc to close';
    Object.assign(footer.style, {
      color: MUTED, fontSize: '10px', textAlign: 'center', marginTop: '20px',
    });
    modal.appendChild(footer);

    overlay.appendChild(modal);
    overlay.addEventListener('click', closeOverlay);
    document.body.appendChild(overlay);
  }

  function closeOverlay(): void {
    if (!overlay) return;
    overlay.remove();
    overlay = null;
  }

  const onKey = (e: KeyboardEvent): void => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (e.key === '?' && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      if (overlay) closeOverlay();
      else open();
    } else if (e.key === 'Escape' && overlay) {
      e.preventDefault();
      closeOverlay();
    }
  };
  window.addEventListener('keydown', onKey);

  // The cheatsheet itself doesn't hide in director mode — the '?' key
  // still works because shortcuts are useful regardless. But if director
  // mode flips off and the overlay is open, leave it open. Wire only
  // for symmetry with the other surfaces.
  const unsubDev = onDevModeChange(() => { /* no-op */ });

  return {
    dispose(): void {
      window.removeEventListener('keydown', onKey);
      unsubDev();
      closeOverlay();
    },
  };
}
