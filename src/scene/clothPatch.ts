import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Mesh,
  MeshStandardMaterial,
  Vector3,
} from 'three';
import { devBus } from '../debug/devBus';

// Low-resolution verlet cloth on the CPU.
//
//                        col 0   col 1   col 2  ...
//          row 0 (pin)   ●───────●───────●         ← pinned top row
//                        │  ╲ ╱  │  ╲ ╱  │             (gravity hangs the rest)
//                        ●───────●───────●         ← structural + shear constraints
//                        ...
//
// Algorithm: classic Jakobsen verlet — integrate, then iteratively project
// constraints. Three constraint flavors:
//   - structural: every particle to its 4-connected grid neighbors (the
//     load-bearing constraints; pulls cloth back to its rest shape)
//   - shear: every particle to its 4 diagonal neighbors (resists collapse)
//   - bend: every particle to its 2-away grid neighbors (resists folding —
//     keeps the cloth from looking like a paper airplane)
//
// Wind is a sum of sines that drifts in time, per-particle-modulated so
// different parts of the cloth wave at different phases. No noise lib
// dependency — three sines per axis is sufficient for "natural-looking
// turbulence" on a 12×8 grid.
//
// Grab: pin one particle to a target world position via grabAt(). Release
// with releaseGrab(). The constraint pass treats grabbed particles like
// pinned ones — neighbors drag along.

export interface ClothPinConfig {
  /** Indices to pin permanently. If omitted, the top row (row 0) is pinned. */
  indices?: number[];
}

export interface ClothPatchOptions {
  /** Short id for dev-bus events (`cloth:grab`, `cloth:release`). Optional —
   *  defaults to 'cloth'. Set a distinct name per instance (e.g.
   *  'tablecloth_front') so the event log can name what the user grabbed. */
  id?: string;
  /** Two world endpoints that define the cloth's TOP edge — pin row 0 runs
   *  evenly between them. Length = cloth width. */
  pinStart: Vector3;
  pinEnd: Vector3;
  /** How far the cloth hangs below the pin row, in metres. */
  height: number;
  /** Particles across width (cols ≥ 2). */
  cols?: number;
  /** Particles down height (rows ≥ 2). */
  rows?: number;
  /** Particles that should never move. Defaults to the top row. */
  pin?: ClothPinConfig;
  /** m/s² downward. ~9.8 is "real" but cloth feels heavy; ~3 reads as light
   *  fabric in still air. */
  gravity?: number;
  /** Velocity damping per tick. 0 = no friction; 0.01 = a wisp of air. */
  damping?: number;
  /** Multiplier on the wind acceleration. 0 = dead still. */
  windStrength?: number;
  /** Wind vector amplitude — clamps the per-axis peak forces. */
  windAmplitude?: Vector3;
  /** Constraint solver iterations per tick. 4–6 is the sweet spot; more
   *  iterations = stiffer cloth but more CPU. */
  iterations?: number;
  /** Material override. If omitted, a warm-cream cloth material is built. */
  material?: MeshStandardMaterial;
  /** Floor Y. Particles below this clamp on top each tick. */
  floorY?: number;
}

export class ClothPatch {
  readonly mesh: Mesh;

  private cols: number;
  private rows: number;
  private nParticles: number;

  // Position buffers — Float32Array because we hand the same buffer to
  // BufferAttribute and update in place each tick.
  private positions: Float32Array;
  private prev: Float32Array;
  private pinned: Uint8Array;
  // Pinned target — only used when pinned[i] === 1. Lets us move pins
  // around (e.g. for the grab interaction) without separate state.
  private pinPos: Float32Array;
  // Normals regenerated each tick for shading.
  private normals: Float32Array;

  // Constraint table — flat [a, b, restLen] triplets. Built once at construct,
  // burned through each iteration of the constraint pass.
  private constraints: Float32Array;
  private nConstraints: number;

  /** Dev-bus event id. Public so consumers can rename after construction. */
  id: string;

  private gravity: number;
  private damping: number;
  private windStrength: number;
  private windAmp: Vector3;
  private iterations: number;
  private floorY: number;
  private elapsed = 0;

  // Grab state — at most one grabbed particle at a time. The grab uses the
  // same pinned[] machinery so we just toggle a single index in/out.
  private grabIndex = -1;
  private grabWasPinned = false;

  constructor(opts: ClothPatchOptions) {
    this.id = opts.id ?? 'cloth';
    this.cols = Math.max(2, opts.cols ?? 14);
    this.rows = Math.max(2, opts.rows ?? 10);
    this.nParticles = this.cols * this.rows;
    this.gravity = opts.gravity ?? 3.2;
    this.damping = opts.damping ?? 0.018;
    this.windStrength = opts.windStrength ?? 1.0;
    this.windAmp = opts.windAmplitude?.clone() ?? new Vector3(0.55, 0.1, 0.4);
    this.iterations = opts.iterations ?? 5;
    this.floorY = opts.floorY ?? -Infinity;

    // ── particle init ───────────────────────────────────────────────────
    this.positions = new Float32Array(this.nParticles * 3);
    this.prev = new Float32Array(this.nParticles * 3);
    this.pinned = new Uint8Array(this.nParticles);
    this.pinPos = new Float32Array(this.nParticles * 3);
    this.normals = new Float32Array(this.nParticles * 3);

    // Place particles in a flat grid hanging straight down from the pin
    // edge. The first tick of constraints will settle the natural slack —
    // structural rest length is HEIGHT/(rows-1), so the initial straight
    // hang is exactly at rest. Wind/gravity ripple it from there.
    const pinDir = new Vector3().subVectors(opts.pinEnd, opts.pinStart);
    const width = pinDir.length();
    pinDir.normalize();
    const downDir = new Vector3(0, -1, 0);

    const colSpan = width;
    const rowSpan = opts.height;
    for (let row = 0; row < this.rows; row++) {
      const v = row / (this.rows - 1);
      for (let col = 0; col < this.cols; col++) {
        const u = col / (this.cols - 1);
        const x = opts.pinStart.x + pinDir.x * (colSpan * u) + downDir.x * (rowSpan * v);
        const y = opts.pinStart.y + pinDir.y * (colSpan * u) + downDir.y * (rowSpan * v);
        const z = opts.pinStart.z + pinDir.z * (colSpan * u) + downDir.z * (rowSpan * v);
        const i = (row * this.cols + col) * 3;
        this.positions[i + 0] = x;
        this.positions[i + 1] = y;
        this.positions[i + 2] = z;
        this.prev[i + 0] = x;
        this.prev[i + 1] = y;
        this.prev[i + 2] = z;
        this.pinPos[i + 0] = x;
        this.pinPos[i + 1] = y;
        this.pinPos[i + 2] = z;
      }
    }

    // Default pin: every particle in row 0.
    if (opts.pin?.indices) {
      for (const idx of opts.pin.indices) this.pinned[idx] = 1;
    } else {
      for (let col = 0; col < this.cols; col++) {
        this.pinned[col] = 1; // row 0 indices are 0..cols-1
      }
    }

    // ── constraints ─────────────────────────────────────────────────────
    // Estimate the maximum constraint count for the typed array. Worst case:
    //   structural = ~2*N (each particle has up to 2 unique edges: right + down)
    //   shear      = ~2*N (two unique diagonals per cell)
    //   bend       = ~2*N (two-away neighbors right/down)
    // 6*N is comfortably above; we trim at the end.
    const maxC = this.nParticles * 6 + 32;
    this.constraints = new Float32Array(maxC * 3);
    let n = 0;
    const restCol = colSpan / (this.cols - 1);
    const restRow = rowSpan / (this.rows - 1);
    const restDiag = Math.sqrt(restCol * restCol + restRow * restRow);
    const addC = (a: number, b: number, rest: number): void => {
      this.constraints[n * 3 + 0] = a;
      this.constraints[n * 3 + 1] = b;
      this.constraints[n * 3 + 2] = rest;
      n++;
    };
    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        const i = row * this.cols + col;
        // Structural: right, down
        if (col + 1 < this.cols) addC(i, row * this.cols + (col + 1), restCol);
        if (row + 1 < this.rows) addC(i, (row + 1) * this.cols + col, restRow);
        // Shear: diagonal-right-down, diagonal-left-down
        if (col + 1 < this.cols && row + 1 < this.rows) {
          addC(i, (row + 1) * this.cols + (col + 1), restDiag);
        }
        if (col - 1 >= 0 && row + 1 < this.rows) {
          addC(i, (row + 1) * this.cols + (col - 1), restDiag);
        }
        // Bend: 2-away right, 2-away down
        if (col + 2 < this.cols) addC(i, row * this.cols + (col + 2), restCol * 2);
        if (row + 2 < this.rows) addC(i, (row + 2) * this.cols + col, restRow * 2);
      }
    }
    this.nConstraints = n;

    // ── geometry / mesh ─────────────────────────────────────────────────
    const geom = new BufferGeometry();
    geom.setAttribute('position', new BufferAttribute(this.positions, 3));
    geom.setAttribute('normal', new BufferAttribute(this.normals, 3));

    const uvs = new Float32Array(this.nParticles * 2);
    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        const i = row * this.cols + col;
        uvs[i * 2 + 0] = col / (this.cols - 1);
        uvs[i * 2 + 1] = 1 - row / (this.rows - 1);
      }
    }
    geom.setAttribute('uv', new BufferAttribute(uvs, 2));

    // Index buffer — two tris per cell. Uint16 is fine for up to 65k verts;
    // a 12×8 cloth has 96.
    const cells = (this.cols - 1) * (this.rows - 1);
    const indices = new Uint16Array(cells * 6);
    let idx = 0;
    for (let row = 0; row < this.rows - 1; row++) {
      for (let col = 0; col < this.cols - 1; col++) {
        const tl = row * this.cols + col;
        const tr = tl + 1;
        const bl = tl + this.cols;
        const br = bl + 1;
        indices[idx++] = tl; indices[idx++] = bl; indices[idx++] = tr;
        indices[idx++] = tr; indices[idx++] = bl; indices[idx++] = br;
      }
    }
    geom.setIndex(new BufferAttribute(indices, 1));
    geom.computeBoundingSphere();

    const material =
      opts.material ??
      new MeshStandardMaterial({
        color: new Color(0xb88a5e),
        roughness: 0.95,
        metalness: 0,
        side: DoubleSide,
      });

    this.mesh = new Mesh(geom, material);
    this.mesh.frustumCulled = false; // bounds change every tick; saves a recompute
    this.mesh.renderOrder = 1;
    // Cloth is intentionally raycastable (so the grab can hit it) but
    // skips the inverted-hull outline pass (it's an open surface; the hull
    // would render as a fat halo behind every triangle).
    this.mesh.userData.no_outline = true;
    this.mesh.userData.is_cloth = true;
    // Recompute normals once so the first frame isn't flat-shaded blank.
    this.computeNormals();
  }

  // Public API ──────────────────────────────────────────────────────────

  /** Drive the sim forward by `dt` seconds. Sub-steps if `dt` is large so a
   *  tabbed-away pause doesn't blow the cloth across the world on resume. */
  tick(dt: number): void {
    // Cap dt to keep things stable — verlet has no inherent step size limit
    // but the constraint solver explodes if particles teleport more than a
    // constraint length per step. 1/30 ≈ 33ms is safe for our geometry.
    const maxStep = 1 / 30;
    let remaining = Math.min(dt, 0.1); // cap at 100ms — beyond that, just drop frames
    while (remaining > 0) {
      const step = Math.min(remaining, maxStep);
      this.simStep(step);
      remaining -= step;
    }
    this.computeNormals();
    (this.mesh.geometry.getAttribute('position') as BufferAttribute).needsUpdate = true;
    (this.mesh.geometry.getAttribute('normal') as BufferAttribute).needsUpdate = true;
  }

  /** Pin the closest particle to `worldPos`. Releases any previous grab. */
  grabAt(worldPos: Vector3): number {
    this.releaseGrab();
    let best = -1;
    let bestDist = Infinity;
    for (let i = 0; i < this.nParticles; i++) {
      const dx = this.positions[i * 3 + 0] - worldPos.x;
      const dy = this.positions[i * 3 + 1] - worldPos.y;
      const dz = this.positions[i * 3 + 2] - worldPos.z;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    if (best < 0) return -1;
    this.grabIndex = best;
    this.grabWasPinned = this.pinned[best] === 1;
    this.pinned[best] = 1;
    this.pinPos[best * 3 + 0] = worldPos.x;
    this.pinPos[best * 3 + 1] = worldPos.y;
    this.pinPos[best * 3 + 2] = worldPos.z;
    devBus.emit('cloth:grab', { cloth: this.id, particle: best });
    return best;
  }

  /** Update the grabbed particle's target position. No-op if nothing's grabbed. */
  moveGrab(worldPos: Vector3): void {
    if (this.grabIndex < 0) return;
    this.pinPos[this.grabIndex * 3 + 0] = worldPos.x;
    this.pinPos[this.grabIndex * 3 + 1] = worldPos.y;
    this.pinPos[this.grabIndex * 3 + 2] = worldPos.z;
  }

  /** Release the current grab. Restores the particle's prior pinned state
   *  (so grabbing a permanently-pinned top corner doesn't accidentally
   *  unpin it on release). */
  releaseGrab(): void {
    if (this.grabIndex < 0) return;
    if (!this.grabWasPinned) this.pinned[this.grabIndex] = 0;
    this.grabIndex = -1;
    devBus.emit('cloth:release', { cloth: this.id });
  }

  isGrabbing(): boolean {
    return this.grabIndex >= 0;
  }

  /** Position by particle index — used by the grab controller to compute the
   *  initial grab plane. */
  getParticlePosition(i: number, out: Vector3): Vector3 {
    return out.set(
      this.positions[i * 3 + 0],
      this.positions[i * 3 + 1],
      this.positions[i * 3 + 2],
    );
  }

  // Private ─────────────────────────────────────────────────────────────

  private simStep(dt: number): void {
    this.elapsed += dt;

    // Wind: three sines per axis, time-evolving direction. Per-particle
    // spatial modulation gives different parts of the cloth different
    // phases without needing a noise function.
    const t = this.elapsed;
    const windDirX = Math.sin(t * 0.6) * 0.7 + Math.sin(t * 0.13) * 0.3;
    const windDirY = Math.sin(t * 1.1) * 0.4 + Math.cos(t * 0.27) * 0.6;
    const windDirZ = Math.cos(t * 0.5) * 0.7 + Math.sin(t * 0.21) * 0.3;
    const wx = this.windAmp.x * this.windStrength * windDirX;
    const wy = this.windAmp.y * this.windStrength * windDirY;
    const wz = this.windAmp.z * this.windStrength * windDirZ;

    const damping = 1 - this.damping;
    const dt2 = dt * dt;
    const gAcc = -this.gravity;

    // Integrate (verlet).
    for (let i = 0; i < this.nParticles; i++) {
      if (this.pinned[i]) {
        this.positions[i * 3 + 0] = this.pinPos[i * 3 + 0];
        this.positions[i * 3 + 1] = this.pinPos[i * 3 + 1];
        this.positions[i * 3 + 2] = this.pinPos[i * 3 + 2];
        this.prev[i * 3 + 0] = this.pinPos[i * 3 + 0];
        this.prev[i * 3 + 1] = this.pinPos[i * 3 + 1];
        this.prev[i * 3 + 2] = this.pinPos[i * 3 + 2];
        continue;
      }
      const px = this.positions[i * 3 + 0];
      const py = this.positions[i * 3 + 1];
      const pz = this.positions[i * 3 + 2];

      // Per-particle wind modulation: 0..1 phase tied to particle's own
      // world position. Two sines combined so different rows + cols pick
      // up the wind at different moments.
      const modX = Math.sin(px * 1.4 + t * 1.7);
      const modZ = Math.cos(pz * 1.2 + t * 1.1);
      const mod = 0.55 + 0.45 * modX * modZ;

      const vx = (px - this.prev[i * 3 + 0]) * damping;
      const vy = (py - this.prev[i * 3 + 1]) * damping;
      const vz = (pz - this.prev[i * 3 + 2]) * damping;
      this.prev[i * 3 + 0] = px;
      this.prev[i * 3 + 1] = py;
      this.prev[i * 3 + 2] = pz;
      this.positions[i * 3 + 0] = px + vx + wx * mod * dt2;
      this.positions[i * 3 + 1] = py + vy + (gAcc + wy * mod) * dt2;
      this.positions[i * 3 + 2] = pz + vz + wz * mod * dt2;
    }

    // Solve constraints.
    for (let iter = 0; iter < this.iterations; iter++) {
      for (let c = 0; c < this.nConstraints; c++) {
        const a = this.constraints[c * 3 + 0];
        const b = this.constraints[c * 3 + 1];
        const rest = this.constraints[c * 3 + 2];
        const ai = a * 3;
        const bi = b * 3;
        const dx = this.positions[bi + 0] - this.positions[ai + 0];
        const dy = this.positions[bi + 1] - this.positions[ai + 1];
        const dz = this.positions[bi + 2] - this.positions[ai + 2];
        const distSq = dx * dx + dy * dy + dz * dz;
        if (distSq === 0) continue;
        const dist = Math.sqrt(distSq);
        const diff = ((dist - rest) / dist) * 0.5;
        const ox = dx * diff;
        const oy = dy * diff;
        const oz = dz * diff;
        const aPinned = this.pinned[a];
        const bPinned = this.pinned[b];
        if (aPinned && bPinned) continue;
        if (aPinned) {
          // All correction goes to b.
          this.positions[bi + 0] -= ox * 2;
          this.positions[bi + 1] -= oy * 2;
          this.positions[bi + 2] -= oz * 2;
        } else if (bPinned) {
          this.positions[ai + 0] += ox * 2;
          this.positions[ai + 1] += oy * 2;
          this.positions[ai + 2] += oz * 2;
        } else {
          this.positions[ai + 0] += ox;
          this.positions[ai + 1] += oy;
          this.positions[ai + 2] += oz;
          this.positions[bi + 0] -= ox;
          this.positions[bi + 1] -= oy;
          this.positions[bi + 2] -= oz;
        }
      }

      // Floor: clamp after constraints — solving constraints first respects
      // the cloth's natural shape, then a single clamp pass keeps it above
      // the floor.
      if (this.floorY > -Infinity) {
        for (let i = 0; i < this.nParticles; i++) {
          if (this.positions[i * 3 + 1] < this.floorY) {
            this.positions[i * 3 + 1] = this.floorY;
          }
        }
      }
    }
  }

  private computeNormals(): void {
    // Build per-vertex normal by averaging adjacent triangle normals.
    // Cheap at N=96. Iterate cells, accumulate face normals onto each
    // of the 3 (or 4) verts they touch.
    this.normals.fill(0);
    const p = this.positions;
    const accN = (i: number, nx: number, ny: number, nz: number): void => {
      this.normals[i + 0] += nx;
      this.normals[i + 1] += ny;
      this.normals[i + 2] += nz;
    };
    const cross = (ax: number, ay: number, az: number, bx: number, by: number, bz: number): [number, number, number] => {
      return [ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx];
    };
    for (let row = 0; row < this.rows - 1; row++) {
      for (let col = 0; col < this.cols - 1; col++) {
        const tl = (row * this.cols + col) * 3;
        const tr = tl + 3;
        const bl = ((row + 1) * this.cols + col) * 3;
        const br = bl + 3;
        // Triangle 1: tl, bl, tr
        let ex = p[bl + 0] - p[tl + 0];
        let ey = p[bl + 1] - p[tl + 1];
        let ez = p[bl + 2] - p[tl + 2];
        let fx = p[tr + 0] - p[tl + 0];
        let fy = p[tr + 1] - p[tl + 1];
        let fz = p[tr + 2] - p[tl + 2];
        let [nx, ny, nz] = cross(ex, ey, ez, fx, fy, fz);
        accN(tl, nx, ny, nz);
        accN(bl, nx, ny, nz);
        accN(tr, nx, ny, nz);
        // Triangle 2: tr, bl, br
        ex = p[bl + 0] - p[tr + 0];
        ey = p[bl + 1] - p[tr + 1];
        ez = p[bl + 2] - p[tr + 2];
        fx = p[br + 0] - p[tr + 0];
        fy = p[br + 1] - p[tr + 1];
        fz = p[br + 2] - p[tr + 2];
        [nx, ny, nz] = cross(ex, ey, ez, fx, fy, fz);
        accN(tr, nx, ny, nz);
        accN(bl, nx, ny, nz);
        accN(br, nx, ny, nz);
      }
    }
    // Normalize.
    for (let i = 0; i < this.nParticles; i++) {
      const ni = i * 3;
      const nx = this.normals[ni + 0];
      const ny = this.normals[ni + 1];
      const nz = this.normals[ni + 2];
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (len > 0) {
        const inv = 1 / len;
        this.normals[ni + 0] = nx * inv;
        this.normals[ni + 1] = ny * inv;
        this.normals[ni + 2] = nz * inv;
      } else {
        this.normals[ni + 1] = 1;
      }
    }
  }
}
