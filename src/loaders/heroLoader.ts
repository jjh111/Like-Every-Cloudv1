import { Group, type Object3D } from 'three';
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
      // Strip any Blender-baked hero_id / state from descendants so the
      // manifest's entry.id + placement.state are the single source of
      // truth at the hero root. Without the state strip, a state tag baked
      // on an inner mesh wins over a runtime re-tag of the root and the
      // dev-panel "hero state" toggle becomes a no-op.
      base.traverse((child) => {
        if (child === base || !child.userData) return;
        if ('hero_id' in child.userData) delete child.userData.hero_id;
        if ('state' in child.userData) delete child.userData.state;
      });
      const placements = entry.placements ?? [];
      const multi = placements.length > 1;

      // Multi-placement heroes get wrapped in a Group at identity so the dev
      // panel can grab a single handle ("...#all") and translate/rotate the
      // whole row together. The group itself is NOT tagged interactive, so
      // in-game raycasts still resolve to individual children.
      let group: Group | null = null;
      if (multi) {
        group = new Group();
        group.userData[HERO_ID_KEY] = entry.id + '#all';
        out.push(group);
      }

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
        // Unique id per instance — singletons keep entry.id (back-compat),
        // multi-placement uses entry.id#index so each is independently
        // addressable in the edit dropdown and the save logic.
        const instanceId = multi ? `${entry.id}#${i}` : entry.id;
        obj.userData[HERO_ID_KEY] = instanceId;
        // Rule engine uses startsWith(prefix), so "hero_cassette#0" still
        // matches a heroIdPrefix of "hero_cassette".
        if (entry.interactive !== false) tagInteractive(obj, instanceId);
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
        if (group) group.add(obj);
        else out.push(obj);
      }
    }
    return out;
  }
}
