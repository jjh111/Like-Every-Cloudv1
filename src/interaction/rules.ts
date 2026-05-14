import type { InteractionRule } from './actions';

// Declarative wiring between scene events and effects. New behavior is added
// here, not by changing the engine. Each rule's `match` is ANDed; multiple
// rules can match the same event and they all fire.
//
// Per-state ambient music is NO LONGER a hardcoded rule — it's data-driven
// from public/states.json via state/stateConfig.ts (buildStateRules). The
// app prepends those generated rules to this static list at startup, so
// changing the music for past/present doesn't need a code edit anymore.
export const RULES: InteractionRule[] = [
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
