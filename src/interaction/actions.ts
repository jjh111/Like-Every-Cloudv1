import type { Object3D } from 'three';
import type { AudioChannel } from '../audio/audioManager';
import type { StateName } from '../state/types';

// Info passed through to every action invocation. Lets actions read the
// clicked object's userData (e.g. cassettes carrying their own track_id).
export interface EventInfo {
  object?: Object3D;
  heroId?: string;
}

// Spatial origin for audio actions. The engine resolves this to a concrete
// PlayAt (object or position) when the action runs.
export interface ActionAt {
  /** A fixed world position. */
  position?: [number, number, number];
  /** Resolve an Object3D by hero_id and track its world position each frame. */
  heroId?: string;
  /** Read a hero_id from the clicked object's userData[key], then track it. */
  heroIdFromUserData?: string;
}

// Actions are the leaves of the interaction system. New action kinds plug in
// here, then handle them in InteractionEngine.runActions.
export type Action =
  | {
      kind: 'audio.play';
      id: string;
      loop?: boolean;
      volume?: number;
      fadeIn?: number;
      channel?: AudioChannel;
      /** If true, stop every other track on the same channel first. */
      exclusive?: boolean;
      /** Spatialize via a panner. */
      at?: ActionAt;
    }
  | {
      // Pull the audio id from the clicked object's userData[key]. Useful for
      // "the cassette decides which track to play" — one rule covers any
      // number of cassettes.
      kind: 'audio.playFromUserData';
      key: string;
      loop?: boolean;
      volume?: number;
      fadeIn?: number;
      channel?: AudioChannel;
      exclusive?: boolean;
      at?: ActionAt;
    }
  | { kind: 'audio.stop'; id: string; fadeOut?: number }
  | { kind: 'audio.stopChannel'; channel: AudioChannel; fadeOut?: number }
  | { kind: 'state.set'; target: StateName }
  | { kind: 'camera.setMode'; mode: string }
  | { kind: 'log'; message: string }
  | { kind: 'callback'; fn: (info: EventInfo) => void };

export type PointerEventName = 'click' | 'hoverIn' | 'hoverOut';

export interface InteractionRule {
  match: {
    event: PointerEventName | 'load';
    /** Exact match against the target's hero_id. */
    heroId?: string;
    /** Prefix match — handy for grouping (e.g. all 'cassette_*'). */
    heroIdPrefix?: string;
    /** Only fires when StateController.current matches. */
    whenState?: StateName;
  };
  actions: Action[];
}
