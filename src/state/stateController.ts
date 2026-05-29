import type { StateContext, StateName } from './types';
import { devBus } from '../debug/devBus';

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

export type TargetChangeListener = (newTarget: StateName, oldTarget: StateName) => void;

export class StateController {
  current: StateName = 'past';
  target: StateName = 'past';
  progress = 1;
  duration = 1;

  private targetListeners: TargetChangeListener[] = [];

  /** Subscribe to target changes. Returns an unsubscribe function. The
   *  InteractionEngine uses this to fire 'stateEnter' rules so music /
   *  ambient / lighting can swap as soon as a new state is selected, before
   *  the transition itself finishes. */
  onTargetChange(fn: TargetChangeListener): () => void {
    this.targetListeners.push(fn);
    return () => {
      const i = this.targetListeners.indexOf(fn);
      if (i >= 0) this.targetListeners.splice(i, 1);
    };
  }

  setTarget(target: StateName): void {
    if (target === this.target) return;
    const oldTarget = this.target;
    this.target = target;
    if (this.duration === 0) {
      this.current = target;
      this.progress = 1;
    } else {
      this.progress = 0;
    }
    for (const fn of this.targetListeners) fn(target, oldTarget);
    devBus.emit('state:target', { target });
  }

  setProgress(p: number): void {
    this.progress = clamp01(p);
    if (this.progress === 1) this.current = this.target;
    devBus.emit('state:progress', { progress: this.progress });
  }

  tick(deltaSeconds: number): void {
    if (this.progress < 1 && this.duration > 0) {
      this.progress = clamp01(this.progress + deltaSeconds / this.duration);
      if (this.progress === 1) this.current = this.target;
    }
  }

  get context(): StateContext {
    return {
      current: this.current,
      target: this.target,
      progress: this.progress,
    };
  }
}
