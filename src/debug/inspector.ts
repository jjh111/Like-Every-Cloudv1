import { type Color, type WebGLRenderer, type Object3D } from 'three';
import type { AudioChannel, AudioManager } from '../audio/audioManager';
import type { SunRig } from '../atmosphere/sunRig';
import type { Atmosphere } from '../atmosphere/atmosphere';
import type { ClothPatch } from '../scene/clothPatch';
import type { StateController } from '../state/stateController';
import type { StateConfig, HeroAudioBed } from '../state/stateConfig';
import type { StateName } from '../state/types';
import type { AudioAsset } from '../audio/manifest';
import type { DebugVizScene, GizmoCategory } from './dvScene';
import { devBus } from './devBus';
import { onDevModeChange, setDevMode } from './devMode';

const GIZMO_CATEGORIES: GizmoCategory[] = ['audio', 'cloth', 'lighting', 'culling', 'cameras'];

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

type Tab = 'heroes' | 'audio' | 'atmosphere' | 'perf';

export interface InspectorOpts {
  audio: AudioManager;
  heroLookup: Map<string, Object3D>;
  heroIds: Record<string, string>; // label → heroId, from buildHeroDropdownMap
  setEditTarget: (id: string) => void;
  /** Read the currently edited target so the inspector can highlight it. */
  getEditTarget: () => string;
  /** Called after a hero's state tag changes (past/present/both) so the
   *  caller can re-init the transition + refresh dropdown labels. */
  onHeroRetag?: () => void;
  // Phase 8: atmosphere + perf
  sunRig: SunRig;
  atmospheres: Record<string, Atmosphere>;
  getActiveAtmosphere: () => Atmosphere;
  setAtmosphere: (name: string) => void;
  renderer: WebGLRenderer;
  cloths: ClothPatch[];
  /** 3D debug-viz scene — the inspector's gizmo footer drives it. */
  dv: DebugVizScene;
  // ── audio authoring (absorbed from the hero-audio-mixer + tracks-bar) ──
  /** Current morph state — hero beds operate on `state.current`. */
  state: StateController;
  /** Authored per-state hero ambient beds. The AUDIO tab edits a copy. */
  stateConfig: StateConfig;
  /** Persist both states' beds to public/states.json. */
  saveStatesConfig: (config: StateConfig) => Promise<void>;
  /** Full audio catalogue for the quick-play (audition) chip grid. */
  audioAssets: AudioAsset[];
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
    // Starts below the top-left logo badge (which grows on hover) so the
    // two never collide. Bottom edge stops above the 88px timeline.
    top: '80px',
    left: '12px',
    width: '300px',
    maxHeight: 'calc(100vh - 176px)', // 80 top + 88 timeline + 8 gap
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
  // Right side of the header: a director-mode toggle + the collapse caret.
  // The director button is the discoverable way to drop into the clean
  // viewer view (the D hotkey does the same). stopPropagation keeps a
  // click on it from also toggling collapse.
  const headerRight = document.createElement('div');
  Object.assign(headerRight.style, { display: 'flex', alignItems: 'center', gap: '10px' });
  const directorBtn = document.createElement('span');
  directorBtn.textContent = 'director';
  directorBtn.title = 'hide all dev UI (D)';
  Object.assign(directorBtn.style, {
    color: MUTED,
    fontSize: '9px',
    letterSpacing: '0.5px',
    padding: '1px 6px',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: '10px',
    cursor: 'pointer',
  });
  directorBtn.addEventListener('mouseenter', () => { directorBtn.style.borderColor = ACCENT; directorBtn.style.color = ACCENT; });
  directorBtn.addEventListener('mouseleave', () => { directorBtn.style.borderColor = 'rgba(255,255,255,0.12)'; directorBtn.style.color = MUTED; });
  directorBtn.addEventListener('click', (e) => { e.stopPropagation(); setDevMode(false); });
  const collapseToggle = document.createElement('span');
  collapseToggle.style.color = MUTED;
  headerRight.appendChild(directorBtn);
  headerRight.appendChild(collapseToggle);
  header.appendChild(headerLabel);
  header.appendChild(headerRight);
  root.appendChild(header);

  // ── tab bar ────────────────────────────────────────────────────────
  const tabBar = document.createElement('div');
  Object.assign(tabBar.style, {
    display: 'flex',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
  });
  const tabBtns: Record<Tab, HTMLDivElement> = {} as never;
  for (const t of ['heroes', 'audio', 'atmosphere', 'perf'] as Tab[]) {
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

  // ── gizmo footer (folded-in from the old standalone dock) ───────────
  // Always-visible strip at the bottom of the inspector: master toggle +
  // five 3D-viz category toggles. Drives the DebugVizScene directly; the
  // G hotkey toggles the master. Replaces the top-right gizmo dock that
  // collided with lil-gui.
  const gizmoFooter = document.createElement('div');
  Object.assign(gizmoFooter.style, {
    borderTop: '1px solid rgba(255,255,255,0.08)',
    padding: '6px 10px',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flexWrap: 'wrap',
    flexShrink: '0',
  });
  const gizmoMaster = document.createElement('span');
  gizmoMaster.style.cursor = 'pointer';
  gizmoMaster.style.fontSize = '10px';
  gizmoMaster.style.fontWeight = '600';
  gizmoMaster.title = 'toggle all gizmos (G)';
  gizmoMaster.addEventListener('click', () => opts.dv.toggle());
  gizmoFooter.appendChild(gizmoMaster);
  const gizmoCatEls: Partial<Record<GizmoCategory, HTMLSpanElement>> = {};
  for (const cat of GIZMO_CATEGORIES) {
    const el = document.createElement('span');
    el.textContent = cat;
    Object.assign(el.style, { cursor: 'pointer', fontSize: '9px', letterSpacing: '0.3px' });
    el.addEventListener('click', () => opts.dv.setCategoryEnabled(cat, !opts.dv.isCategoryEnabled(cat)));
    gizmoFooter.appendChild(el);
    gizmoCatEls[cat] = el;
  }
  root.appendChild(gizmoFooter);
  const unsubGizmo = opts.dv.onChange((state) => {
    gizmoMaster.textContent = (state.enabled ? '● gizmos' : '○ gizmos');
    gizmoMaster.style.color = state.enabled ? ACCENT : MUTED;
    for (const cat of GIZMO_CATEGORIES) {
      const el = gizmoCatEls[cat];
      if (!el) continue;
      const on = state.enabled && state.categories[cat];
      el.style.color = on ? ACCENT : MUTED;
      el.style.opacity = state.enabled ? '1' : '0.5';
    }
  });
  const onGizmoKey = (e: KeyboardEvent): void => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'g' || e.key === 'G') { e.preventDefault(); opts.dv.toggle(); }
  };
  window.addEventListener('keydown', onGizmoKey);

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
  // Row = name (click → edit/gizmo) · interactive chip · state segment
  // (past/pres/both). The state segment is the absorbed hero-state panel:
  // it writes obj.userData.state and fires onHeroRetag so the transition
  // re-inits + the dropdowns refresh. Group (★) / #all bulk handles have
  // no state, so they show no segment.
  function renderHeroes(): void {
    content.innerHTML = '';
    const hint = document.createElement('div');
    hint.textContent = 'name = edit · pa/pr/bo = state tag';
    Object.assign(hint.style, { color: MUTED, fontSize: '9px', marginBottom: '8px' });
    content.appendChild(hint);

    const activeTarget = opts.getEditTarget();
    const rows = Object.entries(heroIdsMap);
    if (rows.length === 0) {
      const empty = document.createElement('div');
      empty.textContent = '(no heroes loaded)';
      empty.style.color = MUTED;
      content.appendChild(empty);
      return;
    }
    for (const [label, id] of rows) {
      if (id === '(none)') continue;
      const obj = opts.heroLookup.get(id);
      const interactive = obj?.userData?.interactive !== false;
      const isBulk = id.startsWith('group:') || id.endsWith('#all');
      const row = mkHeroRow({
        // Real heroes show the bare id (the state segment replaces the
        // "(past)" label suffix); bulk handles keep their decorated label.
        name: isBulk ? label : id,
        id, interactive, selected: id === activeTarget,
        obj: obj ?? null,
        showState: !isBulk && !!obj,
      });
      content.appendChild(row);
    }
  }

  function mkHeroRow(p: {
    name: string; id: string; interactive: boolean; selected: boolean;
    obj: Object3D | null; showState: boolean;
  }): HTMLDivElement {
    const row = document.createElement('div');
    Object.assign(row.style, {
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      padding: '4px 6px',
      borderRadius: '4px',
      background: p.selected ? SELECTED_BG : 'transparent',
    });
    const name = document.createElement('span');
    name.textContent = p.name;
    name.style.color = p.selected ? ACCENT : TEXT;
    name.style.whiteSpace = 'nowrap';
    name.style.overflow = 'hidden';
    name.style.textOverflow = 'ellipsis';
    name.style.flex = '1 1 auto';
    name.style.cursor = 'pointer';
    name.title = 'edit / move (gizmo follows)';
    name.addEventListener('mouseenter', () => { if (!p.selected) name.style.color = ACCENT; });
    name.addEventListener('mouseleave', () => { if (!p.selected) name.style.color = TEXT; });
    name.addEventListener('click', () => { opts.setEditTarget(p.id); renderTab(); });
    const chip = document.createElement('span');
    chip.textContent = p.interactive ? '◆' : '◇';
    chip.style.color = p.interactive ? ACCENT : SET_CHIP;
    chip.style.fontSize = '10px';
    chip.style.flexShrink = '0';
    chip.title = p.interactive ? 'interactive' : 'set';
    row.appendChild(name);
    row.appendChild(chip);
    if (p.showState && p.obj) row.appendChild(mkStateSeg(p.obj));
    return row;
  }

  // Three-segment state tag control (past / present / both). Writes
  // obj.userData.state and fires onHeroRetag (re-init transition + refresh
  // dropdowns). Click is stopPropagation'd so it never doubles as a select.
  function mkStateSeg(obj: Object3D): HTMLDivElement {
    const wrap = document.createElement('div');
    Object.assign(wrap.style, { display: 'flex', gap: '2px', flexShrink: '0' });
    const cur = (obj.userData.state ?? 'past') as string;
    const defs: Array<[string, string]> = [['past', 'pa'], ['present', 'pr'], ['both', 'bo']];
    for (const [val, lab] of defs) {
      const b = document.createElement('span');
      b.textContent = lab;
      b.title = val;
      const active = cur === val;
      Object.assign(b.style, {
        fontSize: '9px',
        padding: '1px 5px',
        borderRadius: '3px',
        cursor: 'pointer',
        color: active ? '#0e1218' : MUTED,
        background: active ? ACCENT : 'transparent',
        border: `1px solid ${active ? ACCENT : 'rgba(255,255,255,0.12)'}`,
      });
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        obj.userData.state = val;
        opts.onHeroRetag?.();
        renderTab();
      });
      wrap.appendChild(b);
    }
    return wrap;
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

    // Hero beds + asset audition (absorbed panels).
    renderBeds();
    renderAssets();
  }

  // ── hero ambient beds (absorbed from hero-audio-mixer) ──────────────
  // Working copy of the authored beds — never mutate the caller's config.
  // "save mix" flushes this to states.json.
  const bedConfig: StateConfig = {
    past: { ...opts.stateConfig.past, heroAudio: { ...(opts.stateConfig.past.heroAudio ?? {}) } },
    present: { ...opts.stateConfig.present, heroAudio: { ...(opts.stateConfig.present.heroAudio ?? {}) } },
  };
  const bedHeroIds = Array.from(new Set([
    ...Object.keys(bedConfig.past.heroAudio ?? {}),
    ...Object.keys(bedConfig.present.heroAudio ?? {}),
  ])).sort();
  interface BedRow { toggle: HTMLSpanElement; slider: HTMLInputElement; caption: HTMLSpanElement; }
  const bedRows = new Map<string, BedRow>();
  let bedStateBadge: HTMLSpanElement | null = null;

  const bedFor = (heroId: string, st: StateName): HeroAudioBed | undefined => bedConfig[st].heroAudio?.[heroId];
  const channelOf = (bed: HeroAudioBed): AudioChannel => bed.channel ?? 'ambient';
  const templateBed = (heroId: string, st: StateName): HeroAudioBed => {
    const a = bedConfig[st].heroAudio?.[heroId];
    if (a) return { ...a };
    const other: StateName = st === 'past' ? 'present' : 'past';
    const b = bedConfig[other].heroAudio?.[heroId];
    if (b) return { ...b };
    return { id: '', volume: 0.4 };
  };
  const startBed = (heroId: string): void => {
    const st = opts.state.current;
    let bed = bedFor(heroId, st);
    if (!bed) {
      const t = templateBed(heroId, st);
      if (!t.id) { console.warn('[inspector] no template bed for', heroId); return; }
      bed = t;
      (bedConfig[st].heroAudio ??= {})[heroId] = bed;
    }
    const obj = opts.heroLookup.get(heroId);
    opts.audio.play(bed.id, {
      channel: channelOf(bed), loop: bed.loop ?? true, volume: bed.volume ?? 0.4,
      fadeIn: 0.4, at: obj ? { object: obj } : undefined,
    });
  };
  const stopBed = (heroId: string): void => {
    const st = opts.state.current;
    const bed = bedFor(heroId, st);
    if (bed) { opts.audio.stop(bed.id, 0.4); delete bedConfig[st].heroAudio?.[heroId]; }
    else {
      const other = bedFor(heroId, st === 'past' ? 'present' : 'past');
      if (other) opts.audio.stop(other.id, 0.4);
    }
  };

  function renderBeds(): void {
    bedRows.clear();
    bedStateBadge = null;
    const head = mkSubhead('hero beds');
    head.style.marginTop = '10px';
    const badge = document.createElement('span');
    badge.textContent = opts.state.current;
    Object.assign(badge.style, { color: ACCENT, fontSize: '9px', marginLeft: '6px' });
    head.appendChild(badge);
    bedStateBadge = badge;
    content.appendChild(head);
    if (bedHeroIds.length === 0) {
      const empty = document.createElement('div');
      empty.textContent = '(no heroAudio in states.json)';
      empty.style.color = MUTED; empty.style.fontSize = '10px';
      content.appendChild(empty);
      return;
    }
    for (const heroId of bedHeroIds) {
      const row = document.createElement('div');
      Object.assign(row.style, { display: 'flex', alignItems: 'center', gap: '6px', padding: '3px 0' });
      const toggle = document.createElement('span');
      Object.assign(toggle.style, { cursor: 'pointer', fontSize: '12px', width: '14px', flexShrink: '0', color: MUTED });
      toggle.textContent = '○';
      toggle.addEventListener('click', async () => {
        try { await opts.audio.resume(); } catch { /* ignored */ }
        const bed = bedFor(heroId, opts.state.current);
        const ch = bed ? channelOf(bed) : 'ambient';
        if (bed && opts.audio.isEntryPlaying(bed.id, ch)) stopBed(heroId); else startBed(heroId);
        refreshBeds();
      });
      const labelBlock = document.createElement('div');
      Object.assign(labelBlock.style, { flex: '1 1 auto', minWidth: '0' });
      const nm = document.createElement('div');
      nm.textContent = heroId;
      Object.assign(nm.style, { fontSize: '10px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' });
      const caption = document.createElement('span');
      Object.assign(caption.style, { fontSize: '8.5px', color: MUTED, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block' });
      labelBlock.appendChild(nm); labelBlock.appendChild(caption);
      const slider = document.createElement('input');
      slider.type = 'range'; slider.min = '0'; slider.max = '1'; slider.step = '0.01'; slider.value = '0';
      Object.assign(slider.style, { width: '72px', flexShrink: '0' });
      slider.addEventListener('input', () => {
        const bed = bedFor(heroId, opts.state.current);
        if (!bed) return;
        bed.volume = Number(slider.value);
        opts.audio.setEntryVolume(bed.id, channelOf(bed), bed.volume);
      });
      row.appendChild(toggle); row.appendChild(labelBlock); row.appendChild(slider);
      content.appendChild(row);
      bedRows.set(heroId, { toggle, slider, caption });
    }
    // save mix
    const saveRow = document.createElement('div');
    Object.assign(saveRow.style, { display: 'flex', alignItems: 'center', gap: '8px', marginTop: '6px' });
    const saveBtn = document.createElement('button');
    saveBtn.textContent = 'save mix';
    Object.assign(saveBtn.style, {
      flex: '1', padding: '4px 8px', background: 'rgba(255,255,255,0.06)', color: TEXT,
      border: '1px solid rgba(255,255,255,0.18)', borderRadius: '4px', cursor: 'pointer',
      font: 'inherit', fontSize: '10px',
    });
    const saveStatus = document.createElement('span');
    Object.assign(saveStatus.style, { fontSize: '9px', color: MUTED, minWidth: '48px', textAlign: 'right' });
    saveBtn.addEventListener('click', async () => {
      saveBtn.disabled = true; saveStatus.textContent = 'saving…';
      try { await opts.saveStatesConfig(bedConfig); saveStatus.textContent = 'saved ✓'; setTimeout(() => { saveStatus.textContent = ''; }, 1500); }
      catch { saveStatus.textContent = 'failed'; }
      finally { saveBtn.disabled = false; }
    });
    saveRow.appendChild(saveBtn); saveRow.appendChild(saveStatus);
    content.appendChild(saveRow);
    refreshBeds();
  }

  function refreshBeds(): void {
    if (bedStateBadge) bedStateBadge.textContent = opts.state.current;
    const st = opts.state.current;
    for (const [heroId, refs] of bedRows) {
      const bed = bedFor(heroId, st);
      const ch: AudioChannel = bed ? channelOf(bed) : 'ambient';
      const playing = bed ? opts.audio.isEntryPlaying(bed.id, ch) : false;
      refs.toggle.textContent = playing ? '●' : '○';
      refs.toggle.style.color = playing ? ACCENT : MUTED;
      if (bed) refs.caption.textContent = `${bed.id} · ${ch}`;
      else { const t = templateBed(heroId, st); refs.caption.textContent = t.id ? `off · would play ${t.id}` : '(no template)'; }
      refs.slider.disabled = !bed;
      if (document.activeElement !== refs.slider) {
        const live = bed ? opts.audio.getEntryVolume(bed.id, ch) : undefined;
        refs.slider.value = String(live ?? bed?.volume ?? 0);
      }
    }
  }

  // ── asset audition grid (absorbed from tracks-bar) ──────────────────
  const assetChips = new Map<string, HTMLSpanElement>();
  function renderAssets(): void {
    assetChips.clear();
    const head = mkSubhead('audition assets');
    head.style.marginTop = '10px';
    content.appendChild(head);
    const grid = document.createElement('div');
    Object.assign(grid.style, { display: 'flex', flexWrap: 'wrap', gap: '4px' });
    for (const a of opts.audioAssets) {
      const chip = document.createElement('span');
      chip.textContent = a.id;
      chip.title = `audition ${a.id} on sfx`;
      Object.assign(chip.style, {
        fontSize: '9px', padding: '2px 6px', borderRadius: '4px',
        border: '1px solid rgba(255,255,255,0.15)', cursor: 'pointer', color: MUTED, whiteSpace: 'nowrap',
      });
      chip.addEventListener('click', async () => {
        try { await opts.audio.resume(); } catch { /* ignored */ }
        opts.audio.play(a.id, { channel: 'sfx', volume: 0.8, fadeIn: 0.05, exclusive: true });
      });
      assetChips.set(a.id, chip);
      grid.appendChild(chip);
    }
    content.appendChild(grid);
    refreshAssets();
  }
  function refreshAssets(): void {
    const playingIds = new Set(opts.audio.listPlaying().map((p) => p.id));
    for (const [id, chip] of assetChips) {
      const on = playingIds.has(id);
      chip.style.color = on ? ACCENT : MUTED;
      chip.style.borderColor = on ? ACCENT : 'rgba(255,255,255,0.15)';
    }
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
    stopPerfLoop();
    if (currentTab === 'heroes') renderHeroes();
    else if (currentTab === 'audio') renderAudio();
    else if (currentTab === 'atmosphere') renderAtmosphere();
    else if (currentTab === 'perf') { renderPerf(); startPerfLoop(); }
  }

  // ── render: atmosphere tab ─────────────────────────────────────────
  function renderAtmosphere(): void {
    content.innerHTML = '';

    // Palette swatches.
    const paletteHead = mkSubhead('palette');
    content.appendChild(paletteHead);
    const palette = opts.sunRig.palette;
    const swatchRows: Array<[string, Color]> = [
      ['top', palette.top],
      ['horizon', palette.horizon],
      ['bottom', palette.bottom],
      ['cloud', palette.cloud],
      ['sun glow', palette.sunGlow],
      ['sun light', palette.sunLight],
      ['ambient', palette.ambient],
    ];
    for (const [label, color] of swatchRows) {
      content.appendChild(mkSwatchRow(label, color));
    }

    // Numeric palette readouts (sun light + ambient intensities).
    const intensities = document.createElement('div');
    Object.assign(intensities.style, { display: 'flex', justifyContent: 'space-between', marginTop: '6px', color: MUTED, fontSize: '10px' });
    intensities.innerHTML =
      `<span>sun ×${palette.sunIntensity.toFixed(2)}</span>` +
      `<span>amb ×${palette.ambientIntensity.toFixed(2)}</span>` +
      `<span>alt ${opts.sunRig.altitude.toFixed(2)}</span>`;
    content.appendChild(intensities);

    // Preset selector.
    const presetHead = mkSubhead('preset');
    presetHead.style.marginTop = '10px';
    content.appendChild(presetHead);
    const presetWrap = document.createElement('div');
    Object.assign(presetWrap.style, { display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '4px' });
    const activeAtm = opts.getActiveAtmosphere();
    for (const name of Object.keys(opts.atmospheres)) {
      const btn = document.createElement('button');
      btn.textContent = name;
      const isActive = opts.atmospheres[name] === activeAtm;
      Object.assign(btn.style, {
        background: isActive ? 'rgba(102, 255, 230, 0.15)' : 'transparent',
        color: isActive ? ACCENT : TEXT,
        border: `1px solid ${isActive ? ACCENT : 'rgba(255,255,255,0.10)'}`,
        borderRadius: '3px',
        padding: '2px 6px',
        cursor: 'pointer',
        fontFamily: 'inherit',
        fontSize: '10px',
      });
      btn.addEventListener('click', () => {
        opts.setAtmosphere(name);
        renderTab();
      });
      presetWrap.appendChild(btn);
    }
    content.appendChild(presetWrap);

    // Active atmosphere tunables.
    const t = opts.getActiveAtmosphere().getTunables?.();
    if (t && t.specs.length) {
      const tHead = mkSubhead('tunables');
      tHead.style.marginTop = '10px';
      content.appendChild(tHead);
      const tunablesTarget = t.target as Record<string, number>;
      for (const s of t.specs) {
        const slider = mkSliderRange(s.label, tunablesTarget[s.key], s.min, s.max, s.step, (v) => {
          tunablesTarget[s.key] = v;
        });
        content.appendChild(slider.row);
      }
    }
  }

  function mkSwatchRow(label: string, color: Color): HTMLDivElement {
    const row = document.createElement('div');
    Object.assign(row.style, { display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '3px' });
    const sw = document.createElement('span');
    const hex = '#' + color.getHexString();
    Object.assign(sw.style, {
      width: '14px', height: '14px',
      borderRadius: '3px',
      background: hex,
      border: '1px solid rgba(255,255,255,0.10)',
      flexShrink: '0',
    });
    const lbl = document.createElement('span');
    lbl.textContent = label;
    lbl.style.color = MUTED;
    lbl.style.fontSize = '10px';
    lbl.style.width = '70px';
    const val = document.createElement('span');
    val.textContent = hex;
    val.style.color = TEXT;
    val.style.fontSize = '10px';
    val.style.marginLeft = 'auto';
    row.appendChild(sw);
    row.appendChild(lbl);
    row.appendChild(val);
    return row;
  }

  // ── render: perf tab ───────────────────────────────────────────────
  // Frame time ring buffer — 120 samples, ~2 seconds at 60 fps.
  const FRAME_BUF = 120;
  const frameTimes = new Float32Array(FRAME_BUF);
  let frameIdx = 0;
  let frameCount = 0;
  let lastFrameAt = 0;

  // Refs to the chips we update inside the perf loop. Re-created each
  // time perf tab renders so they're stable.
  let perfFpsChip: HTMLSpanElement | null = null;
  let perfFrameChip: HTMLSpanElement | null = null;
  let perfCallsChip: HTMLSpanElement | null = null;
  let perfTrisChip: HTMLSpanElement | null = null;
  let perfGeosChip: HTMLSpanElement | null = null;
  let perfTexsChip: HTMLSpanElement | null = null;
  let perfAudioChip: HTMLSpanElement | null = null;
  let perfClothChip: HTMLSpanElement | null = null;
  let perfCanvas: HTMLCanvasElement | null = null;
  let perfRaf = 0;

  function renderPerf(): void {
    content.innerHTML = '';

    // Frame time chart.
    const chartHead = mkSubhead('frame time (last 2s)');
    content.appendChild(chartHead);
    perfCanvas = document.createElement('canvas');
    perfCanvas.width = 260;
    perfCanvas.height = 48;
    Object.assign(perfCanvas.style, {
      width: '100%',
      height: '48px',
      borderRadius: '3px',
      background: 'rgba(255,255,255,0.04)',
      marginBottom: '8px',
    });
    content.appendChild(perfCanvas);

    // Big numbers.
    const numbers = mkKVRow('fps', '–');
    perfFpsChip = numbers.val;
    content.appendChild(numbers.row);
    const frameRow = mkKVRow('frame ms', '–');
    perfFrameChip = frameRow.val;
    content.appendChild(frameRow.row);

    const rendererHead = mkSubhead('renderer');
    rendererHead.style.marginTop = '8px';
    content.appendChild(rendererHead);
    const callsRow = mkKVRow('draw calls', '–');
    perfCallsChip = callsRow.val;
    content.appendChild(callsRow.row);
    const trisRow = mkKVRow('triangles', '–');
    perfTrisChip = trisRow.val;
    content.appendChild(trisRow.row);
    const geosRow = mkKVRow('geometries', '–');
    perfGeosChip = geosRow.val;
    content.appendChild(geosRow.row);
    const texsRow = mkKVRow('textures', '–');
    perfTexsChip = texsRow.val;
    content.appendChild(texsRow.row);

    const subsysHead = mkSubhead('subsystems');
    subsysHead.style.marginTop = '8px';
    content.appendChild(subsysHead);
    const audioRow = mkKVRow('audio sources', '–');
    perfAudioChip = audioRow.val;
    content.appendChild(audioRow.row);
    const clothRow = mkKVRow('cloth particles', '–');
    perfClothChip = clothRow.val;
    content.appendChild(clothRow.row);
  }

  function startPerfLoop(): void {
    if (perfRaf) return;
    lastFrameAt = performance.now();
    const tick = (now: number): void => {
      const dt = now - lastFrameAt;
      lastFrameAt = now;
      frameTimes[frameIdx] = dt;
      frameIdx = (frameIdx + 1) % FRAME_BUF;
      frameCount = Math.min(FRAME_BUF, frameCount + 1);

      // Mean frame time over the buffer (skip first ~10 frames so the
      // chart isn't biased by the initial tab-switch hitch).
      let sum = 0;
      for (let i = 0; i < frameCount; i++) sum += frameTimes[i];
      const meanMs = frameCount > 0 ? sum / frameCount : 0;
      const fps = meanMs > 0 ? Math.round(1000 / meanMs) : 0;
      if (perfFpsChip) perfFpsChip.textContent = `${fps}`;
      if (perfFrameChip) perfFrameChip.textContent = `${meanMs.toFixed(1)}`;
      // Color the FPS chip by budget. Green-ish under 18ms, amber under
      // 33ms, red above. We use ACCENT cyan as the "good" tone.
      if (perfFpsChip) perfFpsChip.style.color = meanMs < 18 ? ACCENT : meanMs < 33 ? '#ffd87c' : '#ff7eb6';

      // Renderer stats.
      const info = opts.renderer.info;
      if (perfCallsChip) perfCallsChip.textContent = `${info.render.calls}`;
      if (perfTrisChip) perfTrisChip.textContent = `${info.render.triangles.toLocaleString()}`;
      if (perfGeosChip) perfGeosChip.textContent = `${info.memory.geometries}`;
      if (perfTexsChip) perfTexsChip.textContent = `${info.memory.textures}`;

      // Subsystems.
      if (perfAudioChip) perfAudioChip.textContent = `${opts.audio.listPlaying().length}`;
      let particles = 0;
      for (const c of opts.cloths) particles += c.particleCount;
      if (perfClothChip) perfClothChip.textContent = `${particles}`;

      // Sparkline.
      drawFramePlot();

      perfRaf = requestAnimationFrame(tick);
    };
    perfRaf = requestAnimationFrame(tick);
  }

  function stopPerfLoop(): void {
    if (perfRaf) {
      cancelAnimationFrame(perfRaf);
      perfRaf = 0;
    }
  }

  function drawFramePlot(): void {
    if (!perfCanvas) return;
    const ctx = perfCanvas.getContext('2d');
    if (!ctx) return;
    const w = perfCanvas.width;
    const h = perfCanvas.height;
    ctx.clearRect(0, 0, w, h);
    // Two threshold lines: 16.6ms (60fps) and 33ms (30fps).
    const yFor = (ms: number) => h - Math.min(h, Math.max(0, ms / 50 * h));
    ctx.strokeStyle = 'rgba(102, 255, 230, 0.18)';
    ctx.beginPath();
    ctx.moveTo(0, yFor(16.6));
    ctx.lineTo(w, yFor(16.6));
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255, 216, 124, 0.18)';
    ctx.beginPath();
    ctx.moveTo(0, yFor(33));
    ctx.lineTo(w, yFor(33));
    ctx.stroke();
    // Plot the ring buffer left-to-right, oldest first. The newest
    // sample is at index (frameIdx-1+FRAME_BUF)%FRAME_BUF.
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < frameCount; i++) {
      // Walk from oldest to newest. The oldest is at frameIdx if buffer
      // is full, or 0 if not yet wrapped.
      const start = frameCount < FRAME_BUF ? 0 : frameIdx;
      const j = (start + i) % FRAME_BUF;
      const x = (i / Math.max(1, frameCount - 1)) * w;
      const y = yFor(frameTimes[j]);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  function mkKVRow(key: string, valTxt: string): { row: HTMLDivElement; val: HTMLSpanElement } {
    const row = document.createElement('div');
    Object.assign(row.style, { display: 'flex', justifyContent: 'space-between', padding: '2px 0', fontSize: '10px' });
    const k = document.createElement('span');
    k.textContent = key;
    k.style.color = MUTED;
    const v = document.createElement('span');
    v.textContent = valTxt;
    v.style.color = TEXT;
    v.style.fontFamily = 'inherit';
    row.appendChild(k);
    row.appendChild(v);
    return { row, val: v };
  }

  function mkSliderRange(label: string, initial: number, min: number, max: number, step: number, onChange: (v: number) => void): { row: HTMLDivElement } {
    const row = document.createElement('div');
    Object.assign(row.style, { display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '3px' });
    const lbl = document.createElement('span');
    lbl.textContent = label;
    lbl.style.width = '80px';
    lbl.style.color = MUTED;
    lbl.style.fontSize = '10px';
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = String(min);
    slider.max = String(max);
    slider.step = String(step);
    slider.value = String(initial);
    slider.style.flex = '1 1 auto';
    const val = document.createElement('span');
    val.textContent = formatNum(initial);
    val.style.color = MUTED;
    val.style.fontSize = '9px';
    val.style.minWidth = '36px';
    val.style.textAlign = 'right';
    slider.addEventListener('input', () => {
      const v = parseFloat(slider.value);
      onChange(v);
      val.textContent = formatNum(v);
    });
    row.appendChild(lbl);
    row.appendChild(slider);
    row.appendChild(val);
    return { row };
  }

  function formatNum(v: number): string {
    if (Math.abs(v) >= 100) return v.toFixed(0);
    if (Math.abs(v) >= 1) return v.toFixed(2);
    return v.toFixed(3);
  }

  // ── audio event subscriptions ──────────────────────────────────────
  const onAudioEvent = (): void => {
    if (currentTab !== 'audio') return;
    renderPlayingList();
    refreshBeds();
    refreshAssets();
  };
  const unsubPlay = devBus.on('audio:play', onAudioEvent);
  const unsubStop = devBus.on('audio:stop', onAudioEvent);
  // Live poll for bed/asset visuals (volume drags from elsewhere, state
  // morph flipping which beds are authored). Only does work on the AUDIO
  // tab; cheap no-op otherwise.
  const audioPoll = window.setInterval(() => {
    if (currentTab !== 'audio') return;
    refreshBeds();
    refreshAssets();
  }, 200);

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
      unsubGizmo();
      window.removeEventListener('keydown', onGizmoKey);
      window.clearInterval(audioPoll);
      stopPerfLoop();
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
