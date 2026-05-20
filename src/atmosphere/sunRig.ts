import { AmbientLight, Color, DirectionalLight, Scene, Vector3 } from 'three';
import type { TimeOfDayClock } from './timeOfDayClock';

// Single source of truth for the scene's lighting + sky palette. Owns one
// DirectionalLight (the sun) and one AmbientLight (sky bounce). Both update
// each frame from the TimeOfDayClock.
//
// The palette comes from a small keyframe LUT keyed on sun altitude
// (sin of elevation, -1 nadir to +1 zenith). Lerp between keyframes for
// smooth twilight transitions. Atmospheres + CloudSky read the current
// palette via getters so the sky shader, fog, and lighting all stay
// coordinated.
//
// "Lighting unification" is what this class is for: anything in the scene
// that wants to react to time-of-day reads from one rig instead of
// hardcoding its own values.

export interface SkyPalette {
  /** Sky colour straight up. */
  top: Color;
  /** Sky colour at the horizon line. */
  horizon: Color;
  /** Sky colour below the horizon (ground-fade). Also used as fog colour. */
  bottom: Color;
  /** Tint applied where clouds catch light. */
  cloud: Color;
  /** Warm halo radiating outward from the sun direction. */
  sunGlow: Color;
  /** Colour of the directional sun light. */
  sunLight: Color;
  /** Colour of the ambient hemisphere fill. */
  ambient: Color;
  /** Directional light intensity. */
  sunIntensity: number;
  /** Ambient light intensity. */
  ambientIntensity: number;
  /** How much the sun glow contributes — palette modulates this so the
   *  sun doesn't punch through at night. */
  sunGlowStrength: number;
}

interface PaletteKeyframe {
  alt: number;
  top: number;
  horizon: number;
  bottom: number;
  cloud: number;
  sunGlow: number;
  sunLight: number;
  ambient: number;
  sunIntensity: number;
  ambientIntensity: number;
  sunGlowStrength: number;
}

// Hand-tuned to feel coherent with the scene's existing warm palette. Day
// keyframe at alt=0.55 matches the previous static lighting (warm cream).
// Twilight slopes are gentle — sunrise/sunset reads as "warmer + lower"
// rather than a flash of orange.
const KEYFRAMES: PaletteKeyframe[] = [
  // midnight
  {
    alt: -1.0,
    top: 0x070b18, horizon: 0x18233b, bottom: 0x0f1426,
    cloud: 0x202738, sunGlow: 0x1a2238,
    sunLight: 0x91a4cf, ambient: 0x1d2638,
    sunIntensity: 0.0, ambientIntensity: 0.08, sunGlowStrength: 0.0,
  },
  // deep twilight
  {
    alt: -0.18,
    top: 0x1c2440, horizon: 0x4a3953, bottom: 0x352a45,
    cloud: 0x453749, sunGlow: 0x6d4659,
    sunLight: 0xb59ec0, ambient: 0x3a2e44,
    sunIntensity: 0.05, ambientIntensity: 0.12, sunGlowStrength: 0.4,
  },
  // golden hour (sunrise / sunset)
  {
    alt: 0.0,
    top: 0x6b6478, horizon: 0xd07a4e, bottom: 0x8d6453,
    cloud: 0xeaa472, sunGlow: 0xffcc88,
    sunLight: 0xffb27a, ambient: 0x9c7a64,
    sunIntensity: 0.35, ambientIntensity: 0.22, sunGlowStrength: 1.0,
  },
  // morning / late afternoon
  {
    alt: 0.3,
    top: 0x86b1d2, horizon: 0xe6c089, bottom: 0xcfa982,
    cloud: 0xfff0d4, sunGlow: 0xffe9b8,
    sunLight: 0xfff0d0, ambient: 0xcfb89a,
    sunIntensity: 0.95, ambientIntensity: 0.4, sunGlowStrength: 0.7,
  },
  // warm afternoon (matches previous static lighting)
  {
    alt: 0.55,
    top: 0xa8c8e8, horizon: 0xdec699, bottom: 0xc9a878,
    cloud: 0xfff5dd, sunGlow: 0xfff1c4,
    sunLight: 0xfff2dd, ambient: 0xfff2dd,
    sunIntensity: 1.3, ambientIntensity: 0.45, sunGlowStrength: 0.45,
  },
  // high noon
  {
    alt: 1.0,
    top: 0x8eb3d6, horizon: 0xe6d1a5, bottom: 0xcfb38a,
    cloud: 0xffffff, sunGlow: 0xffffff,
    sunLight: 0xffffff, ambient: 0xeae5d6,
    sunIntensity: 1.45, ambientIntensity: 0.5, sunGlowStrength: 0.25,
  },
];

export class SunRig {
  readonly directional: DirectionalLight;
  readonly ambient: AmbientLight;

  /** Cached sun direction. Atmospheres read this each frame. */
  readonly sunDirection = new Vector3(0, 1, 0);
  /** Cached palette (mutated in place each frame). */
  readonly palette: SkyPalette;
  /** Cached altitude factor (-1..1). */
  altitude = 1;

  private readonly distance: number;

  constructor(scene: Scene, private clock: TimeOfDayClock, opts: { distance?: number } = {}) {
    this.distance = opts.distance ?? 50;
    this.palette = makeEmptyPalette();
    this.directional = new DirectionalLight(0xfff2dd, 1.3);
    this.directional.position.set(15, 20, 10);
    this.ambient = new AmbientLight(0xfff2dd, 0.7);
    scene.add(this.directional);
    scene.add(this.directional.target);
    scene.add(this.ambient);
    // Sync immediately so the first rendered frame already reflects the
    // clock's initial t (otherwise we'd flash the constructor defaults).
    this.update();
  }

  /** Re-read the clock + recompute lights + palette. Cheap; call every frame. */
  update(): void {
    this.clock.getSunDirection(this.sunDirection);
    this.altitude = this.sunDirection.y;

    // Sample the keyframe LUT.
    samplePalette(this.altitude, this.palette);

    // Position + intensity + colour of the sun light.
    this.directional.position
      .copy(this.sunDirection)
      .multiplyScalar(this.distance);
    this.directional.target.position.set(0, 0, 0);
    this.directional.target.updateMatrixWorld();
    this.directional.color.copy(this.palette.sunLight);
    this.directional.intensity = this.palette.sunIntensity;

    this.ambient.color.copy(this.palette.ambient);
    this.ambient.intensity = this.palette.ambientIntensity;
  }

  dispose(scene: Scene): void {
    scene.remove(this.directional);
    scene.remove(this.directional.target);
    scene.remove(this.ambient);
  }
}

function makeEmptyPalette(): SkyPalette {
  return {
    top: new Color(),
    horizon: new Color(),
    bottom: new Color(),
    cloud: new Color(),
    sunGlow: new Color(),
    sunLight: new Color(),
    ambient: new Color(),
    sunIntensity: 0,
    ambientIntensity: 0,
    sunGlowStrength: 0,
  };
}

// Re-used inside samplePalette so we don't allocate a Color per keyframe pair
// per frame. Single shared scratch Color is safe because samplePalette is
// strictly synchronous.
const TMP_COLOR = new Color();

function samplePalette(alt: number, out: SkyPalette): void {
  // Find bracketing keyframes.
  let lo = KEYFRAMES[0];
  let hi = KEYFRAMES[KEYFRAMES.length - 1];
  if (alt <= lo.alt) {
    applyKeyframe(out, lo);
    return;
  }
  if (alt >= hi.alt) {
    applyKeyframe(out, hi);
    return;
  }
  for (let i = 0; i < KEYFRAMES.length - 1; i++) {
    if (alt >= KEYFRAMES[i].alt && alt <= KEYFRAMES[i + 1].alt) {
      lo = KEYFRAMES[i];
      hi = KEYFRAMES[i + 1];
      break;
    }
  }
  const span = hi.alt - lo.alt;
  const t = span > 1e-6 ? (alt - lo.alt) / span : 0;
  // Smoothstep makes twilight feel less linear-ramp and more breathing.
  const s = t * t * (3 - 2 * t);
  out.top.setHex(lo.top).lerp(TMP_COLOR.setHex(hi.top), s);
  out.horizon.setHex(lo.horizon).lerp(TMP_COLOR.setHex(hi.horizon), s);
  out.bottom.setHex(lo.bottom).lerp(TMP_COLOR.setHex(hi.bottom), s);
  out.cloud.setHex(lo.cloud).lerp(TMP_COLOR.setHex(hi.cloud), s);
  out.sunGlow.setHex(lo.sunGlow).lerp(TMP_COLOR.setHex(hi.sunGlow), s);
  out.sunLight.setHex(lo.sunLight).lerp(TMP_COLOR.setHex(hi.sunLight), s);
  out.ambient.setHex(lo.ambient).lerp(TMP_COLOR.setHex(hi.ambient), s);
  out.sunIntensity = lerp(lo.sunIntensity, hi.sunIntensity, s);
  out.ambientIntensity = lerp(lo.ambientIntensity, hi.ambientIntensity, s);
  out.sunGlowStrength = lerp(lo.sunGlowStrength, hi.sunGlowStrength, s);
}

function applyKeyframe(out: SkyPalette, k: PaletteKeyframe): void {
  out.top.setHex(k.top);
  out.horizon.setHex(k.horizon);
  out.bottom.setHex(k.bottom);
  out.cloud.setHex(k.cloud);
  out.sunGlow.setHex(k.sunGlow);
  out.sunLight.setHex(k.sunLight);
  out.ambient.setHex(k.ambient);
  out.sunIntensity = k.sunIntensity;
  out.ambientIntensity = k.ambientIntensity;
  out.sunGlowStrength = k.sunGlowStrength;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
