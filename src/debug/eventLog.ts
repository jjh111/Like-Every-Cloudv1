import { devBus } from './devBus';
import { onDevModeChange } from './devMode';

// Event log — small narrator strip overlay that surfaces devBus events
// as one-line text entries that fade out after a few seconds. Useful in
// screen recordings (so you can see what fired and when) and as a quick
// sanity check that subsystems are emitting.
//
// Layout: bottom-right corner (above the timeline strip), 280px wide,
// up to ~6 visible rows. New events push the older rows up; rows auto-
// fade after `LIFETIME_MS` and self-remove once fully faded.
//
// Subscriptions:
//   audio:play         ▶ id.channel
//   audio:stop         ■ id.channel
//   state:target       → target
//   state:progress     ≈ progress%   (filtered: only on snap, i.e. progress=1 or 0)
//   time:t             ⏲ HH:MM       (on programmatic set; tick-driven advances stay silent)
//   time:running       ⏵ / ⏸
//   cloth:grab         ✋ cloth #idx
//   cloth:release      ↩ cloth
//   hero:select        ◆ id          (skipped when id is null — too noisy)
//   bookmark:saved     ★ saved name
//   bookmark:tween     ➜ tween name

const PANEL_W = 280;
const ROW_H = 16;
const MAX_ROWS = 6;
const LIFETIME_MS = 4500;
const FADE_MS = 700;

const ACCENT = '#66ffe6';
const TEXT = '#dde4eb';
const MUTED = '#6c7480';

interface Row {
  el: HTMLDivElement;
  bornAt: number;
}

export function createEventLog(): { root: HTMLElement; dispose(): void } {
  const root = document.createElement('div');
  root.id = 'lec-event-log';
  Object.assign(root.style, {
    position: 'fixed',
    right: '12px',
    bottom: '102px', // above the 88px timeline + a 14px gap
    width: `${PANEL_W}px`,
    zIndex: '32',
    display: 'flex',
    flexDirection: 'column-reverse', // newest at the bottom
    gap: '2px',
    font: '10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    color: TEXT,
    pointerEvents: 'none', // overlay; never blocks input
    userSelect: 'none',
  });
  document.body.appendChild(root);

  const rows: Row[] = [];

  function push(text: string, accent = false): void {
    const el = document.createElement('div');
    el.textContent = text;
    Object.assign(el.style, {
      background: 'rgba(18, 22, 28, 0.55)',
      color: accent ? ACCENT : TEXT,
      padding: '2px 8px',
      borderRadius: '3px',
      height: `${ROW_H}px`,
      lineHeight: `${ROW_H}px`,
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      opacity: '1',
      transition: `opacity ${FADE_MS}ms linear`,
      backdropFilter: 'blur(4px)',
      WebkitBackdropFilter: 'blur(4px)',
    });
    root.appendChild(el);
    rows.push({ el, bornAt: performance.now() });
    // Cap at MAX_ROWS. Older rows fade + remove immediately if we're over.
    while (rows.length > MAX_ROWS) {
      const old = rows.shift();
      if (!old) break;
      removeRow(old);
    }
  }

  function removeRow(r: Row): void {
    r.el.style.opacity = '0';
    setTimeout(() => r.el.remove(), FADE_MS + 50);
  }

  // Per-frame: age out rows whose lifetime expired.
  let rafHandle = 0;
  const loop = () => {
    const now = performance.now();
    while (rows.length && now - rows[0].bornAt > LIFETIME_MS) {
      const r = rows.shift()!;
      removeRow(r);
    }
    rafHandle = requestAnimationFrame(loop);
  };
  rafHandle = requestAnimationFrame(loop);

  // ── subscriptions ──────────────────────────────────────────────────
  const unsubs: Array<() => void> = [];
  unsubs.push(devBus.on('audio:play', (p) => push(`▶ ${p.id}.${p.channel}`)));
  unsubs.push(devBus.on('audio:stop', (p) => push(`■ ${p.id}.${p.channel}`, false)));
  unsubs.push(devBus.on('state:target', (p) => push(`→ state: ${p.target}`, true)));
  unsubs.push(devBus.on('state:progress', (p) => {
    // Only narrate the endpoints; in-between progress would flood the log.
    if (p.progress === 0 || p.progress === 1) push(`≈ progress ${(p.progress * 100).toFixed(0)}%`);
  }));
  unsubs.push(devBus.on('time:t', (p) => {
    // Format the new t as HH:MM inline so the entry is self-explanatory.
    const hours = p.t * 24;
    const h = Math.floor(hours);
    const m = Math.floor((hours - h) * 60);
    push(`⏲ ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
  }));
  unsubs.push(devBus.on('time:running', (p) => push(p.running ? '⏵ time running' : '⏸ time paused')));
  unsubs.push(devBus.on('cloth:grab', (p) => push(`✋ ${p.cloth} #${p.particle}`)));
  unsubs.push(devBus.on('cloth:release', (p) => push(`↩ ${p.cloth} released`)));
  unsubs.push(devBus.on('hero:select', (p) => {
    if (p.id) push(`◆ select ${p.id}`, true);
  }));
  unsubs.push(devBus.on('bookmark:saved', (p) => push(`★ saved '${p.name}'`, true)));
  unsubs.push(devBus.on('bookmark:tween', (p) => push(`➜ '${p.name}'`)));

  // ── director mode hide ─────────────────────────────────────────────
  const unsubDev = onDevModeChange((on) => {
    root.style.display = on ? 'flex' : 'none';
  });

  // Suppress one unused warning so the linter is happy with MUTED.
  void MUTED;

  return {
    root,
    dispose(): void {
      cancelAnimationFrame(rafHandle);
      for (const fn of unsubs) fn();
      unsubDev();
      root.remove();
    },
  };
}
