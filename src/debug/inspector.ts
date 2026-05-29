import type { Object3D } from 'three';
import type { AudioChannel, AudioManager } from '../audio/audioManager';
import { devBus } from './devBus';
import { onDevModeChange } from './devMode';

// Inspector panel — left-edge collapsible dev surface with two tabs in
// Phase 4 (Heroes + Audio). Atmosphere + Perf tabs land in Phase 8.
//
// Layout (280px wide, full height minus header/timeline padding):
//
//   ┌──────────────────────┐
//   │ inspector       _  × │  ← header with collapse + close
//   ├──────────────────────┤
//   │ HEROES  AUDIO  · ·   │  ← tab bar
//   ├──────────────────────┤
//   │  hero_speaker  ◆ ·   │  ← rows: name + interactive chip + click-target
//   │  hero_boombox  ◆ ·   │
//   │  ...                 │
//   └──────────────────────┘
//
// HEROES tab — one row per hero in the dropdown map. Row click sets the
// gizmo edit target (same path as the lil-gui dropdown). Cyan diamond
// chip for interactive heroes; gray for set pieces.
//
// AUDIO tab — master volume + muted toggle, 4 channel volume sliders, and
// a live list of currently playing entries with per-entry volume + stop.
// The list rebuilds on audio:play / audio:stop events.

const PANEL_BG = 'rgba(18, 22, 28, 0.86)';
const HOVER_BG = 'rgba(255,255,255,0.04)';
const SELECTED_BG = 'rgba(102, 255, 230, 0.10)';
const ACCENT = '#66ffe6';
const MUTED = '#6c7480';
const TEXT = '#e6ebef';
const SET_CHIP = '#7a7f88';
const SUBHEAD = '#9aa3ad';

const LS_COLLAPSED = 'lec_dev_inspector_collapsed';
const LS_TAB = 'lec_dev_inspector_tab';

type Tab = 'heroes' | 'audio';

export interface InspectorOpts {
  audio: AudioManager;
  heroLookup: Map<string, Object3D>;
  heroIds: Record<string, string>; // label → heroId, from buildHeroDropdownMap
  setEditTarget: (id: string) => void;
  /** Read the currently edited target so the inspector can highlight it. */
  getEditTarget: () => string;
}

export function createInspector(opts: InspectorOpts): {
  root: HTMLElement;
  refreshHeroes(newMap: Record<string, string>): void;
  dispose(): void;
} {
  const root = document.createElement('div');
  root.id = 'lec-inspector';
  Object.assign(root.style, {
    position: 'fixed',
    top: '12px',
    left: '12px',
    width: '280px',
    maxHeight: 'calc(100vh - 112px)', // leave room for timeline + margin
    zIndex: '35',
    background: PANEL_BG,
    color: TEXT,
    font: '11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    borderRadius: '6px',
    border: '1px solid rgba(255,255,255,0.08)',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    backdropFilter: 'blur(6px)',
    WebkitBackdropFilter: 'blur(6px)',
    userSelect: 'none',
  });

  // ── header (collapse / close) ──────────────────────────────────────
  const header = document.createElement('div');
  Object.assign(header.style, {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '6px 10px',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
    cursor: 'pointer',
  });
  const headerLabel = document.createElement('span');
  headerLabel.textContent = 'inspector';
  headerLabel.style.fontWeight = '600';
  const collapseToggle = document.createElement('span');
  collapseToggle.style.color = MUTED;
  header.appendChild(headerLabel);
  header.appendChild(collapseToggle);
  root.appendChild(header);

  // ── tab bar ────────────────────────────────────────────────────────
  const tabBar = document.createElement('div');
  Object.assign(tabBar.style, {
    display: 'flex',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
  });
  const tabBtns: Record<Tab, HTMLDivElement> = {} as never;
  for (const t of ['heroes', 'audio'] as Tab[]) {
    const b = document.createElement('div');
    b.textContent = t.toUpperCase();
    Object.assign(b.style, {
      flex: '1 1 0',
      padding: '6px 10px',
      cursor: 'pointer',
      fontSize: '10px',
      letterSpacing: '0.5px',
      color: MUTED,
      textAlign: 'center',
      borderBottom: '2px solid transparent',
    });
    b.addEventListener('click', () => setTab(t));
    tabBar.appendChild(b);
    tabBtns[t] = b;
  }
  root.appendChild(tabBar);

  // ── tab content ────────────────────────────────────────────────────
  const content = document.createElement('div');
  Object.assign(content.style, {
    flex: '1 1 auto',
    overflowY: 'auto',
    padding: '8px 10px',
  });
  root.appendChild(content);

  // ── state ──────────────────────────────────────────────────────────
  let currentTab: Tab = (localStorage.getItem(LS_TAB) as Tab) || 'heroes';
  let collapsed = localStorage.getItem(LS_COLLAPSED) === '1';
  let heroIdsMap = { ...opts.heroIds };

  function setTab(t: Tab): void {
    currentTab = t;
    try { localStorage.setItem(LS_TAB, t); } catch { /* ignored */ }
    for (const [n, b] of Object.entries(tabBtns) as [Tab, HTMLDivElement][]) {
      if (n === t) {
        b.style.color = ACCENT;
        b.style.borderBottomColor = ACCENT;
      } else {
        b.style.color = MUTED;
        b.style.borderBottomColor = 'transparent';
      }
    }
    renderTab();
  }

  function setCollapsed(v: boolean): void {
    collapsed = v;
    try { localStorage.setItem(LS_COLLAPSED, v ? '1' : '0'); } catch { /* ignored */ }
    collapseToggle.textContent = collapsed ? '+' : '–';
    tabBar.style.display = collapsed ? 'none' : 'flex';
    content.style.display = collapsed ? 'none' : 'block';
  }
  header.addEventListener('click', () => setCollapsed(!collapsed));

  function refreshHeroes(newMap: Record<string, string>): void {
    heroIdsMap = { ...newMap };
    if (currentTab === 'heroes') renderTab();
  }

  // ── render: heroes tab ─────────────────────────────────────────────
  function renderHeroes(): void {
    content.innerHTML = '';
    const hint = document.createElement('div');
    hint.textContent = 'click a row to edit (gizmo follows)';
    Object.assign(hint.style, { color: MUTED, fontSize: '9px', marginBottom: '8px' });
    content.appendChild(hint);

    const activeTarget = opts.getEditTarget();

    // Group rows by the formatted label so heroes from the dropdown map
    // appear in the same order as the lil-gui dropdown. The map looks
    // like { "hero_speaker (past)": "hero_speaker", ... }.
    const rows = Object.entries(heroIdsMap);
    if (rows.length === 0) {
      const empty = document.createElement('div');
      empty.textContent = '(no heroes loaded)';
      empty.style.color = MUTED;
      content.appendChild(empty);
      return;
    }
    for (const [label, id] of rows) {
      // Skip the "(none)" placeholder if it shows up — that's a panel
      // convenience, not a hero. Real ids never collide with that string.
      if (id === '(none)') continue;
      const obj = opts.heroLookup.get(id);
      const interactive = obj?.userData?.interactive !== false;
      const row = mkHeroRow({ label, id, interactive, selected: id === activeTarget });
      row.addEventListener('click', () => {
        opts.setEditTarget(id);
        renderTab(); // re-render so the selected-highlight tracks
      });
      content.appendChild(row);
    }
  }

  function mkHeroRow(p: { label: string; id: string; interactive: boolean; selected: boolean }): HTMLDivElement {
    const row = document.createElement('div');
    Object.assign(row.style, {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '4px 6px',
      cursor: 'pointer',
      borderRadius: '4px',
      background: p.selected ? SELECTED_BG : 'transparent',
    });
    row.addEventListener('mouseenter', () => { if (!p.selected) row.style.background = HOVER_BG; });
    row.addEventListener('mouseleave', () => { if (!p.selected) row.style.background = 'transparent'; });
    const name = document.createElement('span');
    name.textContent = p.label;
    name.style.color = p.selected ? ACCENT : TEXT;
    name.style.whiteSpace = 'nowrap';
    name.style.overflow = 'hidden';
    name.style.textOverflow = 'ellipsis';
    name.style.maxWidth = '210px';
    const chip = document.createElement('span');
    chip.textContent = p.interactive ? '◆' : '◇';
    chip.style.color = p.interactive ? ACCENT : SET_CHIP;
    chip.style.fontSize = '10px';
    chip.title = p.interactive ? 'interactive' : 'set';
    row.appendChild(name);
    row.appendChild(chip);
    return row;
  }

  // ── render: audio tab ──────────────────────────────────────────────
  // Holds refs to per-entry rows for incremental update on volume drag.
  const audioRows = new Map<string, { row: HTMLDivElement; slider: HTMLInputElement }>();

  function renderAudio(): void {
    content.innerHTML = '';
    audioRows.clear();

    // Master section
    const master = mkSubhead('output');
    content.appendChild(master);
    const muted = mkCheckbox('muted', opts.audio.muted, (v) => opts.audio.setMuted(v));
    content.appendChild(muted.row);
    const masterVol = mkSlider('master', opts.audio.getMasterVolume(), (v) => opts.audio.setMasterVolume(v));
    content.appendChild(masterVol.row);

    // Channels section
    const chans = mkSubhead('channels');
    chans.style.marginTop = '10px';
    content.appendChild(chans);
    for (const ch of ['ambient', 'music', 'narration', 'sfx'] as AudioChannel[]) {
      const v = opts.audio.getChannelVolume(ch);
      const s = mkSlider(ch, v, (newV) => opts.audio.setChannelVolume(ch, newV));
      content.appendChild(s.row);
    }

    // Playing now section
    const playing = mkSubhead('playing now');
    playing.style.marginTop = '10px';
    content.appendChild(playing);
    renderPlayingList();
  }

  function renderPlayingList(): void {
    // Wipe any prior playing-list rows. The first three groups (output,
    // channels) stay; we only rebuild the bottom.
    for (const { row } of audioRows.values()) row.remove();
    audioRows.clear();
    const entries = opts.audio.listPlaying();
    if (entries.length === 0) {
      const empty = document.createElement('div');
      empty.textContent = '(nothing playing)';
      empty.style.color = MUTED;
      empty.style.fontSize = '10px';
      empty.dataset.placeholder = '1';
      content.appendChild(empty);
      audioRows.set('__placeholder__', { row: empty, slider: null as never });
      return;
    }
    for (const e of entries) {
      const row = mkAudioRow(e.id, e.channel);
      content.appendChild(row.row);
      audioRows.set(audioKey(e.id, e.channel), row);
    }
  }

  function audioKey(id: string, channel: string): string { return id + '|' + channel; }

  function mkAudioRow(id: string, channel: AudioChannel): { row: HTMLDivElement; slider: HTMLInputElement } {
    const row = document.createElement('div');
    Object.assign(row.style, {
      display: 'flex',
      flexDirection: 'column',
      gap: '2px',
      padding: '4px 6px',
      borderRadius: '4px',
      background: HOVER_BG,
      marginBottom: '4px',
    });
    const top = document.createElement('div');
    Object.assign(top.style, { display: 'flex', justifyContent: 'space-between', alignItems: 'center' });
    const name = document.createElement('span');
    name.textContent = id;
    name.style.maxWidth = '180px';
    name.style.whiteSpace = 'nowrap';
    name.style.overflow = 'hidden';
    name.style.textOverflow = 'ellipsis';
    const chip = document.createElement('span');
    chip.textContent = channel;
    chip.style.color = channelColor(channel);
    chip.style.fontSize = '9px';
    chip.style.letterSpacing = '0.5px';
    top.appendChild(name);
    top.appendChild(chip);
    const bottom = document.createElement('div');
    Object.assign(bottom.style, { display: 'flex', alignItems: 'center', gap: '6px' });
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '0';
    slider.max = '1';
    slider.step = '0.01';
    slider.value = String(opts.audio.getEntryVolume(id, channel) ?? 1);
    slider.style.flex = '1 1 auto';
    slider.addEventListener('input', () => {
      opts.audio.setEntryVolume(id, channel, parseFloat(slider.value));
    });
    const stopBtn = document.createElement('button');
    stopBtn.textContent = '◼';
    Object.assign(stopBtn.style, {
      background: 'transparent', color: MUTED, border: '1px solid rgba(255,255,255,0.10)',
      borderRadius: '3px', padding: '0 4px', cursor: 'pointer', fontFamily: 'inherit', fontSize: '9px',
    });
    stopBtn.addEventListener('click', () => opts.audio.stop(id, 0.1));
    bottom.appendChild(slider);
    bottom.appendChild(stopBtn);
    row.appendChild(top);
    row.appendChild(bottom);
    return { row, slider };
  }

  function renderTab(): void {
    if (currentTab === 'heroes') renderHeroes();
    else renderAudio();
  }

  // ── audio event subscriptions ──────────────────────────────────────
  const unsubPlay = devBus.on('audio:play', () => {
    if (currentTab === 'audio') renderPlayingList();
  });
  const unsubStop = devBus.on('audio:stop', () => {
    if (currentTab === 'audio') renderPlayingList();
  });

  // ── dev mode hide ──────────────────────────────────────────────────
  const unsubDev = onDevModeChange((on) => {
    root.style.display = on ? 'flex' : 'none';
  });

  // ── init ───────────────────────────────────────────────────────────
  setCollapsed(collapsed);
  setTab(currentTab);
  document.body.appendChild(root);

  return {
    root,
    refreshHeroes,
    dispose(): void {
      unsubPlay();
      unsubStop();
      unsubDev();
      root.remove();
    },
  };
}

// ── helpers ───────────────────────────────────────────────────────────

function mkSubhead(label: string): HTMLDivElement {
  const d = document.createElement('div');
  d.textContent = label;
  Object.assign(d.style, {
    color: SUBHEAD,
    fontSize: '9px',
    letterSpacing: '0.5px',
    textTransform: 'uppercase',
    marginBottom: '4px',
  });
  return d;
}

function mkSlider(label: string, initial: number, onChange: (v: number) => void): { row: HTMLDivElement } {
  const row = document.createElement('div');
  Object.assign(row.style, { display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '3px' });
  const lbl = document.createElement('span');
  lbl.textContent = label;
  lbl.style.width = '70px';
  lbl.style.color = MUTED;
  lbl.style.fontSize = '10px';
  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = '0';
  slider.max = '1';
  slider.step = '0.01';
  slider.value = String(initial);
  slider.style.flex = '1 1 auto';
  const val = document.createElement('span');
  val.textContent = initial.toFixed(2);
  val.style.color = MUTED;
  val.style.fontSize = '9px';
  val.style.minWidth = '28px';
  val.style.textAlign = 'right';
  slider.addEventListener('input', () => {
    const v = parseFloat(slider.value);
    onChange(v);
    val.textContent = v.toFixed(2);
  });
  row.appendChild(lbl);
  row.appendChild(slider);
  row.appendChild(val);
  return { row };
}

function mkCheckbox(label: string, initial: boolean, onChange: (v: boolean) => void): { row: HTMLDivElement } {
  const row = document.createElement('div');
  Object.assign(row.style, { display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '3px', cursor: 'pointer' });
  const lbl = document.createElement('span');
  lbl.textContent = label;
  lbl.style.width = '70px';
  lbl.style.color = MUTED;
  lbl.style.fontSize = '10px';
  const dot = document.createElement('span');
  dot.textContent = initial ? '●' : '○';
  dot.style.color = initial ? ACCENT : MUTED;
  dot.style.fontSize = '11px';
  row.appendChild(lbl);
  row.appendChild(dot);
  row.addEventListener('click', () => {
    const v = dot.textContent === '○';
    onChange(v);
    dot.textContent = v ? '●' : '○';
    dot.style.color = v ? ACCENT : MUTED;
  });
  return { row };
}

function channelColor(ch: AudioChannel): string {
  switch (ch) {
    case 'ambient': return '#6acf91';
    case 'music': return '#4fc3f7';
    case 'narration': return '#ffd87c';
    case 'sfx': return '#ff7eb6';
    default: return MUTED;
  }
}
