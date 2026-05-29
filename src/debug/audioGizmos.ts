import {
  ArrowHelper,
  Color,
  type Group,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  Vector3,
  type Camera,
} from 'three';
import type { AudioChannel, AudioManager } from '../audio/audioManager';
import { devBus } from './devBus';

// Audio gizmos — translucent spheres at each playing PannerNode, plus a
// listener arrow at the camera so the dev can see what the spatializer
// "hears" and from where.
//
// One sphere per (id, channel). Color encodes channel:
//   ambient   = soft green     (#6acf91)
//   music     = cyan           (#4fc3f7)
//   narration = warm yellow    (#ffd87c)
//   sfx       = magenta        (#ff7eb6)
//
// The sphere radius matches the panner's refDistance (2 m by default) so
// the dev can see the "loud zone" the spatializer treats as ~unit gain.
// Beyond that radius, gain falls off with rolloffFactor (1 by default).
//
// Add/remove is event-driven (devBus 'audio:play'/'audio:stop') so the
// per-frame cost is just N world-position queries. Spheres themselves
// opt out of raycast + hover + wallCull via userData.

const CHANNEL_COLORS: Record<AudioChannel, number> = {
  ambient: 0x6acf91,
  music: 0x4fc3f7,
  narration: 0xffd87c,
  sfx: 0xff7eb6,
};

const REF_DISTANCE = 2; // mirrors AudioManager.createPanner

interface SourceVisual {
  id: string;
  channel: AudioChannel;
  mesh: Mesh;
}

function keyOf(id: string, channel: string): string {
  return id + '|' + channel;
}

export class AudioGizmos {
  private group: Group;
  private audio: AudioManager;
  private sources: Map<string, SourceVisual> = new Map();
  private listenerArrow: ArrowHelper;
  private unsubs: Array<() => void> = [];
  private scratch = new Vector3();
  private scratchFwd = new Vector3();

  constructor(parent: Group, audio: AudioManager) {
    this.group = parent;
    this.audio = audio;

    // Listener arrow — points along camera.forward each tick, anchored at
    // camera position (offset slightly forward so it doesn't sit inside
    // the near plane). Length 1.2 m, soft cyan to match the "cyan accent"
    // dev palette.
    this.listenerArrow = new ArrowHelper(
      new Vector3(0, 0, -1),
      new Vector3(),
      1.2,
      0x66ffe6,
      0.28,
      0.16,
    );
    this.listenerArrow.userData.no_cull = true;
    this.listenerArrow.userData.raycastIgnore = true;
    this.listenerArrow.userData.no_outline = true;
    this.listenerArrow.userData.no_highlight = true;
    this.group.add(this.listenerArrow);

    // Catch up: any audio sources already playing when we mount.
    for (const e of audio.listPlaying()) this.add(e.id, e.channel);

    this.unsubs.push(devBus.on('audio:play', (p) => this.add(p.id, p.channel as AudioChannel)));
    this.unsubs.push(devBus.on('audio:stop', (p) => this.remove(p.id, p.channel as AudioChannel)));
  }

  /** Per-frame: position listener arrow + each source sphere. Camera is
   *  passed in so we don't import three's main camera handle. */
  update(camera: Camera): void {
    if (!this.group.visible) return;
    camera.getWorldPosition(this.scratch);
    this.scratchFwd.set(0, 0, -1).applyQuaternion(camera.quaternion);
    this.listenerArrow.position.copy(this.scratch);
    this.listenerArrow.setDirection(this.scratchFwd);

    for (const v of this.sources.values()) {
      if (this.audio.getEntryWorldPosition(v.id, v.channel, this.scratch)) {
        v.mesh.position.copy(this.scratch);
        v.mesh.visible = true;
        // Pulse opacity with current gain — a muted source still has its
        // sphere visible but dimmer, which helps the dev distinguish
        // "playing but inaudible" from "not playing".
        const g = this.audio.getEntryVolume(v.id, v.channel) ?? 1;
        const mat = v.mesh.material as MeshBasicMaterial;
        mat.opacity = 0.18 + 0.32 * Math.min(1, g);
      } else {
        // Non-spatial source (no panner) — hide the sphere; the inspector
        // list still surfaces it as a non-spatialized row.
        v.mesh.visible = false;
      }
    }
  }

  dispose(): void {
    for (const fn of this.unsubs) fn();
    this.unsubs = [];
    for (const v of this.sources.values()) {
      this.group.remove(v.mesh);
      v.mesh.geometry.dispose();
      (v.mesh.material as MeshBasicMaterial).dispose();
    }
    this.sources.clear();
    this.group.remove(this.listenerArrow);
  }

  // ── private ────────────────────────────────────────────────────────────
  private add(id: string, channel: AudioChannel): void {
    const k = keyOf(id, channel);
    if (this.sources.has(k)) return;
    const geom = new IcosahedronGeometry(REF_DISTANCE, 2);
    const mat = new MeshBasicMaterial({
      color: new Color(CHANNEL_COLORS[channel] ?? 0xffffff),
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
      wireframe: true,
    });
    const mesh = new Mesh(geom, mat);
    mesh.userData.no_cull = true;
    mesh.userData.raycastIgnore = true;
    mesh.userData.no_outline = true;
    mesh.userData.no_highlight = true;
    mesh.renderOrder = 990;
    this.group.add(mesh);
    this.sources.set(k, { id, channel, mesh });
  }
  private remove(id: string, channel: AudioChannel): void {
    const k = keyOf(id, channel);
    const v = this.sources.get(k);
    if (!v) return;
    this.group.remove(v.mesh);
    v.mesh.geometry.dispose();
    (v.mesh.material as MeshBasicMaterial).dispose();
    this.sources.delete(k);
  }
}
