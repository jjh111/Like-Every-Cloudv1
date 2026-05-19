// Web Audio API wrapper with named channels + optional HRTF spatialization.
//
// Pipeline per playing source:
//   buffer -> ownGain -> [panner if spatial] -> channelGain -> master -> destination
//
// - Channels (ambient/music/narration/sfx) each have a gain node, so per-channel
//   volume is independent of master and of individual track volumes.
// - One playing instance per (id, channel). The same buffer can play
//   simultaneously on different channels — useful when ambient and music
//   happen to reference the same underlying audio asset.
// - opts.exclusive: fades out every other track on the same channel before
//   starting (single-cassette-at-a-time semantics).
// - opts.at: enables spatialization. Panner uses HRTF, inverse distance,
//   refDistance 2m, rolloffFactor 1. When `at.object` is supplied, the panner
//   position updates each frame via syncSpatial(camera).
// - stopChannel(channel) halts everything on a channel.
// - Boots muted (master gain = 0). setMuted(false) restores the preferred
//   master level, which persists across reloads in sessionStorage (along with
//   each channel's volume). The muted flag itself does NOT persist —
//   every page load starts muted.

import { Vector3, type Camera, type Object3D } from 'three';

export type AudioChannel = 'ambient' | 'music' | 'narration' | 'sfx';

export interface PlayAt {
  /** Track an Object3D's world position. */
  object?: Object3D;
  /** Fixed world position [x, y, z]. */
  position?: [number, number, number];
}

export interface PlayOptions {
  loop?: boolean;
  volume?: number;
  fadeIn?: number;
  channel?: AudioChannel;
  /** Fade out other tracks on the same channel before starting. */
  exclusive?: boolean;
  /** Spatialize via PannerNode. */
  at?: PlayAt;
}

interface PlayingEntry {
  id: string;
  channel: AudioChannel;
  source: AudioBufferSourceNode;
  gain: GainNode;
  panner?: PannerNode;
  trackedObject?: Object3D;
}

const SS_PREFIX = 'lec_audio_';
const _pos = new Vector3();
const _fwd = new Vector3();
const _up = new Vector3();

// Fast fade-out on exclusive-replace so the swap doesn't sound like two
// tracks audible simultaneously.
const EXCLUSIVE_FADE_OUT = 0.05;

function loadStored(key: string): number | null {
  try {
    const v = sessionStorage.getItem(SS_PREFIX + key);
    if (v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function saveStored(key: string, value: number): void {
  try { sessionStorage.setItem(SS_PREFIX + key, String(value)); } catch { /* ignored */ }
}

function keyOf(id: string, channel: AudioChannel): string {
  return id + '|' + channel;
}

export class AudioManager {
  private ctx: AudioContext;
  private master: GainNode;
  private channels: Record<AudioChannel, GainNode>;
  private buffers: Map<string, AudioBuffer> = new Map();
  /** Keyed by (id, channel) so the same id can play on multiple channels. */
  private playing: Map<string, PlayingEntry> = new Map();

  private _muted = true;
  private _preferredMaster: number;

  constructor() {
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);

    // Discard a near-zero stored value — if a previous session left this at 0,
    // we'd unmute into silence and feel broken.
    const storedMaster = loadStored('master');
    this._preferredMaster = (storedMaster != null && storedMaster >= 0.05) ? storedMaster : 0.8;
    this.master.gain.value = 0; // start muted regardless of stored level

    this.channels = {
      ambient: this.makeChannel('ambient', 0.5),
      music: this.makeChannel('music', 0.8),
      narration: this.makeChannel('narration', 1),
      sfx: this.makeChannel('sfx', 0.8),
    };
  }

  private makeChannel(name: AudioChannel, defaultGain: number): GainNode {
    const g = this.ctx.createGain();
    g.gain.value = loadStored('channel_' + name) ?? defaultGain;
    g.connect(this.master);
    return g;
  }

  get contextState(): AudioContextState {
    return this.ctx.state;
  }

  get muted(): boolean {
    return this._muted;
  }

  setMuted(muted: boolean): void {
    this._muted = muted;
    this.master.gain.value = muted ? 0 : this._preferredMaster;
  }

  async resume(): Promise<void> {
    if (this.ctx.state === 'suspended') await this.ctx.resume();
  }

  async load(id: string, url: string): Promise<void> {
    if (this.buffers.has(id)) return;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const ab = await res.arrayBuffer();
      const buf = await this.ctx.decodeAudioData(ab);
      this.buffers.set(id, buf);
    } catch (err) {
      console.warn('[audio] failed to load', id, url, err);
    }
  }

  play(id: string, opts: PlayOptions = {}): void {
    const buf = this.buffers.get(id);
    if (!buf) {
      console.warn('[audio] not loaded:', id);
      return;
    }
    const channel: AudioChannel = opts.channel ?? 'sfx';

    if (opts.exclusive) {
      for (const [k, entry] of [...this.playing]) {
        if (entry.channel === channel && entry.id !== id) {
          this.stopEntry(k, EXCLUSIVE_FADE_OUT);
        }
      }
    }

    const key = keyOf(id, channel);
    this.stopEntry(key);

    const source = this.ctx.createBufferSource();
    source.buffer = buf;
    source.loop = !!opts.loop;
    const gain = this.ctx.createGain();
    source.connect(gain);

    let panner: PannerNode | undefined;
    let trackedObject: Object3D | undefined;
    if (opts.at && (opts.at.object || opts.at.position)) {
      panner = this.createPanner(opts.at);
      gain.connect(panner);
      panner.connect(this.channels[channel]);
      trackedObject = opts.at.object;
    } else {
      gain.connect(this.channels[channel]);
    }

    const target = opts.volume ?? 1;
    if (opts.fadeIn && opts.fadeIn > 0) {
      gain.gain.value = 0;
      gain.gain.linearRampToValueAtTime(target, this.ctx.currentTime + opts.fadeIn);
    } else {
      gain.gain.value = target;
    }
    source.start();
    source.onended = () => {
      if (this.playing.get(key)?.source === source) this.playing.delete(key);
    };
    this.playing.set(key, { id, channel, source, gain, panner, trackedObject });
  }

  private createPanner(at: PlayAt): PannerNode {
    const p = this.ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = 2;
    p.rolloffFactor = 1;

    let x = 0, y = 0, z = 0;
    if (at.object) {
      at.object.getWorldPosition(_pos);
      x = _pos.x; y = _pos.y; z = _pos.z;
    } else if (at.position) {
      [x, y, z] = at.position;
    }
    this.setPannerPos(p, x, y, z);
    return p;
  }

  private setPannerPos(p: PannerNode, x: number, y: number, z: number): void {
    if (p.positionX) {
      p.positionX.value = x;
      p.positionY.value = y;
      p.positionZ.value = z;
    } else {
      (p as PannerNode & { setPosition: (x: number, y: number, z: number) => void })
        .setPosition(x, y, z);
    }
  }

  /** Sync listener orientation to camera + refresh tracked-object panner positions. Call from the render tick. */
  syncSpatial(camera: Camera): void {
    const l = this.ctx.listener;
    camera.getWorldPosition(_pos);
    _fwd.set(0, 0, -1).applyQuaternion(camera.quaternion);
    _up.set(0, 1, 0).applyQuaternion(camera.quaternion);

    if (l.positionX) {
      l.positionX.value = _pos.x;
      l.positionY.value = _pos.y;
      l.positionZ.value = _pos.z;
      l.forwardX.value = _fwd.x;
      l.forwardY.value = _fwd.y;
      l.forwardZ.value = _fwd.z;
      l.upX.value = _up.x;
      l.upY.value = _up.y;
      l.upZ.value = _up.z;
    } else {
      const ll = l as AudioListener & {
        setPosition: (x: number, y: number, z: number) => void;
        setOrientation: (
          fx: number, fy: number, fz: number,
          ux: number, uy: number, uz: number,
        ) => void;
      };
      ll.setPosition(_pos.x, _pos.y, _pos.z);
      ll.setOrientation(_fwd.x, _fwd.y, _fwd.z, _up.x, _up.y, _up.z);
    }

    for (const entry of this.playing.values()) {
      if (entry.panner && entry.trackedObject) {
        entry.trackedObject.getWorldPosition(_pos);
        this.setPannerPos(entry.panner, _pos.x, _pos.y, _pos.z);
      }
    }
  }

  private stopEntry(key: string, fadeOut = 0): void {
    const entry = this.playing.get(key);
    if (!entry) return;
    if (fadeOut > 0) {
      entry.gain.gain.cancelScheduledValues(this.ctx.currentTime);
      entry.gain.gain.setValueAtTime(entry.gain.gain.value, this.ctx.currentTime);
      entry.gain.gain.linearRampToValueAtTime(0, this.ctx.currentTime + fadeOut);
      const src = entry.source;
      setTimeout(() => {
        try { src.stop(); } catch { /* already stopped */ }
      }, fadeOut * 1000);
    } else {
      try { entry.source.stop(); } catch { /* already stopped */ }
    }
    this.playing.delete(key);
  }

  /** Stop every playing instance with this id, across channels. */
  stop(id: string, fadeOut = 0): void {
    for (const [k, entry] of [...this.playing]) {
      if (entry.id === id) this.stopEntry(k, fadeOut);
    }
  }

  stopChannel(channel: AudioChannel, fadeOut = 0): void {
    for (const [k, entry] of [...this.playing]) {
      if (entry.channel === channel) this.stopEntry(k, fadeOut);
    }
  }

  isChannelActive(channel: AudioChannel): boolean {
    for (const entry of this.playing.values()) {
      if (entry.channel === channel) return true;
    }
    return false;
  }

  isPlaying(id: string): boolean {
    for (const entry of this.playing.values()) {
      if (entry.id === id) return true;
    }
    return false;
  }

  /** Snapshot of every active source as {id, channel}. Order is not stable. */
  listPlaying(): { id: string; channel: AudioChannel }[] {
    const out: { id: string; channel: AudioChannel }[] = [];
    for (const entry of this.playing.values()) {
      out.push({ id: entry.id, channel: entry.channel });
    }
    return out;
  }

  /** Set the live gain of a specific playing entry. No-op if (id, channel)
   *  isn't currently playing. Used by the hero audio mixer to drag a
   *  bed's volume without interrupting playback. Smooths to the target
   *  over 80ms so slider drags don't zipper. */
  setEntryVolume(id: string, channel: AudioChannel, v: number): void {
    const entry = this.playing.get(keyOf(id, channel));
    if (!entry) return;
    entry.gain.gain.cancelScheduledValues(this.ctx.currentTime);
    entry.gain.gain.setValueAtTime(entry.gain.gain.value, this.ctx.currentTime);
    entry.gain.gain.linearRampToValueAtTime(v, this.ctx.currentTime + 0.08);
  }

  /** Read the current target gain of a playing entry, or undefined if not playing. */
  getEntryVolume(id: string, channel: AudioChannel): number | undefined {
    const entry = this.playing.get(keyOf(id, channel));
    return entry?.gain.gain.value;
  }

  /** True if the (id, channel) tuple is currently playing. Lets the mixer
   *  reflect actual playback state on each tick, including external mutations
   *  (state-change rules, explicit stop calls). */
  isEntryPlaying(id: string, channel: AudioChannel): boolean {
    return this.playing.has(keyOf(id, channel));
  }

  getChannelVolume(channel: AudioChannel): number {
    return this.channels[channel].gain.value;
  }

  setChannelVolume(channel: AudioChannel, v: number): void {
    this.channels[channel].gain.value = v;
    saveStored('channel_' + channel, v);
  }

  getMasterVolume(): number {
    return this._preferredMaster;
  }

  setMasterVolume(v: number): void {
    this._preferredMaster = v;
    saveStored('master', v);
    if (!this._muted) this.master.gain.value = v;
  }
}
