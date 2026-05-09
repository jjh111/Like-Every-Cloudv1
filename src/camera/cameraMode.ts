// Swappable camera strategy. Same pluggability pattern as Transition —
// lets us prototype rails, freeform, scripted, etc. without rewiring.
export interface TunableSpec {
  /** Property key on the target object. */
  key: string;
  /** Label shown in the dev panel. */
  label: string;
  min: number;
  max: number;
  step: number;
}

export interface Tunables {
  /** Object whose properties are the tunables. The dev panel binds directly. */
  target: object;
  specs: TunableSpec[];
}

export interface CameraMode {
  init(): void;
  update(dt: number): void;
  dispose(): void;
  /** Mutable parameters surfaced in the dev panel. Empty specs array if none. */
  getTunables(): Tunables;
}
