import { Raycaster, Vector2, type Camera, type Object3D } from 'three';
import { getHeroId, isInteractive } from '../scene/tagging';
import type { PointerEventName } from './actions';

export interface PointerEventInfo {
  object: Object3D;
  heroId?: string;
}

export type PointerEventHandler = (info: PointerEventInfo) => void;

export class PointerInteraction {
  private raycaster = new Raycaster();
  private pointer = new Vector2();
  private hovered: Object3D | null = null;

  private listeners: Record<PointerEventName, PointerEventHandler[]> = {
    click: [],
    hoverIn: [],
    hoverOut: [],
  };

  constructor(
    private domElement: HTMLElement,
    private camera: Camera,
    private root: Object3D,
  ) {}

  /** Subscribe. Returns an unsubscribe function. */
  on(event: PointerEventName, handler: PointerEventHandler): () => void {
    this.listeners[event].push(handler);
    return () => {
      const arr = this.listeners[event];
      const i = arr.indexOf(handler);
      if (i >= 0) arr.splice(i, 1);
    };
  }

  attach(): void {
    this.domElement.addEventListener('pointermove', this.handleMove);
    this.domElement.addEventListener('click', this.handleClick);
  }

  detach(): void {
    this.domElement.removeEventListener('pointermove', this.handleMove);
    this.domElement.removeEventListener('click', this.handleClick);
  }

  private setPointerFromEvent(e: PointerEvent | MouseEvent) {
    const rect = this.domElement.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  }

  private firstInteractiveHit(): Object3D | null {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObject(this.root, true);
    for (const hit of hits) {
      let obj: Object3D | null = hit.object;
      while (obj) {
        if (isInteractive(obj)) return obj;
        obj = obj.parent;
      }
    }
    return null;
  }

  private emit(event: PointerEventName, info: PointerEventInfo) {
    for (const fn of this.listeners[event]) fn(info);
  }

  private handleMove = (e: PointerEvent) => {
    this.setPointerFromEvent(e);
    const hit = this.firstInteractiveHit();
    if (hit !== this.hovered) {
      if (this.hovered) {
        this.emit('hoverOut', { object: this.hovered, heroId: getHeroId(this.hovered) });
      }
      this.hovered = hit;
      this.domElement.style.cursor = hit ? 'pointer' : 'default';
      if (hit) {
        this.emit('hoverIn', { object: hit, heroId: getHeroId(hit) });
      }
    }
  };

  private handleClick = (e: MouseEvent) => {
    this.setPointerFromEvent(e);
    const hit = this.firstInteractiveHit();
    if (hit) this.emit('click', { object: hit, heroId: getHeroId(hit) });
  };
}
