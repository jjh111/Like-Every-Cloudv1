import type { Object3D } from 'three';
import type { StateName } from '../state/types';

export type StateTag = StateName | 'both';

export const STATE_KEY = 'state';
export const INTERACTIVE_KEY = 'interactive';
export const HERO_ID_KEY = 'hero_id';

export function tagState(obj: Object3D, tag: StateTag): void {
  obj.userData[STATE_KEY] = tag;
}

export function getStateTag(obj: Object3D): StateTag | undefined {
  return obj.userData[STATE_KEY] as StateTag | undefined;
}

export function tagInteractive(obj: Object3D, heroId?: string): void {
  obj.userData[INTERACTIVE_KEY] = true;
  if (heroId) obj.userData[HERO_ID_KEY] = heroId;
}

export function isInteractive(obj: Object3D): boolean {
  return obj.userData[INTERACTIVE_KEY] === true;
}

export function getHeroId(obj: Object3D): string | undefined {
  return obj.userData[HERO_ID_KEY] as string | undefined;
}

// Build the edit-hero dropdown map. Keys are display labels with a state
// suffix (e.g. `hero_speaker (past)`); values are the bare hero ids that
// setEditTarget understands. lil-gui treats object-shaped option lists as
// label→value, so we get readable labels without changing the setter.
//
// (Lives here, not in a UI panel, so it survives the consolidation that
// folded the standalone hero-state panel into the inspector.)
export function buildHeroDropdownMap(heroLookup: Map<string, Object3D>): Record<string, string> {
  const map: Record<string, string> = { '(none)': '(none)' };
  for (const k of Array.from(heroLookup.keys()).sort()) {
    const obj = heroLookup.get(k);
    if (!obj) continue;
    if (k.startsWith('group:')) {
      // Cross-hero group from userData.group_id — surface as a single handle
      // that drags every member together.
      map[`★ ${k.slice('group:'.length)} (group)`] = k;
      continue;
    }
    if (k.endsWith('#all')) {
      // Per-hero #all (multi-placement of one hero) — bulk handle for one
      // hero's instances. Shown as `(set)` to distinguish from cross-hero groups.
      map[`${k} (set)`] = k;
      continue;
    }
    const tag = obj.userData[STATE_KEY] as string | undefined;
    map[tag ? `${k} (${tag})` : k] = k;
  }
  return map;
}
