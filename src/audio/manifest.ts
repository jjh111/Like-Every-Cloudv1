// Audio assets to preload at boot. Add tracks here and reference them by id
// in src/interaction/rules.ts (or via cassette userData.track_id). The system
// doesn't care what the source format is as long as the browser can decode it
// (mp3, m4a/aac, ogg, wav, opus).
//
// Naming convention:
//  - `test_music_*` — placeholder music tracks (rotating playlist until the
//    real Chadian/Sudanese music licensing lands)
//  - `sfx_*` — sound effects + ambient beds, encoded by
//    `npm run compress-audio` from `Working - gitignore/Sounds/`
//
// `defaultChannel` is metadata for tooling (the dev panel chooses a sensible
// default when auditioning, future cue layer can fall back to it). The
// runtime can still override via PlayOptions.channel.
export type AudioAssetChannel = 'ambient' | 'music' | 'narration' | 'sfx';

export interface AudioAsset {
  id: string;
  url: string;
  /** Suggested channel — purely advisory; PlayOptions.channel wins at call site. */
  defaultChannel?: AudioAssetChannel;
  /** Hint that this asset is meant to loop seamlessly. The audio manager
   *  doesn't act on this directly — `audio.play({ loop: true })` is still
   *  required at call site — but the dev panel uses it to mark loopable beds. */
  loopable?: boolean;
}

export const AUDIO_ASSETS: AudioAsset[] = [
  // ── placeholder music ──────────────────────────────────────────────────
  { id: 'test_music_1', url: '/audio/test_music_1.m4a', defaultChannel: 'music' },
  { id: 'test_music_2', url: '/audio/test_music_2.mp3', defaultChannel: 'music' },
  { id: 'test_music_3', url: '/audio/test_music_3.m4a', defaultChannel: 'music' },
  { id: 'test_music_4', url: '/audio/test_music_4.m4a', defaultChannel: 'music' },
  { id: 'test_music_5', url: '/audio/test_music_5.mp3', defaultChannel: 'music' },

  // ── fan (interior ambient) ─────────────────────────────────────────────
  { id: 'sfx_fan_oscillation', url: '/audio/sfx/fan/fan_oscillation.m4a', defaultChannel: 'ambient', loopable: true },
  { id: 'sfx_fan_running_1',   url: '/audio/sfx/fan/fan_running_1.m4a',   defaultChannel: 'ambient', loopable: true },
  { id: 'sfx_fan_running_2',   url: '/audio/sfx/fan/fan_running_2.m4a',   defaultChannel: 'ambient', loopable: true },
  { id: 'sfx_fan_running_3',   url: '/audio/sfx/fan/fan_running_3.m4a',   defaultChannel: 'ambient', loopable: true },
  { id: 'sfx_fan_start_1',     url: '/audio/sfx/fan/fan_start_1.m4a',     defaultChannel: 'sfx' },
  { id: 'sfx_fan_start_2',     url: '/audio/sfx/fan/fan_start_2.m4a',     defaultChannel: 'sfx' },
  { id: 'sfx_fan_start_3',     url: '/audio/sfx/fan/fan_start_3.m4a',     defaultChannel: 'sfx' },

  // ── sewing machine (present-state focal bed) ───────────────────────────
  { id: 'sfx_sewing_hum',        url: '/audio/sfx/sewing/sewing_hum.m4a',        defaultChannel: 'ambient', loopable: true },
  { id: 'sfx_sewing_heavy',      url: '/audio/sfx/sewing/sewing_heavy.m4a',      defaultChannel: 'ambient', loopable: true },
  { id: 'sfx_sewing_start_stop', url: '/audio/sfx/sewing/sewing_start_stop.m4a', defaultChannel: 'sfx' },
  { id: 'sfx_sewing_iterations', url: '/audio/sfx/sewing/sewing_iterations.m4a', defaultChannel: 'sfx' },

  // ── generator (exterior bed, low-vol audible inside) ───────────────────
  // NOTE: source files (SND62906 / SND80837) appear to be commercial-library
  // material — confirm license before public ship. Tier 1 task.
  { id: 'sfx_gen_loop',  url: '/audio/sfx/generator/gen_loop.m4a',  defaultChannel: 'ambient', loopable: true },
  { id: 'sfx_gen_motor', url: '/audio/sfx/generator/gen_motor.m4a', defaultChannel: 'ambient', loopable: true },

  // ── motorcycle (one-shot events; not a constant bed) ───────────────────
  { id: 'sfx_moto_passby',  url: '/audio/sfx/motorcycle/moto_passby.m4a',  defaultChannel: 'sfx' },
  { id: 'sfx_moto_arrival', url: '/audio/sfx/motorcycle/moto_arrival.m4a', defaultChannel: 'sfx' },
  { id: 'sfx_moto_start_1', url: '/audio/sfx/motorcycle/moto_start_1.m4a', defaultChannel: 'sfx' },
  { id: 'sfx_moto_start_2', url: '/audio/sfx/motorcycle/moto_start_2.m4a', defaultChannel: 'sfx' },
  { id: 'sfx_moto_rev',     url: '/audio/sfx/motorcycle/moto_rev.m4a',     defaultChannel: 'sfx' },
];
