import type { Object3D } from 'three';
import type { AudioManager, AudioChannel } from '../audio/audioManager';
import type { StateController } from '../state/stateController';
import type { StateConfig, HeroAudioBed } from '../state/stateConfig';
import type { StateName } from '../state/types';

// Top-left dev-mode panel: per-hero ambient-bed mixer. One row per sound-
// emitting hero (the union of `heroAudio` keys across all states). Each row
// has:
//  - on/off pill that immediately starts/stops the bed for that hero on its
//    bound audio channel (default 'ambient'), spatialized to the hero's
//    Object3D so position changes track live
//  - volume slider that drives setEntryVolume() with smoothing, no zipper
//  - asset id + channel caption so it's obvious what's playing
//
// The panel mirrors the LIVE audio state (polling 200ms), so external rule
// fires (state-change beds) show up here without manual sync. The internal
// `mix` map is editorial — what the user *wants* — and is what gets saved.
// On state change, the mix snaps to the new state's authored beds so each
// state is a self-contained "scene" worth saving.
//
// Persistence: a single button writes the current mix back to states.json
// under the active state's `heroAudio` map. The other state is preserved
// verbatim (we hold the full StateConfig and just patch the active state).
//
// On/off semantics:
//  - "on"  = `mix[heroId]` set + bed is playing
//  - "off" = `mix[heroId]` cleared + bed is stopped (channel-stop wouldn't be
//             enough; that nukes other ambient beds too)
//
// When a hero toggles ON in a state where it's not authored, we inherit the
// most-recent authored bed config (asset id, volume) from the OTHER state.
// If no state has it authored, we surface a quiet warning rather than guess.
export interface HeroAudioMixerDeps {
  audio: AudioManager;
  state: StateController;
  /** Resolve heroId → Object3D for spatial anchoring. Same map used by the
   *  interaction engine. */
  heroLookup: Map<string, Object3D>;
  /** The StateConfig that buildStateRules read at boot — gives us the initial
   *  authored beds + the "template" we save back. The mixer mutates a copy. */
  initialConfig: StateConfig;
  /** Persist the whole config (both states) to public/states.json. The mixer
   *  hands back the current snapshot. */
  saveStatesConfig: (config: StateConfig) => Promise<void>;
}

const ACTIVE_GREEN = '#9fd66b';
const IDLE_GREY = '#7a7a7a';
const ON_BG = 'rgba(159, 214, 107, 0.18)';
const ON_BORDER = 'rgba(159, 214, 107, 0.55)';
const OFF_BG = 'rgba(255, 255, 255, 0.04)';
const OFF_BORDER = 'rgba(255, 255, 255, 0.15)';

export function createHeroAudioMixer(deps: HeroAudioMixerDeps): void {
  const { audio, state, heroLookup, initialConfig, saveStatesConfig } = deps;

  // Working copy — never mutate the caller's StateConfig. Save flushes this.
  const config: StateConfig = {
    past: {
      ...initialConfig.past,
      heroAudio: { ...(initialConfig.past.heroAudio ?? {}) },
    },
    present: {
      ...initialConfig.present,
      heroAudio: { ...(initialConfig.present.heroAudio ?? {}) },
    },
  };

  // ── derive the row set: union of heroIds across both states ─────────────
  // Frozen at boot — adding a new sound hero means editing states.json by
  // hand (the mixer doesn't have a "+ add" affordance yet). 90% of usage is
  // tweaking the already-authored set.
  const heroIds = Array.from(
    new Set([
      ...Object.keys(config.past.heroAudio ?? {}),
      ...Object.keys(config.present.heroAudio ?? {}),
    ]),
  ).sort();

  // For each hero, pick a "template" bed: prefers the current state's entry,
  // falls back to the other state's entry, falls back to a sensible default.
  // Used when a row toggles ON in a state where the hero isn't authored.
  const templateBed = (heroId: string, preferredState: StateName): HeroAudioBed => {
    const a = config[preferredState].heroAudio?.[heroId];
    if (a) return { ...a };
    const otherState: StateName = preferredState === 'past' ? 'present' : 'past';
    const b = config[otherState].heroAudio?.[heroId];
    if (b) return { ...b };
    return { id: '', volume: 0.4 };
  };

  // ── DOM scaffolding ────────────────────────────────────────────────────
  const panel = document.createElement('div');
  panel.style.cssText = [
    'position: fixed',
    // Sits below the top-left logo badge (created by createLogoBadge). The
    // badge is ~48px tall + 16px top offset ≈ 64px total footprint; an extra
    // ~16px gap keeps the two visually separated.
    'top: 80px',
    'left: 16px',
    'padding: 10px 14px 12px',
    'background: rgba(15, 15, 15, 0.78)',
    'color: #ddd',
    'font: 11px/1.4 system-ui, sans-serif',
    'border-radius: 12px',
    'backdrop-filter: blur(6px)',
    'z-index: 1000',
    'user-select: none',
    'min-width: 280px',
    'max-width: 320px',
  ].join('; ');
  document.body.appendChild(panel);

  const header = document.createElement('div');
  header.style.cssText = 'display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px;';
  const headerTitle = document.createElement('span');
  headerTitle.textContent = 'hero audio mixer';
  headerTitle.style.cssText = 'font-weight: 600;';
  const stateBadge = document.createElement('span');
  stateBadge.style.cssText = 'padding: 1px 8px; border-radius: 999px; background: rgba(159, 214, 107, 0.18); color: #cfe9b3; font-weight: 500; font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em;';
  header.appendChild(headerTitle);
  header.appendChild(stateBadge);
  panel.appendChild(header);

  if (heroIds.length === 0) {
    const empty = document.createElement('div');
    empty.style.cssText = 'opacity: 0.6; font-size: 10.5px; padding: 6px 0;';
    empty.textContent = 'No heroAudio entries in states.json yet. Add some heroes there to populate this mixer.';
    panel.appendChild(empty);
    return;
  }

  const rowsRoot = document.createElement('div');
  rowsRoot.style.cssText = 'display: flex; flex-direction: column; gap: 6px;';
  panel.appendChild(rowsRoot);

  interface RowRefs {
    container: HTMLDivElement;
    toggle: HTMLButtonElement;
    slider: HTMLInputElement;
    label: HTMLDivElement;
    caption: HTMLDivElement;
  }
  const rows = new Map<string, RowRefs>();

  // ── audio helpers ──────────────────────────────────────────────────────
  // The active channel + asset id for a hero come from the working `config`,
  // so the same heroId can target different channels per state if needed.
  const bedFor = (heroId: string, st: StateName): HeroAudioBed | undefined => {
    return config[st].heroAudio?.[heroId];
  };

  const channelOf = (bed: HeroAudioBed): AudioChannel => bed.channel ?? 'ambient';

  // Start/stop on the *current* state. Used by toggle clicks. We deliberately
  // don't snapshot the state at button-render time — the closure reads
  // state.current at click time, so the mixer "does what the user expects
  // right now" even if they recently toggled past↔present.
  const startBed = (heroId: string): void => {
    const st = state.current;
    let bed = bedFor(heroId, st);
    if (!bed) {
      // Hero is "off" in this state — inherit from the other state's template
      // and write into the working config. Don't auto-save; the user can save
      // when they're happy with the mix.
      const t = templateBed(heroId, st);
      if (!t.id) {
        console.warn('[mixer] no template bed for', heroId, '— add an entry to states.json first');
        return;
      }
      bed = t;
      (config[st].heroAudio ??= {})[heroId] = bed;
    }
    const obj = heroLookup.get(heroId);
    audio.play(bed.id, {
      channel: channelOf(bed),
      loop: bed.loop ?? true,
      volume: bed.volume ?? 0.4,
      fadeIn: 0.4,
      // Spatial anchor to the hero's Object3D so gizmo drags + state-tagged
      // hides reflect in the panning live. If the hero isn't in the scene
      // (shouldn't happen for sound heroes, but defensive), drop the panner.
      at: obj ? { object: obj } : undefined,
    });
  };

  const stopBed = (heroId: string): void => {
    const st = state.current;
    const bed = bedFor(heroId, st);
    if (bed) {
      audio.stop(bed.id, 0.4);
      // Mark as "off in this state" by removing from the heroAudio map. Save
      // persists this — user can still toggle back on (template re-inherits).
      delete config[st].heroAudio?.[heroId];
    } else {
      // Defensive: hero is already "off" config-wise but might be playing
      // because the other state was authored on. Stop any matching id.
      // Look up via either state's bed for the id.
      const otherBed = bedFor(heroId, st === 'past' ? 'present' : 'past');
      if (otherBed) audio.stop(otherBed.id, 0.4);
    }
  };

  // ── row builder ────────────────────────────────────────────────────────
  for (const heroId of heroIds) {
    const row = document.createElement('div');
    row.style.cssText = 'display: grid; grid-template-columns: 24px 1fr 96px; gap: 8px; padding: 6px 8px; align-items: center; background: rgba(255,255,255,0.03); border-radius: 8px; border: 1px solid rgba(255,255,255,0.05);';

    // ── on/off toggle (24×24 circle) ──
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.style.cssText = [
      'width: 22px',
      'height: 22px',
      'padding: 0',
      'border-radius: 999px',
      'border: 1px solid ' + OFF_BORDER,
      'background: ' + OFF_BG,
      'cursor: pointer',
      'touch-action: manipulation',
      'transition: background 120ms, border-color 120ms, transform 120ms',
      'display: flex',
      'align-items: center',
      'justify-content: center',
      'font-size: 11px',
      'color: ' + IDLE_GREY,
    ].join('; ');
    toggle.title = `toggle ${heroId} on/off in current state`;
    toggle.addEventListener('click', async () => {
      // First click also resumes the AudioContext — same dance as the
      // mute button. Without this, mixer interactions before any other
      // gesture would silently no-op.
      try { await audio.resume(); } catch { /* ignored */ }
      const bed = bedFor(heroId, state.current);
      // "On" right now if we have a bed authored AND it's playing. Either
      // axis missing → toggle should start.
      const channel = bed ? channelOf(bed) : 'ambient';
      const playing = bed ? audio.isEntryPlaying(bed.id, channel) : false;
      if (bed && playing) stopBed(heroId);
      else startBed(heroId);
    });
    toggle.addEventListener('pointerdown', () => { toggle.style.transform = 'scale(0.92)'; });
    toggle.addEventListener('pointerup', () => { toggle.style.transform = ''; });
    toggle.addEventListener('pointerleave', () => { toggle.style.transform = ''; });
    row.appendChild(toggle);

    // ── label + caption ──
    const labelBlock = document.createElement('div');
    labelBlock.style.cssText = 'min-width: 0; overflow: hidden;';
    const label = document.createElement('div');
    label.textContent = heroId;
    label.style.cssText = 'font-family: ui-monospace, Menlo, monospace; font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;';
    const caption = document.createElement('div');
    caption.style.cssText = 'font-size: 9.5px; opacity: 0.55; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 1px;';
    labelBlock.appendChild(label);
    labelBlock.appendChild(caption);
    row.appendChild(labelBlock);

    // ── volume slider ──
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '0';
    slider.max = '1';
    slider.step = '0.01';
    slider.value = '0';
    slider.style.cssText = 'width: 96px; accent-color: #9fd66b; cursor: pointer;';
    slider.title = `volume for ${heroId}`;
    slider.addEventListener('input', () => {
      const v = Number(slider.value);
      const bed = bedFor(heroId, state.current);
      if (!bed) return;          // off in this state — slider is decorative
      bed.volume = v;
      // Live-adjust the playing entry if it's running; if not, the new
      // volume will be picked up on the next start.
      audio.setEntryVolume(bed.id, channelOf(bed), v);
    });
    row.appendChild(slider);

    rowsRoot.appendChild(row);
    rows.set(heroId, { container: row, toggle, slider, label: label as HTMLDivElement, caption });
  }

  // ── footer: save button ────────────────────────────────────────────────
  const footer = document.createElement('div');
  footer.style.cssText = 'display: flex; align-items: center; gap: 8px; margin-top: 10px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.08);';
  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.textContent = 'save mix';
  saveBtn.style.cssText = [
    'flex: 1',
    'padding: 6px 10px',
    'background: rgba(255,255,255,0.06)',
    'color: #ddd',
    'border: 1px solid rgba(255,255,255,0.18)',
    'border-radius: 8px',
    'cursor: pointer',
    'font: inherit',
    'touch-action: manipulation',
    'transition: background 120ms, border-color 120ms',
  ].join('; ');
  saveBtn.addEventListener('pointerenter', () => {
    saveBtn.style.background = 'rgba(159, 214, 107, 0.14)';
    saveBtn.style.borderColor = 'rgba(159, 214, 107, 0.45)';
  });
  saveBtn.addEventListener('pointerleave', () => {
    saveBtn.style.background = 'rgba(255,255,255,0.06)';
    saveBtn.style.borderColor = 'rgba(255,255,255,0.18)';
  });
  const saveStatus = document.createElement('span');
  saveStatus.style.cssText = 'font-size: 10px; opacity: 0.65; min-width: 60px; text-align: right;';
  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    saveStatus.textContent = 'saving…';
    try {
      await saveStatesConfig(config);
      saveStatus.textContent = 'saved ✓';
      setTimeout(() => { saveStatus.textContent = ''; }, 1500);
    } catch {
      saveStatus.textContent = 'failed';
    } finally {
      saveBtn.disabled = false;
    }
  });
  footer.appendChild(saveBtn);
  footer.appendChild(saveStatus);
  panel.appendChild(footer);

  const hint = document.createElement('div');
  hint.style.cssText = 'font-size: 9.5px; opacity: 0.45; margin-top: 6px; line-height: 1.35;';
  hint.textContent = 'Changes are live. Save writes both states to public/states.json.';
  panel.appendChild(hint);

  // ── tick: keep visual state in sync with live audio + state ────────────
  const render = (): void => {
    const st = state.current;
    stateBadge.textContent = st;

    for (const heroId of heroIds) {
      const refs = rows.get(heroId);
      if (!refs) continue;
      const bed = bedFor(heroId, st);
      const ch: AudioChannel = bed ? channelOf(bed) : 'ambient';
      const playing = bed ? audio.isEntryPlaying(bed.id, ch) : false;

      // toggle visual: green when playing, neutral when off
      const targetBg = playing ? ON_BG : OFF_BG;
      const targetBorder = playing ? ON_BORDER : OFF_BORDER;
      const targetColor = playing ? '#cfe9b3' : IDLE_GREY;
      if (refs.toggle.style.background !== targetBg) refs.toggle.style.background = targetBg;
      if (refs.toggle.style.borderColor !== targetBorder) refs.toggle.style.borderColor = targetBorder;
      if (refs.toggle.style.color !== targetColor) refs.toggle.style.color = targetColor;
      const glyph = playing ? '●' : '○';
      if (refs.toggle.textContent !== glyph) refs.toggle.textContent = glyph;

      // label: dim when off in this state
      refs.label.style.opacity = bed ? '1' : '0.55';
      refs.label.style.color = playing ? ACTIVE_GREEN : '#ddd';

      // caption: asset id + channel + state context
      if (bed) {
        refs.caption.textContent = `${bed.id} · ${ch}`;
      } else {
        // Show what would play if toggled on (template from other state)
        const t = templateBed(heroId, st);
        refs.caption.textContent = t.id ? `(off · would play ${t.id})` : '(no template)';
      }

      // slider: reflect current entry volume if playing, else the bed's
      // configured value if authored, else 0. Don't fight the user while
      // they're actively dragging.
      if (document.activeElement !== refs.slider) {
        const live = bed ? audio.getEntryVolume(bed.id, ch) : undefined;
        const target = live ?? bed?.volume ?? 0;
        if (refs.slider.value !== String(target)) {
          refs.slider.value = String(target);
        }
      }
      refs.slider.disabled = !bed;
    }
  };

  render();
  setInterval(render, 200);
}
