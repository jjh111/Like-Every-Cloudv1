import type { InteractionRule } from './actions';

// Declarative wiring between scene events and effects. New behavior is added
// here, not by changing the engine. Each rule's `match` is ANDed; multiple
// rules can match the same event and they all fire.
//
// State-aware audio uses the 'stateEnter' event, which fires immediately
// when StateController.setTarget changes. The whenState filter then matches
// against the *new* target (vs. the current display state) so music swaps
// at the start of the transition, not the end.
export const RULES: InteractionRule[] = [
  // PAST shop ambience: warmer track, sourced at the speaker. Fires on
  // first gesture (engine.arm fires stateEnter for the initial state) AND
  // whenever the user returns to past.
  {
    match: { event: 'stateEnter', whenState: 'past' },
    actions: [
      {
        kind: 'audio.play',
        id: 'test_music_1',
        channel: 'music',
        loop: true,
        volume: 0.6,
        fadeIn: 1.0,
        exclusive: true,
        at: { heroId: 'hero_speaker' },
      },
      { kind: 'log', message: 'past ambience started' },
    ],
  },

  // PRESENT shop ambience: cooler / quieter placeholder. Swap track id
  // once the present audio assets land.
  {
    match: { event: 'stateEnter', whenState: 'present' },
    actions: [
      {
        kind: 'audio.play',
        id: 'test_music_5',
        channel: 'music',
        loop: true,
        volume: 0.5,
        fadeIn: 1.0,
        exclusive: true,
        at: { heroId: 'hero_speaker' },
      },
      { kind: 'log', message: 'present ambience started' },
    ],
  },

  // Any cassette: read its track_id from userData, play on music channel,
  // spatialized to the boombox (audio_source_hero_id userData). exclusive:
  // true means clicking a new cassette fades the previous one out. Cassettes
  // currently only exist in past — when present cassettes get authored,
  // they'll match via the prefix unchanged.
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

  // Boombox: stops the music channel — like ejecting the tape. After this,
  // toggling state will start that state's ambience again via stateEnter.
  {
    match: { event: 'click', heroId: 'hero_boombox' },
    actions: [
      { kind: 'audio.stopChannel', channel: 'music', fadeOut: 0.4 },
      { kind: 'log', message: 'boombox stopped music' },
    ],
  },
];
