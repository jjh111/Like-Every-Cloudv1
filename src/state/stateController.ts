import type { StateContext, StateName } from './types';

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

export class StateController {
  current: StateName = 'past';
  target: StateName = 'past';
  progress = 1;
  duration = 1;

  setTarget(target: StateName): void {
    if (target === this.target) return;
    this.target = target;
    if (this.duration === 0) {
      this.current = target;
      this.progress = 1;
    } else {
      this.progress = 0;
    }
  }

  setProgress(p: number): void {
    this.progress = clamp01(p);
    if (this.progress === 1) this.current = this.target;
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
