import type { InteractionRule } from './actions';

// Declarative wiring between scene events and effects. New behavior is added
// here, not by changing the engine. Each rule's `match` is ANDed; multiple
// rules can match the same event and they all fire.
export const RULES: InteractionRule[] = [
  // Shop music: what Annour is playing when the visitor walks in. Plays on
  // the music channel, spatialized at the speaker, so a cassette click can
  // replace it (exclusive) and re-source from the boombox.
  {
    match: { event: 'load' },
    actions: [
      {
        kind: 'audio.play',
        id: 'test_music_1',
        channel: 'music',
        loop: true,
        volume: 0.6,
        fadeIn: 0.5,
        exclusive: true,
        at: { heroId: 'hero_speaker' },
      },
      { kind: 'log', message: 'shop music started (speaker)' },
    ],
  },

  // Any cassette: read its track_id from userData, play on music channel,
  // spatialized to the boombox (audio_source_hero_id userData). exclusive:
  // true means clicking a new cassette fades the previous one out.
  {
    match: { event: 'click', heroIdPrefix: 'hero_cassette' },
    actions: [
      {
        kind: 'audio.playFromUserData',
        key: 'track_id',
        channel: 'music',
        volume: 0.9,
        fadeIn: 0.3,
        exclusive: true,
        at: { heroIdFromUserData: 'audio_source_hero_id' },
      },
      { kind: 'log', message: 'cassette inserted (boombox)' },
    ],
  },

  // Boombox: stops the music channel — like ejecting the tape.
  {
    match: { event: 'click', heroId: 'hero_boombox' },
    actions: [
      { kind: 'audio.stopChannel', channel: 'music', fadeOut: 0.4 },
      { kind: 'log', message: 'boombox stopped music' },
    ],
  },
];
