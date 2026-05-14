import type { InteractionRule } from '../interaction/actions';
import type { StateName } from './types';

// Per-state runtime configuration. Today: an ambient music track + its
// volume that plays whenever the state becomes the target. Future fields
// can live alongside (atmosphere preset name, sky tint, narration sting,
// post-process LUT, etc.) without changing the rules pipeline.
export interface StateConfigEntry {
  /** Audio asset id to play on the 'music' channel when entering this state.
   *  Omit to leave music alone (e.g. a contemplative state with no track). */
  ambient?: string;
  /** Per-state volume. Defaults to 0.6 if ambient is set but volume isn't. */
  ambientVolume?: number;
}

export type StateConfig = Record<StateName, StateConfigEntry>;

const DEFAULT_CONFIG: StateConfig = {
  past: { ambient: 'test_music_1', ambientVolume: 0.6 },
  present: { ambient: 'test_music_5', ambientVolume: 0.5 },
};

export async function loadStateConfig(url = '/states.json'): Promise<StateConfig> {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) {
      console.warn('[state] no states config at ' + url + '; using defaults');
      return DEFAULT_CONFIG;
    }
    const data = (await res.json()) as Partial<StateConfig>;
    // Shallow merge — any state absent in the file falls back to the default.
    // Keeps existing behavior if someone partially populates states.json.
    return {
      past: { ...DEFAULT_CONFIG.past, ...(data.past ?? {}) },
      present: { ...DEFAULT_CONFIG.present, ...(data.present ?? {}) },
    };
  } catch (e) {
    console.warn('[state] states config load failed; using defaults', e);
    return DEFAULT_CONFIG;
  }
}

// Synthesize stateEnter rules from the state config. One rule per state that
// has an ambient track. The hero_speaker is the spatial anchor — same source
// the previous hardcoded rules used; if it ever moves into a state where the
// speaker doesn't exist, three.js spatial fallback just plays it un-panned.
//
// Returned rules are PREPENDED to the static RULES so the rest of the
// system (cassettes, boombox stop) keeps working unchanged.
export function buildStateRules(config: StateConfig): InteractionRule[] {
  const rules: InteractionRule[] = [];
  for (const state of ['past', 'present'] as const) {
    const cfg = config[state];
    if (!cfg.ambient) continue;
    rules.push({
      match: { event: 'stateEnter', whenState: state },
      actions: [
        {
          kind: 'audio.play',
          id: cfg.ambient,
          channel: 'music',
          loop: true,
          volume: cfg.ambientVolume ?? 0.6,
          fadeIn: 1.0,
          exclusive: true,
          at: { heroId: 'hero_speaker' },
        },
        { kind: 'log', message: `${state} ambience started (${cfg.ambient})` },
      ],
    });
  }
  return rules;
}
