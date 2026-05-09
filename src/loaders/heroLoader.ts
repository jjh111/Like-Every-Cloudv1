import type { Object3D } from 'three';
import type { GLBLoader } from './glbLoader';
import { tagInteractive, tagState, type StateTag } from '../scene/tagging';

interface HeroEntry {
  id: string;
  url: string;
  state: StateTag;
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: [number, number, number] | number;
}

interface HeroManifest {
  heroes: HeroEntry[];
}

export class HeroLoader {
  constructor(private glb: GLBLoader) {}

  async loadFromManifest(manifestUrl: string): Promise<Object3D[]> {
    const res = await fetch(manifestUrl);
    if (!res.ok) {
      console.warn(`[HeroLoader] no manifest at ${manifestUrl}`);
      return [];
    }
    const manifest = (await res.json()) as HeroManifest;
    const out: Object3D[] = [];
    for (const entry of manifest.heroes ?? []) {
      const obj = await this.glb.load(entry.url);
      if (entry.position) obj.position.set(...entry.position);
      if (entry.rotation) obj.rotation.set(...entry.rotation);
      if (entry.scale != null) {
        if (typeof entry.scale === 'number') obj.scale.setScalar(entry.scale);
        else obj.scale.set(...entry.scale);
      }
      tagState(obj, entry.state);
      tagInteractive(obj, entry.id);
      out.push(obj);
    }
    return out;
  }
}
