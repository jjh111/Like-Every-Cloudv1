import type { StateController } from '../state/stateController';
import type { TimeOfDayClock } from '../atmosphere/timeOfDayClock';
import { onDevModeChange } from './devMode';

// Timeline strip — bottom-of-viewport scrubber for the two primary
// drivers of the scene: time of day + past↔present morph.
//
// Layout (88px tall, full width, semi-transparent dark panel):
//
//   ┌─────────────────────────────────────────────────────────────┐
//   │ ▶ ⊙       TIME ──────●────────────  14:32  18:00            │
//   │           MORPH ─────────●────────  present ▸ past          │
//   └─────────────────────────────────────────────────────────────┘
//
// Transport (left): play/pause + cycle (skip to noon).
// Time lane: 0..1 mapped to 24h. Tick marks every 6h. Snap markers at
//            dawn/noon/dusk/midnight, drawn on the track.
// Morph lane: 0=past on left, 1=present on right. Snaps at the endpoints.
// Right edge: HH:MM clock chip + state target label.
//
// Hotkeys (registered globally):
//   Space     play/pause time-of-day
//   [ / ]     step time by ±0.5h (≈ ±0.0208 in t units)
//   , / .     step morph progress by ±0.05
//
// The widget reads/writes state directly. devBus events from Phase 1
// keep it in sync if state is mutated elsewhere (snap buttons in
// lil-gui, transition-finish triggers).

const PANEL_BG = 'rgba(18, 22, 28, 0.82)';
const TRACK_BG = 'rgba(255,255,255,0.06)';
const TRACK_FILL = 'rgba(102, 255, 230, 0.18)';
const ACCENT = '#66ffe6';
const MUTED = '#6c7480';
const TEXT = '#e6ebef';
const TICK_COLOR = 'rgba(255,255,255,0.10)';
const SNAP_COLOR = 'rgba(255,255,255,0.35)';

const TIME_SNAPS: Array<{ t: number; label: string }> = [
  { t: 0,     label: 'midnight' },
  { t: 0.25,  label: 'dawn' },
  { t: 0.5,   label: 'noon' },
  { t: 0.75,  label: 'dusk' },
];

export interface TimelineOpts {
  clock: TimeOfDayClock;
  state: StateController;
}

export function createTimeline(opts: TimelineOpts): { root: HTMLElement; dispose(): void } {
  const root = document.createElement('div');
  root.id = 'lec-timeline';
  Object.assign(root.style, {
    position: 'fixed',
    left: '0',
    right: '0',
    bottom: '0',
    height: '88px',
    zIndex: '30',
    background: PANEL_BG,
    color: TEXT,
    font: '11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    display: 'flex',
    alignItems: 'stretch',
    padding: '8px 12px',
    boxSizing: 'border-box',
    borderTop: '1px solid rgba(255,255,255,0.06)',
    backdropFilter: 'blur(6px)',
    WebkitBackdropFilter: 'blur(6px)',
    userSelect: 'none',
  });

  // ── transport ──────────────────────────────────────────────────────
  const transport = document.createElement('div');
  Object.assign(transport.style, {
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-around',
    gap: '4px',
    paddingRight: '12px',
    minWidth: '52px',
    borderRight: '1px solid rgba(255,255,255,0.08)',
    marginRight: '12px',
  });
  const playBtn = mkBtn(opts.clock.running ? '◼' : '▶');
  playBtn.title = 'play/pause time (Space)';
  playBtn.addEventListener('click', () => { opts.clock.running = !opts.clock.running; });
  const cycleBtn = mkBtn('⟳');
  cycleBtn.title = 'snap → noon';
  cycleBtn.addEventListener('click', () => { opts.clock.t = 0.5; });
  transport.appendChild(playBtn);
  transport.appendChild(cycleBtn);
  root.appendChild(transport);

  // ── lanes container ────────────────────────────────────────────────
  const lanes = document.createElement('div');
  Object.assign(lanes.style, {
    flex: '1 1 auto',
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    justifyContent: 'space-around',
  });
  root.appendChild(lanes);

  // ── time lane ──────────────────────────────────────────────────────
  const timeLane = mkLane('TIME');
  lanes.appendChild(timeLane.row);
  // Tick marks every 6h (4 ticks).
  for (let i = 0; i < 4; i++) {
    const tick = document.createElement('div');
    Object.assign(tick.style, {
      position: 'absolute',
      left: `${i * 25}%`,
      top: '0', bottom: '0',
      width: '1px',
      background: TICK_COLOR,
      pointerEvents: 'none',
    });
    timeLane.track.appendChild(tick);
  }
  // Snap labels above the track.
  for (const s of TIME_SNAPS) {
    const label = document.createElement('div');
    label.textContent = s.label;
    Object.assign(label.style, {
      position: 'absolute',
      left: `${s.t * 100}%`,
      top: '-12px',
      transform: 'translateX(-50%)',
      color: MUTED,
      fontSize: '9px',
      pointerEvents: 'none',
      whiteSpace: 'nowrap',
    });
    timeLane.track.appendChild(label);
    // Faint dot on the track at the snap point.
    const dot = document.createElement('div');
    Object.assign(dot.style, {
      position: 'absolute',
      left: `${s.t * 100}%`,
      top: '50%',
      transform: 'translate(-50%, -50%)',
      width: '5px', height: '5px',
      borderRadius: '50%',
      background: SNAP_COLOR,
      pointerEvents: 'none',
    });
    timeLane.track.appendChild(dot);
  }
  wireScrub(timeLane.track, timeLane.fill, timeLane.head, (m) => {
    opts.clock.t = m;
  }, () => opts.clock.t);

  // ── morph lane ─────────────────────────────────────────────────────
  const morphLane = mkLane('MORPH');
  lanes.appendChild(morphLane.row);
  // Endpoint snap dots.
  for (const m of [0, 1]) {
    const dot = document.createElement('div');
    Object.assign(dot.style, {
      position: 'absolute',
      left: `${m * 100}%`,
      top: '50%',
      transform: 'translate(-50%, -50%)',
      width: '5px', height: '5px',
      borderRadius: '50%',
      background: SNAP_COLOR,
      pointerEvents: 'none',
    });
    morphLane.track.appendChild(dot);
  }
  // Endpoint labels.
  const pastLabel = document.createElement('div');
  pastLabel.textContent = 'past';
  Object.assign(pastLabel.style, {
    position: 'absolute', left: '0', top: '-12px',
    color: MUTED, fontSize: '9px', pointerEvents: 'none', whiteSpace: 'nowrap',
  });
  morphLane.track.appendChild(pastLabel);
  const presentLabel = document.createElement('div');
  presentLabel.textContent = 'present';
  Object.assign(presentLabel.style, {
    position: 'absolute', right: '0', top: '-12px',
    color: MUTED, fontSize: '9px', pointerEvents: 'none', whiteSpace: 'nowrap',
  });
  morphLane.track.appendChild(presentLabel);
  wireScrub(morphLane.track, morphLane.fill, morphLane.head, (m) => {
    // Snap target to canonical 'present' so progress maps cleanly. The
    // morph axis is always 0=past→1=present regardless of which way the
    // user was previously heading.
    opts.state.duration = 0;
    if (opts.state.target !== 'present') opts.state.setTarget('present');
    opts.state.setProgress(m);
  }, () => morphValue(opts.state));

  // ── right-edge readouts ────────────────────────────────────────────
  const readouts = document.createElement('div');
  Object.assign(readouts.style, {
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-around',
    gap: '4px',
    paddingLeft: '12px',
    minWidth: '80px',
    borderLeft: '1px solid rgba(255,255,255,0.08)',
    marginLeft: '12px',
    textAlign: 'right',
  });
  const timeChip = document.createElement('div');
  timeChip.textContent = opts.clock.formatHM();
  timeChip.style.color = ACCENT;
  timeChip.style.fontSize = '14px';
  timeChip.style.fontWeight = '600';
  const stateChip = document.createElement('div');
  stateChip.style.color = MUTED;
  stateChip.style.fontSize = '10px';
  readouts.appendChild(timeChip);
  readouts.appendChild(stateChip);
  root.appendChild(readouts);

  // ── per-frame refresh (poll, since time:t doesn't fire on tick) ─────
  function refresh(): void {
    const t = opts.clock.t;
    timeLane.fill.style.width = `${t * 100}%`;
    timeLane.head.style.left = `${t * 100}%`;
    timeChip.textContent = opts.clock.formatHM();
    if (opts.clock.running) {
      playBtn.textContent = '◼';
    } else {
      playBtn.textContent = '▶';
    }
    const m = morphValue(opts.state);
    morphLane.fill.style.width = `${m * 100}%`;
    morphLane.head.style.left = `${m * 100}%`;
    stateChip.textContent =
      `${opts.state.target}` +
      (opts.state.progress < 1 ? ` ${Math.round(opts.state.progress * 100)}%` : '');
  }
  refresh();
  // 60Hz-ish refresh via rAF. Cheap — the DOM updates are 4 numeric values.
  let rafHandle = 0;
  const loop = () => {
    refresh();
    rafHandle = requestAnimationFrame(loop);
  };
  rafHandle = requestAnimationFrame(loop);

  // ── hotkeys ────────────────────────────────────────────────────────
  const onKey = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === ' ' || e.code === 'Space') {
      e.preventDefault();
      opts.clock.running = !opts.clock.running;
    } else if (e.key === '[') {
      opts.clock.t = opts.clock.t - 0.5 / 24;
    } else if (e.key === ']') {
      opts.clock.t = opts.clock.t + 0.5 / 24;
    } else if (e.key === ',') {
      opts.state.duration = 0;
      if (opts.state.target !== 'present') opts.state.setTarget('present');
      opts.state.setProgress(Math.max(0, opts.state.progress - 0.05));
    } else if (e.key === '.') {
      opts.state.duration = 0;
      if (opts.state.target !== 'present') opts.state.setTarget('present');
      opts.state.setProgress(Math.min(1, opts.state.progress + 0.05));
    }
  };
  window.addEventListener('keydown', onKey);

  // ── director mode hide ─────────────────────────────────────────────
  const unsubDev = onDevModeChange((on) => {
    root.style.display = on ? 'flex' : 'none';
  });

  document.body.appendChild(root);

  return {
    root,
    dispose(): void {
      cancelAnimationFrame(rafHandle);
      window.removeEventListener('keydown', onKey);
      unsubDev();
      root.remove();
    },
  };
}

// ── helpers ───────────────────────────────────────────────────────────

function mkBtn(label: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = label;
  Object.assign(b.style, {
    background: 'transparent',
    color: TEXT,
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: '4px',
    padding: '2px 6px',
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontSize: '12px',
    lineHeight: '1',
  });
  b.addEventListener('mouseenter', () => { b.style.borderColor = ACCENT; });
  b.addEventListener('mouseleave', () => { b.style.borderColor = 'rgba(255,255,255,0.12)'; });
  return b;
}

function mkLane(label: string): {
  row: HTMLDivElement;
  track: HTMLDivElement;
  fill: HTMLDivElement;
  head: HTMLDivElement;
} {
  const row = document.createElement('div');
  Object.assign(row.style, {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    height: '24px',
  });
  const lbl = document.createElement('div');
  lbl.textContent = label;
  Object.assign(lbl.style, {
    color: MUTED,
    fontSize: '9px',
    letterSpacing: '0.5px',
    width: '36px',
    flexShrink: '0',
  });
  const track = document.createElement('div');
  Object.assign(track.style, {
    flex: '1 1 auto',
    position: 'relative',
    height: '6px',
    background: TRACK_BG,
    borderRadius: '3px',
    cursor: 'pointer',
  });
  const fill = document.createElement('div');
  Object.assign(fill.style, {
    position: 'absolute',
    left: '0', top: '0', bottom: '0',
    width: '0%',
    background: TRACK_FILL,
    borderRadius: '3px',
    pointerEvents: 'none',
  });
  track.appendChild(fill);
  const head = document.createElement('div');
  Object.assign(head.style, {
    position: 'absolute',
    left: '0%',
    top: '50%',
    transform: 'translate(-50%, -50%)',
    width: '10px', height: '10px',
    borderRadius: '50%',
    background: ACCENT,
    boxShadow: '0 0 0 2px rgba(102, 255, 230, 0.18)',
    pointerEvents: 'none',
  });
  track.appendChild(head);
  row.appendChild(lbl);
  row.appendChild(track);
  return { row, track, fill, head };
}

function wireScrub(
  track: HTMLDivElement,
  fill: HTMLDivElement,
  head: HTMLDivElement,
  set: (m: number) => void,
  read: () => number,
): void {
  const pointerToM = (clientX: number): number => {
    const rect = track.getBoundingClientRect();
    const m = (clientX - rect.left) / Math.max(1, rect.width);
    return Math.max(0, Math.min(1, m));
  };
  const onMove = (e: PointerEvent) => {
    const m = pointerToM(e.clientX);
    set(m);
    fill.style.width = `${m * 100}%`;
    head.style.left = `${m * 100}%`;
  };
  track.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    track.setPointerCapture(e.pointerId);
    onMove(e);
    track.addEventListener('pointermove', onMove);
    const onUp = () => {
      track.removeEventListener('pointermove', onMove);
      track.releasePointerCapture(e.pointerId);
    };
    track.addEventListener('pointerup', onUp, { once: true });
    track.addEventListener('pointercancel', onUp, { once: true });
  });
  // Suppress the "read" arg from being optimized away — and silence the
  // warning in builds — by tying it to a one-time init.
  void read;
}

function morphValue(state: StateController): number {
  // 0 = past, 1 = present.
  // target='present' → m = progress (progress=0 means "starting morph
  //   toward present from past" → visually past).
  // target='past' → m = 1 - progress (progress=0 means "starting morph
  //   toward past from present" → visually present).
  return state.target === 'present' ? state.progress : 1 - state.progress;
}
