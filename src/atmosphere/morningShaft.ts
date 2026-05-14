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

export interface MorningShaftConfig {
  shafts?: ShaftDef[];
  dustCount?: number;
  dustBoundsMin?: Vector3;
  dustBoundsMax?: Vector3;
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
  private dustCount: number;
  private dustMin: Vector3;
  private dustMax: Vector3;
  private dotTex: CanvasTexture | null = null;
  private originalFog: Scene['fog'] = null;
  private shaftColor = new Color(0xfff2dd);

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
    this.dustCount = config?.dustCount ?? 800;
    this.dustMin = config?.dustBoundsMin ?? new Vector3(-2.7, -0.4, -2.5);
    this.dustMax = config?.dustBoundsMax ?? new Vector3(1.6, 2.6, 1.6);
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

    // Dust system.
    this.dotTex = makeDotTexture();
    const positions = new Float32Array(this.dustCount * 3);
    const velocities = new Float32Array(this.dustCount * 3);
    const w = this.dustMax.x - this.dustMin.x;
    const h = this.dustMax.y - this.dustMin.y;
    const d = this.dustMax.z - this.dustMin.z;
    for (let i = 0; i < this.dustCount; i++) {
      positions[i * 3 + 0] = this.dustMin.x + Math.random() * w;
      positions[i * 3 + 1] = this.dustMin.y + Math.random() * h;
      positions[i * 3 + 2] = this.dustMin.z + Math.random() * d;
      velocities[i * 3 + 0] = (Math.random() - 0.5) * 0.018;
      velocities[i * 3 + 1] = Math.random() * 0.012 + 0.004; // gentle up-drift
      velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.018;
    }
    const geomD = new BufferGeometry();
    geomD.setAttribute('position', new BufferAttribute(positions, 3));
    this.dustVelocities = velocities;

    const matD = new PointsMaterial({
      size: this.dustSize,
      map: this.dotTex,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      color: 0xfff4d6,
      opacity: this.dustOpacity,
      sizeAttenuation: true,
    });
    this.dust = new Points(geomD, matD);
    this.dust.frustumCulled = false; // motes near camera shouldn't pop out
    this.dust.renderOrder = 6;
    ctx.scene.add(this.dust);

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
    // Drift dust + wraparound.
    if (this.dust && this.dustVelocities) {
      const posAttr = this.dust.geometry.getAttribute('position') as BufferAttribute;
      const arr = posAttr.array as Float32Array;
      const min = this.dustMin;
      const max = this.dustMax;
      for (let i = 0; i < this.dustCount; i++) {
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

    // Push tunable changes into shader uniforms / fog.
    for (const cone of this.cones) {
      cone.material.uniforms.uIntensity.value = this.shaftIntensity;
    }
    if (ctx.scene.fog instanceof FogExp2) {
      ctx.scene.fog.density = this.fogDensity;
    }

    // Sync handles -> shaft data. The dev panel attaches TransformControls to
    // a handle; whatever position the gizmo leaves it at, the cone follows.
    for (let i = 0; i < this.shafts.length; i++) {
      const oH = this.handles[i * 2 + 0];
      const aH = this.handles[i * 2 + 1];
      if (!oH || !aH) continue;
      const s = this.shafts[i];
      if (!oH.position.equals(s.origin) || !aH.position.equals(s.aim)) {
        this.setShaft(i, oH.position, aH.position, s.radius);
      }
    }
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

  getTunables(): AtmosphereTunables {
    const specs: AtmosphereTunables['specs'] = [
      { key: 'shaftIntensity', label: 'shaft intensity', min: 0, max: 1.5, step: 0.01 },
      { key: 'fogDensity', label: 'fog density', min: 0, max: 0.08, step: 0.001 },
      { key: 'dustOpacity', label: 'dust opacity', min: 0, max: 1, step: 0.01 },
      { key: 'dustSize', label: 'dust size', min: 0.005, max: 0.2, step: 0.005 },
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

  /** Snapshot the current shaft config — paste into morningShaft.ts defaults. */
  logShaftConfig(): void {
    const r3 = (n: number) => Math.round(n * 1000) / 1000;
    const out = this.shafts.map((s) => ({
      origin: [r3(s.origin.x), r3(s.origin.y), r3(s.origin.z)],
      aim: [r3(s.aim.x), r3(s.aim.y), r3(s.aim.z)],
      radius: r3(s.radius),
    }));
    console.log('[shafts]\n' + JSON.stringify(out, null, 2));
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
