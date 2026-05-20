import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  ConeGeometry,
  DoubleSide,
  FogExp2,
  Mesh,
  MeshBasicMaterial,
  Points,
  PointsMaterial,
  Quaternion,
  type Scene,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from 'three';
import type { Atmosphere, AtmosphereContext, AtmosphereTunables } from './atmosphere';

// Single light shaft definition. "origin" is the door/window opening up in the
// air; "aim" is roughly where the shaft splashes on the floor. The cone is
// drawn between them with radius `radius` at the aim end (the splash).
export interface ShaftDef {
  origin: Vector3;
  aim: Vector3;
  radius: number;
}

// Cheap god rays + dust motes + warmer FogExp2. No postprocess, no extra
// dependency, two draw calls per shaft + one for dust.
//
//  - FogExp2 swaps in for the linear Fog so distant edges fall off softly.
//  - Each shaft is a `ConeGeometry` with an additive ShaderMaterial. The
//    shader fades alpha by (a) view alignment with the shaft axis — invisible
//    when looking straight down the beam — and (b) distance along the shaft,
//    brighter near the apex.
//  - Dust is a single `Points` system with ~800 motes drifting slowly
//    upward + a bit of horizontal wander. CPU-updated (cheap at this count),
//    wraparound on the room AABB so they recycle into view.
//
// All knobs are live-tunable via the dev panel.

const DOT_TEX_SIZE = 64;
function makeDotTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = DOT_TEX_SIZE;
  const g = c.getContext('2d');
  if (!g) throw new Error('canvas 2d unavailable');
  const cx = DOT_TEX_SIZE * 0.5;
  const grad = g.createRadialGradient(cx, cx, 0, cx, cx, cx);
  grad.addColorStop(0, 'rgba(255, 246, 220, 1)');
  grad.addColorStop(0.45, 'rgba(255, 246, 220, 0.6)');
  grad.addColorStop(1, 'rgba(255, 246, 220, 0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, DOT_TEX_SIZE, DOT_TEX_SIZE);
  const tex = new CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

const SHAFT_VS = /* glsl */ `
  varying float vAlong;
  varying vec3 vWorld;
  void main() {
    // ConeGeometry after geom.translate(0, h/2, 0): base at local y=0, apex
    // at local y=h. vAlong: 0 at base (floor), 1 at apex (door).
    vAlong = position.y * uInvHeight;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
  // Uniform declaration has to come before the shader body in some drivers;
  // three.js prepends its own header so this is fine here.
`;

const SHAFT_FS = /* glsl */ `
  varying float vAlong;
  varying vec3 vWorld;
  uniform vec3 uShaftDir;   // world-space, normalized, origin -> aim (downward)
  uniform vec3 uColor;
  uniform float uIntensity;
  void main() {
    vec3 toCam = normalize(cameraPosition - vWorld);
    // 1 when looking straight along the beam, 0 perpendicular.
    float align = abs(dot(toCam, uShaftDir));
    float viewFade = 1.0 - smoothstep(0.8, 0.99, align);
    // Brighter near apex (door), dim at the splash so it doesn't paint the floor.
    float along = mix(0.2, 0.95, vAlong);
    float a = uIntensity * viewFade * along;
    gl_FragColor = vec4(uColor * a, a);
  }
`;

// Tiny vertex-shader prelude so SHAFT_VS can use uInvHeight uniform.
const SHAFT_VS_PREFIX = 'uniform float uInvHeight;\n';

// Per-frame scratch vectors for applySunOrientation — module-scoped so the
// per-shaft loop doesn't allocate. Safe because the function runs strictly
// synchronously on the render thread.
const SUN_TMP_AIM = new Vector3();
const SUN_TMP_OFFSET = new Vector3();
const SUN_TMP_UP = new Vector3();
const SUN_TMP_DIR = new Vector3();
const SUN_TMP_AXIS = new Vector3();
const SUN_TMP_SHAFT_DIR = new Vector3();
const SUN_TMP_ROT = new Quaternion();

export interface MorningShaftConfig {
  shafts?: ShaftDef[];
  dustCount?: number;
  dustBoundsMin?: Vector3;
  dustBoundsMax?: Vector3;
  /** Live tunables. Saved alongside shafts so panel adjustments survive refresh. */
  shaftIntensity?: number;
  fogDensity?: number;
  dustOpacity?: number;
  dustSize?: number;
  /** Clock t at which the authored shaft directions are correct. At runtime
   *  the cones rotate around their origins as the sun moves away from this
   *  reference. Default 0.42 matches the authored direction of the existing
   *  shafts (mid-morning sun for the current scene). */
  shaftReferenceT?: number;
}

export class MorningShaft implements Atmosphere {
  // Live tunables — exposed via getTunables().
  shaftIntensity = 0.35;
  fogDensity = 0.018;
  dustOpacity = 0.65;
  dustSize = 0.05;

  private shafts: ShaftDef[];
  private cones: { mesh: Mesh; material: ShaderMaterial }[] = [];
  /** Two handles per shaft: [s0.origin, s0.aim, s1.origin, s1.aim, …]. */
  private handles: Mesh[] = [];
  private dust: Points | null = null;
  private dustVelocities: Float32Array | null = null;
  /** Backing field for the dustCount setter — when changed, dust rebuilds on next update. */
  private _dustCount: number;
  /** Set by the dustCount setter so update() knows to rebuild on the next tick. */
  private dustNeedsRebuild = false;
  private dustMin: Vector3;
  private dustMax: Vector3;
  private dotTex: CanvasTexture | null = null;
  private originalFog: Scene['fog'] = null;
  private shaftColor = new Color(0xfff2dd);
  /** Authored t the shaft directions were drawn at; cones rotate around
   *  their origins by the delta from this to the live sun direction. */
  shaftReferenceT = 0.42;
  /** Sun direction at shaftReferenceT — cached so we don't recompute the
   *  arc each frame. Refreshed if shaftReferenceT changes. */
  private referenceSunDir = new Vector3();
  /** When the sun isn't being driven by a SunRig (NoAtmosphere context, dev
   *  fallback), this stays true and the cones render at their authored
   *  positions, intensity uses the authored shaftIntensity directly. */
  private sunRigSeen = false;

  constructor(config?: MorningShaftConfig) {
    // Placeholders sized to the SolidWallStructure footprint we saw in app.ts
    // (3.7×5.4m, centered ~(-0.9, _, -0.5)). User can adjust via dev panel.
    this.shafts = config?.shafts ?? [
      // Main door: front +Z side, shaft angled inward + down.
      {
        origin: new Vector3(0.6, 2.3, 1.7),
        aim: new Vector3(-0.4, -0.4, 0.2),
        radius: 0.9,
      },
      // Side door: -X side, shaft angled inward + down.
      {
        origin: new Vector3(-2.6, 2.1, -0.4),
        aim: new Vector3(-0.8, -0.4, -0.6),
        radius: 0.75,
      },
    ];
    this._dustCount = config?.dustCount ?? 800;
    this.dustMin = config?.dustBoundsMin ?? new Vector3(-2.7, -0.4, -2.5);
    this.dustMax = config?.dustBoundsMax ?? new Vector3(1.6, 2.6, 1.6);
    if (typeof config?.shaftIntensity === 'number') this.shaftIntensity = config.shaftIntensity;
    if (typeof config?.fogDensity === 'number') this.fogDensity = config.fogDensity;
    if (typeof config?.dustOpacity === 'number') this.dustOpacity = config.dustOpacity;
    if (typeof config?.dustSize === 'number') this.dustSize = config.dustSize;
    if (typeof config?.shaftReferenceT === 'number') this.shaftReferenceT = config.shaftReferenceT;
    // Compute the reference sun direction so update() can derive the delta
    // each frame without re-running the arc math. The latitude tilt used
    // here MUST match the clock's; -0.16 is the project default.
    this.computeReferenceSunDir();
  }

  private computeReferenceSunDir(): void {
    const t = this.shaftReferenceT;
    const phase = (t - 0.25) * Math.PI * 2;
    const tilt = -0.16;
    this.referenceSunDir.set(
      Math.cos(phase),
      Math.sin(phase) * Math.cos(tilt),
      Math.sin(phase) * Math.sin(tilt),
    ).normalize();
  }

  init(ctx: AtmosphereContext): void {
    // Swap in exponential fog so distance falloff feels less banded. Hold the
    // original so dispose can restore it.
    this.originalFog = ctx.scene.fog ?? null;
    ctx.scene.fog = new FogExp2(0xc9a878, this.fogDensity);

    for (const shaft of this.shafts) {
      const len = shaft.origin.distanceTo(shaft.aim);
      const geom = new ConeGeometry(shaft.radius, len, 28, 1, true);
      // Center cone sits at origin with apex at +h/2; translate so base is at
      // local y=0 and apex at local y=len. That makes the rotation math below
      // straightforward (local +Y is "up the shaft").
      geom.translate(0, len * 0.5, 0);

      const material = new ShaderMaterial({
        vertexShader: SHAFT_VS_PREFIX + SHAFT_VS,
        fragmentShader: SHAFT_FS,
        uniforms: {
          uShaftDir: { value: new Vector3() },
          uColor: { value: this.shaftColor },
          uIntensity: { value: this.shaftIntensity },
          uInvHeight: { value: 1 / Math.max(0.0001, len) },
        },
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
        side: DoubleSide,
      });

      const mesh = new Mesh(geom, material);
      // Place the cone with its base at the aim point, then rotate so local
      // +Y points back up at the origin. Apex lands at the origin.
      mesh.position.copy(shaft.aim);
      const up = new Vector3(0, 1, 0);
      const dir = shaft.origin.clone().sub(shaft.aim).normalize();
      const dotUp = Math.max(-1, Math.min(1, up.dot(dir)));
      if (dotUp < 0.999) {
        const axis = new Vector3().crossVectors(up, dir);
        if (axis.lengthSq() > 1e-6) {
          mesh.quaternion.setFromAxisAngle(axis.normalize(), Math.acos(dotUp));
        }
      }

      // Shader needs world-space shaft direction (origin -> aim, pointing down).
      const shaftDirWorld = shaft.aim.clone().sub(shaft.origin).normalize();
      (material.uniforms.uShaftDir.value as Vector3).copy(shaftDirWorld);

      // Render after opaques so the additive blend reads the correct depths.
      mesh.renderOrder = 5;
      // Atmosphere is decoration — raycaster should never pick the cone.
      mesh.userData.raycastIgnore = true;
      ctx.scene.add(mesh);
      this.cones.push({ mesh, material });
    }

    // Dust system — separated into createDust so the dustCount setter can
    // tear down + rebuild on the next update() tick without re-running init.
    this.createDust(ctx.scene);

    // Per-endpoint handle meshes. Hidden by default; the dev panel surfaces a
    // dropdown that picks one of these as a TransformControls target. They're
    // drawn on top (depthTest off + high renderOrder) so they're visible
    // even when buried inside walls.
    for (let i = 0; i < this.shafts.length; i++) {
      const shaft = this.shafts[i];
      for (const role of ['origin', 'aim'] as const) {
        const geom = new SphereGeometry(0.08, 14, 12);
        const mat = new MeshBasicMaterial({
          color: role === 'origin' ? 0xffd166 : 0x4d96ff,
          depthTest: false,
          transparent: true,
          opacity: 0.85,
        });
        const handle = new Mesh(geom, mat);
        handle.renderOrder = 100;
        handle.visible = false;
        handle.position.copy(role === 'origin' ? shaft.origin : shaft.aim);
        // Tags so app.ts / pointer can recognize / filter these.
        handle.userData.atmosphereHandle = true;
        handle.userData.shaftIndex = i;
        handle.userData.shaftRole = role;
        ctx.scene.add(handle);
        this.handles.push(handle);
      }
    }
  }

  update(ctx: AtmosphereContext, dt: number): void {
    // Rebuild dust if the count changed (or bounds — same flag covers both).
    if (this.dustNeedsRebuild) {
      this.createDust(ctx.scene);
    }
    // Drift dust + wraparound.
    if (this.dust && this.dustVelocities) {
      const posAttr = this.dust.geometry.getAttribute('position') as BufferAttribute;
      const arr = posAttr.array as Float32Array;
      const min = this.dustMin;
      const max = this.dustMax;
      for (let i = 0; i < this._dustCount; i++) {
        let x = arr[i * 3 + 0] + this.dustVelocities[i * 3 + 0] * dt;
        let y = arr[i * 3 + 1] + this.dustVelocities[i * 3 + 1] * dt;
        let z = arr[i * 3 + 2] + this.dustVelocities[i * 3 + 2] * dt;
        if (x < min.x) x = max.x; else if (x > max.x) x = min.x;
        if (y < min.y) y = max.y; else if (y > max.y) y = min.y;
        if (z < min.z) z = max.z; else if (z > max.z) z = min.z;
        arr[i * 3 + 0] = x;
        arr[i * 3 + 1] = y;
        arr[i * 3 + 2] = z;
      }
      posAttr.needsUpdate = true;

      const mat = this.dust.material as PointsMaterial;
      mat.opacity = this.dustOpacity;
      mat.size = this.dustSize;
    }

    if (ctx.scene.fog instanceof FogExp2) {
      ctx.scene.fog.density = this.fogDensity;
    }

    // Sync handles -> shaft data FIRST. The dev panel attaches TransformControls
    // to a handle; whatever position the gizmo leaves it at, this.shafts
    // mirrors. Note the handles always reflect AUTHORED positions — sun
    // rotation never writes back to this.shafts.
    for (let i = 0; i < this.shafts.length; i++) {
      const oH = this.handles[i * 2 + 0];
      const aH = this.handles[i * 2 + 1];
      if (!oH || !aH) continue;
      const s = this.shafts[i];
      if (!oH.position.equals(s.origin) || !aH.position.equals(s.aim)) {
        this.setShaft(i, oH.position, aH.position, s.radius);
      }
    }

    // Time-of-day integration. SunRig supplies the live sun direction +
    // altitude. We rotate each cone visual around its origin by the
    // delta from the authored sun direction to the live one — preserving
    // shaft length so no geometry regen needed — and modulate intensity
    // by clamp(sun.y, 0, 1) so shafts fade out below the horizon.
    //
    // Workflow note: handles sit at AUTHORED positions, not rotated ones.
    // For visually-aligned shaft editing, snap the clock to shaftReferenceT
    // first (the dev panel has a button for this).
    const sun = ctx.sunRig;
    if (sun) {
      const sunDir = sun.sunDirection;
      for (let i = 0; i < this.cones.length; i++) {
        this.applySunOrientation(i, sunDir);
      }
      const altClamped = Math.max(0, sun.altitude);
      const liveIntensity = this.shaftIntensity * altClamped;
      for (const cone of this.cones) {
        cone.material.uniforms.uIntensity.value = liveIntensity;
      }
    } else {
      // No SunRig — render shafts at authored direction + authored intensity.
      for (const cone of this.cones) {
        cone.material.uniforms.uIntensity.value = this.shaftIntensity;
      }
    }
  }

  /** Rotate cone visual around its origin by the delta from the authored
   *  sun direction (at shaftReferenceT) to the current sun direction. Pure
   *  rotation preserves the shaft's length, so no geometry regen. */
  private applySunOrientation(index: number, currentSunDir: Vector3): void {
    const shaft = this.shafts[index];
    const cone = this.cones[index];
    if (!cone) return;

    const aimOut = SUN_TMP_AIM;
    aimOut.copy(shaft.aim);
    // Below horizon → intensity will be 0 so geometry doesn't matter; skip
    // the math to keep the cone in its authored shape.
    if (currentSunDir.y > 0.001 && this.referenceSunDir.y > 0.001) {
      SUN_TMP_OFFSET.copy(shaft.aim).sub(shaft.origin);
      SUN_TMP_ROT.setFromUnitVectors(this.referenceSunDir, currentSunDir);
      SUN_TMP_OFFSET.applyQuaternion(SUN_TMP_ROT);
      aimOut.copy(shaft.origin).add(SUN_TMP_OFFSET);
    }

    cone.mesh.position.copy(aimOut);
    const up = SUN_TMP_UP;
    up.set(0, 1, 0);
    const dir = SUN_TMP_DIR;
    dir.copy(shaft.origin).sub(aimOut).normalize();
    const dotUp = Math.max(-1, Math.min(1, up.dot(dir)));
    if (dotUp < 0.999) {
      const axis = SUN_TMP_AXIS;
      axis.crossVectors(up, dir);
      if (axis.lengthSq() > 1e-6) {
        cone.mesh.quaternion.setFromAxisAngle(axis.normalize(), Math.acos(dotUp));
      }
    } else {
      cone.mesh.quaternion.identity();
    }

    // Shader uniform: world-space shaft direction (origin → aim). Used by
    // the shader's view-alignment fade.
    const shaftDirWorld = SUN_TMP_SHAFT_DIR;
    shaftDirWorld.copy(aimOut).sub(shaft.origin).normalize();
    (cone.material.uniforms.uShaftDir.value as Vector3).copy(shaftDirWorld);
  }

  dispose(ctx: AtmosphereContext): void {
    for (const cone of this.cones) {
      ctx.scene.remove(cone.mesh);
      cone.mesh.geometry.dispose();
      cone.material.dispose();
    }
    this.cones = [];
    for (const handle of this.handles) {
      ctx.scene.remove(handle);
      handle.geometry.dispose();
      (handle.material as MeshBasicMaterial).dispose();
    }
    this.handles = [];
    if (this.dust) {
      ctx.scene.remove(this.dust);
      this.dust.geometry.dispose();
      (this.dust.material as PointsMaterial).dispose();
      this.dust = null;
    }
    this.dustVelocities = null;
    if (this.dotTex) {
      this.dotTex.dispose();
      this.dotTex = null;
    }
    ctx.scene.fog = this.originalFog;
    this.originalFog = null;
  }

  // Per-shaft radius surfaced as accessors so the dev panel can bind a
  // slider directly to it. Adding setShaftRadius() on a single index keeps
  // the cone geometry in sync without an explicit refresh call.
  get shaft0Radius(): number { return this.shafts[0]?.radius ?? 0; }
  set shaft0Radius(v: number) { if (this.shafts[0]) this.setShaftRadius(0, v); }
  get shaft1Radius(): number { return this.shafts[1]?.radius ?? 0; }
  set shaft1Radius(v: number) { if (this.shafts[1]) this.setShaftRadius(1, v); }

  // Dust mote count. Setter rounds + flags a deferred rebuild that happens
  // on the next update() so we don't reallocate during a slider drag spam.
  get dustCount(): number { return this._dustCount; }
  set dustCount(v: number) {
    const n = Math.max(0, Math.round(v));
    if (n === this._dustCount) return;
    this._dustCount = n;
    this.dustNeedsRebuild = true;
  }

  /** Tear down and recreate the Points system in place. Used at init + when
   *  dustCount (and eventually bounds) changes. Material is reused across
   *  rebuilds so live opacity/size sliders keep their wiring. */
  private createDust(scene: Scene): void {
    if (!this.dotTex) this.dotTex = makeDotTexture();
    const count = this._dustCount;
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);
    const w = this.dustMax.x - this.dustMin.x;
    const h = this.dustMax.y - this.dustMin.y;
    const d = this.dustMax.z - this.dustMin.z;
    for (let i = 0; i < count; i++) {
      positions[i * 3 + 0] = this.dustMin.x + Math.random() * w;
      positions[i * 3 + 1] = this.dustMin.y + Math.random() * h;
      positions[i * 3 + 2] = this.dustMin.z + Math.random() * d;
      velocities[i * 3 + 0] = (Math.random() - 0.5) * 0.018;
      velocities[i * 3 + 1] = Math.random() * 0.012 + 0.004; // gentle up-drift
      velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.018;
    }
    const geom = new BufferGeometry();
    geom.setAttribute('position', new BufferAttribute(positions, 3));
    this.dustVelocities = velocities;

    let mat: PointsMaterial;
    if (this.dust) {
      mat = this.dust.material as PointsMaterial;
      scene.remove(this.dust);
      this.dust.geometry.dispose();
    } else {
      mat = new PointsMaterial({
        size: this.dustSize,
        map: this.dotTex,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        color: 0xfff4d6,
        opacity: this.dustOpacity,
        sizeAttenuation: true,
      });
    }
    this.dust = new Points(geom, mat);
    this.dust.frustumCulled = false; // motes near camera shouldn't pop out
    this.dust.renderOrder = 6;
    scene.add(this.dust);
    this.dustNeedsRebuild = false;
  }

  getTunables(): AtmosphereTunables {
    const specs: AtmosphereTunables['specs'] = [
      { key: 'shaftIntensity', label: 'shaft intensity', min: 0, max: 1.5, step: 0.01 },
      { key: 'fogDensity', label: 'fog density', min: 0, max: 0.08, step: 0.001 },
      { key: 'dustOpacity', label: 'dust opacity', min: 0, max: 1, step: 0.01 },
      { key: 'dustSize', label: 'dust size', min: 0.005, max: 0.2, step: 0.005 },
      { key: 'dustCount', label: 'dust count', min: 0, max: 2000, step: 50 },
    ];
    // Only surface a per-shaft radius slider for shafts that actually exist
    // so a config with fewer shafts (or NoAtmosphere) doesn't show dead knobs.
    if (this.shafts.length >= 1) {
      specs.push({ key: 'shaft0Radius', label: 'shaft 0 radius', min: 0.1, max: 3, step: 0.01 });
    }
    if (this.shafts.length >= 2) {
      specs.push({ key: 'shaft1Radius', label: 'shaft 1 radius', min: 0.1, max: 3, step: 0.01 });
    }
    return { target: this, specs };
  }

  /** JSON-serializable snapshot for save → morning-shaft.json. */
  getCurrentShafts(): Array<{
    origin: [number, number, number];
    aim: [number, number, number];
    radius: number;
  }> {
    const r3 = (n: number) => Math.round(n * 1000) / 1000;
    return this.shafts.map((s) => ({
      origin: [r3(s.origin.x), r3(s.origin.y), r3(s.origin.z)],
      aim: [r3(s.aim.x), r3(s.aim.y), r3(s.aim.z)],
      radius: r3(s.radius),
    }));
  }

  /** Full serializable config — shafts plus every panel-editable tunable. */
  getCurrentConfig(): {
    shafts: ReturnType<MorningShaft['getCurrentShafts']>;
    shaftIntensity: number;
    fogDensity: number;
    dustOpacity: number;
    dustSize: number;
    dustCount: number;
  } {
    const r3 = (n: number) => Math.round(n * 1000) / 1000;
    return {
      shafts: this.getCurrentShafts(),
      shaftIntensity: r3(this.shaftIntensity),
      fogDensity: r3(this.fogDensity),
      dustOpacity: r3(this.dustOpacity),
      dustSize: r3(this.dustSize),
      dustCount: this._dustCount,
    };
  }

  /** How many shafts are currently configured. */
  getShaftCount(): number {
    return this.shafts.length;
  }

  /** A specific handle so the dev panel can hand it to TransformControls. */
  getShaftHandle(index: number, role: 'origin' | 'aim'): Mesh | undefined {
    return this.handles[index * 2 + (role === 'origin' ? 0 : 1)];
  }

  /** Toggle visibility of every shaft handle. */
  setHandlesVisible(visible: boolean): void {
    for (const h of this.handles) h.visible = visible;
  }

  /** Tune a single shaft's radius without touching its endpoints. */
  setShaftRadius(index: number, radius: number): void {
    const s = this.shafts[index];
    if (!s) return;
    this.setShaft(index, s.origin, s.aim, radius);
  }

  /** Current radius of one shaft (so the panel slider can read it). */
  getShaftRadius(index: number): number {
    return this.shafts[index]?.radius ?? 0;
  }

  /** Live-edit shaft endpoints, e.g. from the panel's gizmo handle. */
  setShaft(index: number, origin: Vector3, aim: Vector3, radius: number): void {
    if (index < 0 || index >= this.cones.length) return;
    this.shafts[index] = { origin: origin.clone(), aim: aim.clone(), radius };
    const cone = this.cones[index];
    cone.mesh.geometry.dispose();
    const len = origin.distanceTo(aim);
    const geom = new ConeGeometry(radius, len, 28, 1, true);
    geom.translate(0, len * 0.5, 0);
    cone.mesh.geometry = geom;
    cone.mesh.position.copy(aim);
    const up = new Vector3(0, 1, 0);
    const dir = origin.clone().sub(aim).normalize();
    const dotUp = Math.max(-1, Math.min(1, up.dot(dir)));
    if (dotUp < 0.999) {
      const axis = new Vector3().crossVectors(up, dir);
      if (axis.lengthSq() > 1e-6) {
        cone.mesh.quaternion.setFromAxisAngle(axis.normalize(), Math.acos(dotUp));
      }
    } else {
      cone.mesh.quaternion.identity();
    }
    cone.material.uniforms.uInvHeight.value = 1 / Math.max(0.0001, len);
    (cone.material.uniforms.uShaftDir.value as Vector3).copy(
      aim.clone().sub(origin).normalize(),
    );
  }
}
