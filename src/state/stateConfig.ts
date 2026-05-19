import type { InteractionRule } from '../interaction/actions';
import type { AudioChannel } from '../audio/audioManager';
import type { StateName } from './types';

// Per-state runtime configuration loaded from public/states.json.
//
// Two layers:
//  1. `music` (+ `musicVolume`) — the background music track that plays on
//     the `music` channel when the state becomes target. One track per
//     state. Was historically named `ambient` (misleading — it never went to
//     the ambient channel); the old key is still accepted for back-compat.
//  2. `heroAudio` — a map of heroId → bed config. Each entry plays on the
//     `ambient` channel, spatialized to the corresponding hero. This is how
//     each sound-emitting hero gets authored on/off per state: present in
//     the map = "on", absent = "off". Volume + asset id are per-state, so
//     the same hero can be loud in one state, quiet in another.
//
// Future fields (atmosphere preset, sky tint, narration sting, post-process
// LUT) can sit alongside these without changing the rules pipeline.
export interface HeroAudioBed {
  /** Audio asset id (from src/audio/manifest.ts). */
  id: string;
  /** 0..1. Defaults to 0.4 if unset. */
  volume?: number;
  /** Whether to loop. Defaults to true (ambient beds almost always do). */
  loop?: boolean;
  /** Channel override. Defaults to 'ambient'. */
  channel?: AudioChannel;
}

export interface StateConfigEntry {
  /** Music asset id to play on the 'music' channel when entering this state.
   *  Omit to leave music alone (e.g. a contemplative state with no track). */
  music?: string;
  /** Per-state volume for `music`. Defaults to 0.6 if music is set but volume isn't. */
  musicVolume?: number;
  /** Per-hero ambient beds. Key is the heroId; the spatial anchor is whatever
   *  Object3D in the scene has that heroId. Absent hero = silent in this state. */
  heroAudio?: Record<string, HeroAudioBed>;
}

// Legacy shape — old states.json used `ambient`/`ambientVolume` for the
// music track. Accept it silently so we don't break authored files.
interface LegacyStateConfigEntry extends StateConfigEntry {
  ambient?: string;
  ambientVolume?: number;
}

export type StateConfig = Record<StateName, StateConfigEntry>;

const DEFAULT_CONFIG: StateConfig = {
  past: { music: 'test_music_1', musicVolume: 0.6 },
  present: { music: 'test_music_5', musicVolume: 0.5 },
};

function migrateEntry(raw: LegacyStateConfigEntry | undefined): StateConfigEntry {
  if (!raw) return {};
  const out: StateConfigEntry = { ...raw };
  // Back-compat: old field names. Don't warn — it's intentional support.
  if (out.music == null && raw.ambient != null) out.music = raw.ambient;
  if (out.musicVolume == null && raw.ambientVolume != null) out.musicVolume = raw.ambientVolume;
  delete (out as LegacyStateConfigEntry).ambient;
  delete (out as LegacyStateConfigEntry).ambientVolume;
  return out;
}

export async function loadStateConfig(url = '/states.json'): Promise<StateConfig> {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) {
      console.warn('[state] no states config at ' + url + '; using defaults');
      return DEFAULT_CONFIG;
    }
    const data = (await res.json()) as Partial<Record<StateName, LegacyStateConfigEntry>>;
    // Shallow merge — any state absent in the file falls back to the default.
    // Keeps existing behavior if someone partially populates states.json.
    return {
      past: { ...DEFAULT_CONFIG.past, ...migrateEntry(data.past) },
      present: { ...DEFAULT_CONFIG.present, ...migrateEntry(data.present) },
    };
  } catch (e) {
    console.warn('[state] states config load failed; using defaults', e);
    return DEFAULT_CONFIG;
  }
}

// Synthesize stateEnter rules from the state config. For each state:
//  - one rule that plays its `music` track on the `music` channel
//  - one rule that stops the `ambient` channel, then starts each heroAudio
//    bed on the `ambient` channel, spatialized to its hero
//
// The two are separate rules (rather than one composite) so a state that
// only authors heroAudio (no music) still updates beds, and vice versa.
//
// Returned rules are PREPENDED to the static RULES in src/interaction/rules.ts
// so the rest of the system (cassettes, boombox stop) keeps working unchanged.
export function buildStateRules(config: StateConfig): InteractionRule[] {
  const rules: InteractionRule[] = [];

  for (const state of ['past', 'present'] as const) {
    const cfg = config[state];

    // ── music ────────────────────────────────────────────────────────────
    if (cfg.music) {
      rules.push({
        match: { event: 'stateEnter', whenState: state },
        actions: [
          {
            kind: 'audio.play',
            id: cfg.music,
            channel: 'music',
            loop: true,
            volume: cfg.musicVolume ?? 0.6,
            fadeIn: 1.0,
            exclusive: true,
            // hero_speaker doesn't exist yet — falls back to un-panned.
            at: { heroId: 'hero_speaker' },
          },
          { kind: 'log', message: `${state} music started (${cfg.music})` },
        ],
      });
    }

    // ── ambient beds (per-hero on/off) ──────────────────────────────────
    // Always emit a stopChannel('ambient') first so beds from the previous
    // state fade out cleanly, even if this state authors no beds (== "off
    // for every hero"). 0.6s crossfade so the swap feels deliberate; if a
    // bed survives state change (same hero, same id), it briefly overlaps
    // itself rather than dropping out.
    const ambientActions: InteractionRule['actions'] = [
      { kind: 'audio.stopChannel', channel: 'ambient', fadeOut: 0.6 },
    ];
    const beds = cfg.heroAudio ?? {};
    for (const [heroId, bed] of Object.entries(beds)) {
      ambientActions.push({
        kind: 'audio.play',
        id: bed.id,
        channel: bed.channel ?? 'ambient',
        loop: bed.loop ?? true,
        volume: bed.volume ?? 0.4,
        fadeIn: 1.0,
        // Spatial: the bed pans/attenuates from the hero's position. If the
        // hero doesn't exist (yet), three.js falls back to un-panned playback.
        at: { heroId },
      });
    }
    if (Object.keys(beds).length > 0) {
      ambientActions.push({
        kind: 'log',
        message: `${state} ambient beds: ${Object.keys(beds).join(', ')}`,
      });
    }
    rules.push({
      match: { event: 'stateEnter', whenState: state },
      actions: ambientActions,
    });
  }

  return rules;
}
