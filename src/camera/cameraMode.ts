// Swappable camera strategy. Same pluggability pattern as Transition —
// lets us prototype rails, freeform, scripted, etc. without rewiring.
export interface CameraMode {
  init(): void;
  update(dt: number): void;
  dispose(): void;
}
