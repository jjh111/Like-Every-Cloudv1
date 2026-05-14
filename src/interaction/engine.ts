import type { Object3D } from 'three';
import type { Action, ActionAt, EventInfo, EventName, InteractionRule } from './actions';
import type { AudioManager, PlayAt } from '../audio/audioManager';
import type { StateController } from '../state/stateController';
import type { PointerInteraction } from './pointer';

export interface EngineDeps {
  audio: AudioManager;
  state: StateController;
  setCamera: (name: string) => void;
  pointer: PointerInteraction;
  rules: InteractionRule[];
  /** Look up an Object3D by its hero_id userData. Used to resolve action.at. */
  getObjectByHeroId: (heroId: string) => Object3D | undefined;
}

export class InteractionEngine {
  private firedLoad = false;

  constructor(private deps: EngineDeps) {
    deps.pointer.on('click', (info) => this.fire('click', info));
    deps.pointer.on('hoverIn', (info) => this.fire('hoverIn', info));
    deps.pointer.on('hoverOut', (info) => this.fire('hoverOut', info));
    // State swaps fire 'stateEnter' immediately so music / ambient / lights
    // can cross-fade as the transition starts, not after it finishes.
    deps.state.onTargetChange((newTarget) => {
      this.fire('stateEnter', { state: newTarget });
    });
  }

  /**
   * Arm the load event: first user gesture both resumes the AudioContext and
   * fires any `event: 'load'` rules. Call once after constructing the engine.
   * Awaits resume before firing so source.start() runs against a running
   * context — some browsers (notably Safari) don't reliably play otherwise.
   *
   * Also fires `stateEnter` for the initial state so a rule matching
   * `whenState: <initial>` plays its music on first gesture without the
   * user having to toggle past↔present first.
   */
  arm(): void {
    if (this.firedLoad) return;
    const onFirstGesture = async () => {
      this.firedLoad = true;
      try { await this.deps.audio.resume(); } catch { /* ignored */ }
      this.fire('load', {});
      this.fire('stateEnter', { state: this.deps.state.current });
      window.removeEventListener('pointerdown', onFirstGesture);
    };
    window.addEventListener('pointerdown', onFirstGesture, { once: true });
  }

  private fire(event: EventName, info: EventInfo): void {
    // For stateEnter, whenState filters against the new target (info.state).
    // For everything else, against the controller's current — that's the
    // state the user is actually seeing right now.
    const stateForMatch = info.state ?? this.deps.state.current;
    for (const rule of this.deps.rules) {
      const m = rule.match;
      if (m.event !== event) continue;
      if (m.heroId && m.heroId !== info.heroId) continue;
      if (m.heroIdPrefix && (!info.heroId || !info.heroId.startsWith(m.heroIdPrefix))) continue;
      if (m.whenState && m.whenState !== stateForMatch) continue;
      this.runActions(rule.actions, info);
    }
  }

  private resolveAt(at: ActionAt | undefined, info: EventInfo): PlayAt | undefined {
    if (!at) return undefined;
    if (at.position) return { position: at.position };
    if (at.heroId) {
      const obj = this.deps.getObjectByHeroId(at.heroId);
      if (obj) return { object: obj };
    }
    if (at.heroIdFromUserData) {
      const ref = info.object?.userData[at.heroIdFromUserData];
      if (typeof ref === 'string') {
        const obj = this.deps.getObjectByHeroId(ref);
        if (obj) return { object: obj };
      }
    }
    return undefined;
  }

  private runActions(actions: Action[], info: EventInfo): void {
    for (const a of actions) {
      switch (a.kind) {
        case 'audio.play':
          this.deps.audio.play(a.id, {
            loop: a.loop,
            volume: a.volume,
            fadeIn: a.fadeIn,
            channel: a.channel,
            exclusive: a.exclusive,
            at: this.resolveAt(a.at, info),
          });
          break;
        case 'audio.playFromUserData': {
          const id = info.object?.userData[a.key];
          if (typeof id === 'string') {
            this.deps.audio.play(id, {
              loop: a.loop,
              volume: a.volume,
              fadeIn: a.fadeIn,
              channel: a.channel,
              exclusive: a.exclusive,
              at: this.resolveAt(a.at, info),
            });
          } else {
            console.warn('[engine] audio.playFromUserData: no string at userData.' + a.key);
          }
          break;
        }
        case 'audio.stop':
          this.deps.audio.stop(a.id, a.fadeOut);
          break;
        case 'audio.stopChannel':
          this.deps.audio.stopChannel(a.channel, a.fadeOut);
          break;
        case 'state.set':
          this.deps.state.setTarget(a.target);
          break;
        case 'camera.setMode':
          this.deps.setCamera(a.mode);
          break;
        case 'log':
          console.log('[action]', a.message);
          break;
        case 'callback':
          a.fn(info);
          break;
      }
    }
  }
}
