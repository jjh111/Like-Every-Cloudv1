import type { Object3D } from 'three';
import type { GLBLoader } from './glbLoader';
import { HERO_ID_KEY, tagInteractive, tagState, type StateTag } from '../scene/tagging';

// Schema:
//   {
//     "heroes": [
//       {
//         "id": "hero_sewing_machine",
//         "url": "/heroes/hero_sewing_machine.glb",
//         "interactive": true,           // optional, defaults to true
//         "placements": [                // one entry → one instance in the scene
//           { "state": "past",    "position": [-2.5, 1.4, -1.2] },
//           { "state": "present", "position": [ 0.0, 0.9, -1.8] }
//         ]
//       }
//     ]
//   }
//
// Same hero can be placed at multiple positions across states. material_variant
// references a KHR_materials_variants name baked into the glb — applied when
// the runtime's variant-switching support lands (currently stashed on userData
// for the caller to act on).
export interface HeroPlacement {
  state: StateTag;
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: [number, number, number] | number;
  /** KHR_materials_variants slot name to apply at this placement. */
  material_variant?: string;
  /** Override initial visibility (default true). */
  visible?: boolean;
  /** Extra userData merged onto the placed instance — e.g. per-cassette track_id. */
  userData?: Record<string, unknown>;
}

export interface HeroEntry {
  id: string;
  url: string;
  /** Defaults to true — false for static decorative heroes. */
  interactive?: boolean;
  placements: HeroPlacement[];
}

interface HeroManifest {
  heroes: HeroEntry[];
}

export class HeroLoader {
  constructor(private glb: GLBLoader) {}

  async loadFromManifest(manifestUrl: string): Promise<Object3D[]> {
    const res = await fetch(manifestUrl);
    if (!res.ok) {
      console.warn('[HeroLoader] no manifest at ' + manifestUrl);
      return [];
    }
    const manifest = (await res.json()) as HeroManifest;
    const out: Object3D[] = [];
    for (const entry of manifest.heroes ?? []) {
      const base = await this.glb.load(entry.url);
      // Strip any Blender-baked hero_id from inside the glb so the manifest's
      // entry.id is the single source of truth at the top of each placed hero.
      // Without this, an inner mesh tagged in Blender (e.g. "hero_boomboxold")
      // shows up alongside the manifest id (e.g. "hero_boombox").
      base.traverse((child) => {
        if (child !== base && child.userData && 'hero_id' in child.userData) {
          delete child.userData.hero_id;
        }
      });
      const placements = entry.placements ?? [];
      for (let i = 0; i < placements.length; i++) {
        const placement = placements[i];
        // Reuse the base node for the first placement, clone for additional ones.
        // .clone(true) deep-copies the node hierarchy but shares geometries and
        // materials by default — exactly what we want for multi-state placement.
        const obj = i === 0 ? base : base.clone(true);
        if (placement.position) obj.position.set(...placement.position);
        if (placement.rotation) obj.rotation.set(...placement.rotation);
        if (placement.scale != null) {
          if (typeof placement.scale === 'number') obj.scale.setScalar(placement.scale);
          else obj.scale.set(...placement.scale);
        }
        if (placement.visible === false) obj.visible = false;
        tagState(obj, placement.state);
        // Always tag the hero_id so heroLookup + edit-mode + scene info can
        // find this object. The interactive flag only controls click-eligibility.
        obj.userData[HERO_ID_KEY] = entry.id;
        if (entry.interactive !== false) tagInteractive(obj, entry.id);
        if (placement.material_variant) {
          // Stashed for later — variant switching needs the GLTFLoader's
          // KHR_materials_variants hook to be wired through. Cf. README.
          obj.userData.material_variant = placement.material_variant;
        }
        if (placement.userData) {
          for (const [k, v] of Object.entries(placement.userData)) {
            obj.userData[k] = v;
          }
        }
        out.push(obj);
      }
    }
    return out;
  }
}
