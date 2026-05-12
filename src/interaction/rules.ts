import type { InteractionRule } from './actions';

// Declarative wiring between scene events and effects. New behavior is added
// here, not by changing the engine. Each rule's `match` is ANDed; multiple
// rules can match the same event and they all fire.
export const RULES: InteractionRule[] = [
  // Shop music: what Annour is playing when the visitor walks in. Plays on
  // the music channel so that clicking a cassette replaces it (exclusive).
  // When real non-musical ambient assets land (street noise, sewing machine),
  // they go on the `ambient` channel where they should coexist with music.
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
      },
      { kind: 'log', message: 'shop music started' },
    ],
  },

  // Any cassette: read its track_id from userData, play on music channel,
  // spatialized to the boombox of the cassette's state (audio_source_hero_id).
  // exclusive: true means clicking a new cassette fades the previous one out.
  {
    match: { event: 'click', heroIdPrefix: 'cassette_' },
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
      { kind: 'log', message: 'cassette inserted' },
    ],
  },

  // Boombox: stops the music channel — like ejecting the tape.
  {
    match: { event: 'click', heroIdPrefix: 'hero_boombox_' },
    actions: [
      { kind: 'audio.stopChannel', channel: 'music', fadeOut: 0.4 },
      { kind: 'log', message: 'boombox stopped music' },
    ],
  },
];
