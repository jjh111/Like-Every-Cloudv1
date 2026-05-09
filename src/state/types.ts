export type StateName = 'past' | 'present';

export interface StateContext {
  current: StateName;
  target: StateName;
  progress: number;
}
