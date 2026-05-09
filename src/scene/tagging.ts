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
