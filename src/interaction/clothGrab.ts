import { Plane, Raycaster, Vector2, Vector3, type Camera } from 'three';
import type { ClothPatch } from '../scene/clothPatch';

// Pointer-driven grab interaction for ClothPatch instances. Works with mouse
// + touch via PointerEvent.
//
// Lifecycle per grab:
//
//   pointerdown on cloth ──►  raycast → hit point + cloth → find closest
//                              particle, build a camera-facing drag plane
//                              through that point, pin the particle, mute
//                              OrbitControls
//
//   pointermove          ──►  raycast against the drag plane only (cheap),
//                              moveGrab(intersect) — the verlet sim drags
//                              neighbors along through the constraint pass
//
//   pointerup / leave    ──►  releaseGrab, restore OrbitControls
//
// Pointer event capture: we attach a capturing-phase pointerdown listener
// so we see the event BEFORE OrbitControls. On hit we stopPropagation() so
// the orbiter doesn't start a camera drag underneath us. On miss we don't
// touch the event — the orbiter takes over normally.
//
// `controlsToggle` is an out-parameter: anything that exposes `.enabled`
// (OrbitControls, MapControls, custom rigs) works.

export interface ClothGrabDeps {
  camera: Camera;
  /** Canvas element — the same one passed to OrbitControls. */
  domElement: HTMLElement;
  /** Anything with a boolean `enabled` field; muted during active grab. */
  controlsToggle?: { enabled: boolean };
}

interface ActiveGrab {
  cloth: ClothPatch;
  particle: number;
  /** Plane perpendicular to the camera at the original hit's depth. The
   *  cursor maps to a point on this plane each frame so the drag stays at
   *  consistent depth regardless of where the camera was looking. */
  plane: Plane;
  pointerId: number;
}

export class ClothGrabController {
  private cloths: ClothPatch[] = [];
  private active: ActiveGrab | null = null;
  private raycaster = new Raycaster();
  private ndc = new Vector2();
  private hit = new Vector3();
  private camNormal = new Vector3();
  private moveHandler: ((e: PointerEvent) => void) | null = null;
  private upHandler: ((e: PointerEvent) => void) | null = null;
  private downHandler: ((e: PointerEvent) => void) | null = null;

  constructor(private deps: ClothGrabDeps) {}

  /** Register a cloth for grab interaction. Order doesn't matter — the
   *  raycaster picks the nearest hit across all registered cloths. */
  register(cloth: ClothPatch): void {
    if (this.cloths.indexOf(cloth) < 0) this.cloths.push(cloth);
  }

  unregister(cloth: ClothPatch): void {
    const i = this.cloths.indexOf(cloth);
    if (i >= 0) this.cloths.splice(i, 1);
  }

  attach(): void {
    if (this.downHandler) return;
    this.downHandler = (e: PointerEvent): void => this.handleDown(e);
    // Capture-phase so we get this BEFORE OrbitControls. stopPropagation()
    // on a hit prevents the orbiter from starting a camera drag.
    this.deps.domElement.addEventListener('pointerdown', this.downHandler, { capture: true });
  }

  detach(): void {
    if (this.downHandler) {
      this.deps.domElement.removeEventListener('pointerdown', this.downHandler, { capture: true });
      this.downHandler = null;
    }
    this.endGrab();
  }

  // ── private ────────────────────────────────────────────────────────────

  private setNdc(e: PointerEvent): void {
    const rect = this.deps.domElement.getBoundingClientRect();
    this.ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  }

  private handleDown(e: PointerEvent): void {
    if (this.active) return; // ignore secondary touches mid-grab
    // Ignore secondary mouse buttons; canvas drag is a left-click affair.
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (this.cloths.length === 0) return;

    this.setNdc(e);
    this.raycaster.setFromCamera(this.ndc, this.deps.camera);

    // Find the nearest cloth hit across all registered cloths. Each cloth's
    // mesh is open / double-sided so we get hits from both faces.
    let nearest: { cloth: ClothPatch; point: Vector3; distance: number } | null = null;
    for (const cloth of this.cloths) {
      const hits = this.raycaster.intersectObject(cloth.mesh, true);
      if (hits.length === 0) continue;
      const h = hits[0];
      if (!nearest || h.distance < nearest.distance) {
        nearest = { cloth: cloth, point: h.point.clone(), distance: h.distance };
      }
    }
    if (!nearest) return;

    // Suppress event chain: orbit, hero-click rules, hover label, etc.
    e.stopPropagation();
    // Don't preventDefault — we still want browser pointer capture to fire
    // pointermove on the document even if the cursor leaves the canvas.

    const particle = nearest.cloth.grabAt(nearest.point);
    if (particle < 0) return;

    // Drag plane: perpendicular to the camera through the hit point. Means
    // dragging the cursor moves the grabbed point in the screen plane,
    // exactly what fingers expect.
    this.deps.camera.getWorldDirection(this.camNormal).negate();
    const plane = new Plane().setFromNormalAndCoplanarPoint(this.camNormal, nearest.point);

    this.active = { cloth: nearest.cloth, particle, plane, pointerId: e.pointerId };
    if (this.deps.controlsToggle) this.deps.controlsToggle.enabled = false;

    // Switch to document-level listeners so a cursor that leaves the canvas
    // still drives the grab — important for fast drags off-screen.
    try {
      this.deps.domElement.setPointerCapture(e.pointerId);
    } catch {
      /* setPointerCapture can throw if the element loses focus; safe to ignore */
    }

    this.moveHandler = (ev: PointerEvent): void => this.handleMove(ev);
    this.upHandler = (ev: PointerEvent): void => this.handleUp(ev);
    this.deps.domElement.addEventListener('pointermove', this.moveHandler);
    this.deps.domElement.addEventListener('pointerup', this.upHandler);
    this.deps.domElement.addEventListener('pointercancel', this.upHandler);
    this.deps.domElement.addEventListener('lostpointercapture', this.upHandler);
  }

  private handleMove(e: PointerEvent): void {
    if (!this.active || e.pointerId !== this.active.pointerId) return;
    this.setNdc(e);
    this.raycaster.setFromCamera(this.ndc, this.deps.camera);
    if (!this.raycaster.ray.intersectPlane(this.active.plane, this.hit)) return;
    this.active.cloth.moveGrab(this.hit);
  }

  private handleUp(e: PointerEvent): void {
    if (!this.active || e.pointerId !== this.active.pointerId) return;
    this.endGrab();
  }

  private endGrab(): void {
    if (!this.active) return;
    this.active.cloth.releaseGrab();
    if (this.deps.controlsToggle) this.deps.controlsToggle.enabled = true;
    try {
      this.deps.domElement.releasePointerCapture(this.active.pointerId);
    } catch {
      /* may have already been released */
    }
    if (this.moveHandler) {
      this.deps.domElement.removeEventListener('pointermove', this.moveHandler);
      this.moveHandler = null;
    }
    if (this.upHandler) {
      this.deps.domElement.removeEventListener('pointerup', this.upHandler);
      this.deps.domElement.removeEventListener('pointercancel', this.upHandler);
      this.deps.domElement.removeEventListener('lostpointercapture', this.upHandler);
      this.upHandler = null;
    }
    this.active = null;
  }
}
