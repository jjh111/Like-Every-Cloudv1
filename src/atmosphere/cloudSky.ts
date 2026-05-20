import {
  BackSide,
  Color,
  Mesh,
  type Scene,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from 'three';
import type { SunRig } from './sunRig';

// 3-D cloud sky for the main scene. Geometry is a large inverted sphere
// (BackSide), rendered first with depthWrite off so it acts as the
// background everything else paints onto. The sphere's centre tracks the
// camera each frame so the sky stays at "infinity" regardless of camera
// translation — only rotation changes what you see, which is how real skies
// work.
//
// The fragment shader is the cloud system from public/brief.html ported to
// spherical view direction:
//   - 3-stop sky gradient (top / horizon / bottom) keyed on view direction y
//   - 5-octave value-noise FBM in (azimuth, polar) UV space → cloud field
//   - Sun glow as a soft halo around the sun's world direction (no disc yet)
//
// Palette + sun direction come from the SunRig — CloudSky owns no state
// beyond density / drift speed. Time-of-day shifts the palette through the
// SunRig's keyframe LUT.
//
// Stays separate from the Atmosphere interface deliberately: this is an
// always-on backdrop, not a swap-by-name option. MorningShaft + NoAtmosphere
// continue to swap on top.

export interface CloudSkyOptions {
  /** Sphere radius. Big enough that the camera will never reach it. */
  radius?: number;
  /** Cloud density 0..1 — widens the FBM threshold so more clouds clump in. */
  density?: number;
  /** Drift / wind speed factor. */
  speed?: number;
  /** Wind direction in (azimuth, polar) drift space. */
  wind?: [number, number];
  /** Blend amount of cloud color over sky. */
  cloudMix?: number;
}

const VS = /* glsl */ `
  varying vec3 vDir;
  void main() {
    // Vertex position is the direction from the sphere centre.
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FS = /* glsl */ `
  precision mediump float;
  varying vec3 vDir;

  uniform float uTime;
  uniform vec3 uSunDir;
  uniform vec3 uSkyTop;
  uniform vec3 uSkyHorizon;
  uniform vec3 uSkyBottom;
  uniform vec3 uCloudColor;
  uniform vec3 uSunGlow;
  uniform float uSunGlowStrength;
  uniform float uDensity;
  uniform float uSpeed;
  uniform float uCloudMix;
  uniform vec2 uWind;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) {
      v += a * vnoise(p);
      p = p * 2.07 + vec2(11.3, 7.9);
      a *= 0.5;
    }
    return v;
  }

  void main() {
    vec3 dir = normalize(vDir);

    // 3-stop sky gradient keyed on direction.y (1 = zenith, 0 = horizon,
    // -1 = nadir). Smoothstep widens the transition so the horizon line
    // is gradual, not a hard band.
    vec3 sky;
    if (dir.y > 0.0) {
      sky = mix(uSkyHorizon, uSkyTop, smoothstep(0.0, 0.7, dir.y));
    } else {
      sky = mix(uSkyHorizon, uSkyBottom, smoothstep(0.0, -0.4, dir.y));
    }

    // Cloud field in spherical UVs. Atan handles all four quadrants for
    // azimuth (theta); polar (phi) is the angle from up. UV scale tuned
    // so the FBM reads as "puffy mid-altitude clouds" rather than a uniform
    // soup at typical camera FOVs.
    float theta = atan(dir.z, dir.x);
    float phi = acos(clamp(dir.y, -1.0, 1.0));
    vec2 uv = vec2(theta * 0.36, phi * 0.55);
    uv += uWind * uTime * uSpeed * 0.018;
    float c1 = fbm(uv * 3.4);
    float c2 = fbm(uv * 6.8 + vec2(uTime * uSpeed * 0.011, 0.0));
    float clouds = mix(c1, c2, 0.55);
    clouds = smoothstep(0.4, 0.86, clouds * (0.7 + uDensity));
    // Fade clouds out at + below the horizon so the cloud disc reads as
    // distant rather than wrapping around to the ground.
    clouds *= smoothstep(-0.02, 0.18, dir.y);

    vec3 color = mix(sky, uCloudColor, clouds * uCloudMix);

    // Soft sun glow — angular distance from the sun direction. Two pow
    // exponents stacked for a tight bright core + a wider halo. No disc:
    // the user wants subtle glow first, sun-shape later.
    float sunCos = max(0.0, dot(dir, uSunDir));
    float core = pow(sunCos, 32.0);
    float halo = pow(sunCos, 2.2);
    vec3 glow = uSunGlow * (core * 1.4 + halo * 0.45) * uSunGlowStrength;
    // Sun behind the horizon should still fade out cleanly.
    glow *= smoothstep(-0.05, 0.05, uSunDir.y);
    color += glow;

    gl_FragColor = vec4(color, 1.0);
  }
`;

export class CloudSky {
  readonly mesh: Mesh;
  readonly material: ShaderMaterial;
  density: number;
  speed: number;
  cloudMix: number;
  wind: Vector3; // x,y used as 2D wind

  private elapsed = 0;
  private radius: number;

  constructor(private sunRig: SunRig, opts: CloudSkyOptions = {}) {
    // Radius must sit inside the camera's far-clip plane (200 by default).
    // 100 m is plenty: the sphere tracks the camera so its surface is always
    // exactly `radius` away regardless of where the user is in the scene.
    this.radius = opts.radius ?? 100;
    this.density = opts.density ?? 0.55;
    this.speed = opts.speed ?? 0.35;
    this.cloudMix = opts.cloudMix ?? 0.85;
    this.wind = new Vector3(opts.wind?.[0] ?? 1.0, opts.wind?.[1] ?? 0.15, 0);

    const geometry = new SphereGeometry(this.radius, 48, 32);

    this.material = new ShaderMaterial({
      vertexShader: VS,
      fragmentShader: FS,
      side: BackSide,
      depthWrite: false,
      depthTest: false,
      uniforms: {
        uTime: { value: 0 },
        uSunDir: { value: sunRig.sunDirection.clone() },
        uSkyTop: { value: sunRig.palette.top.clone() },
        uSkyHorizon: { value: sunRig.palette.horizon.clone() },
        uSkyBottom: { value: sunRig.palette.bottom.clone() },
        uCloudColor: { value: sunRig.palette.cloud.clone() },
        uSunGlow: { value: sunRig.palette.sunGlow.clone() },
        uSunGlowStrength: { value: sunRig.palette.sunGlowStrength },
        uDensity: { value: this.density },
        uSpeed: { value: this.speed },
        uCloudMix: { value: this.cloudMix },
        uWind: { value: [this.wind.x, this.wind.y] },
      },
    });

    this.mesh = new Mesh(geometry, this.material);
    // Render first; depthWrite off so everything else still z-tests against
    // whatever's behind it. renderOrder = -1 puts us before any other
    // opaque mesh in the default sort.
    this.mesh.renderOrder = -1;
    this.mesh.frustumCulled = false;
    this.mesh.userData.raycastIgnore = true;
  }

  add(scene: Scene): void {
    scene.add(this.mesh);
  }

  remove(scene: Scene): void {
    scene.remove(this.mesh);
  }

  /** Re-centre the sphere on the camera + push current uniforms. */
  update(cameraWorld: Vector3, dt: number): void {
    this.elapsed += dt;
    this.mesh.position.copy(cameraWorld);
    const u = this.material.uniforms;
    u.uTime.value = this.elapsed;
    (u.uSunDir.value as Vector3).copy(this.sunRig.sunDirection);
    (u.uSkyTop.value as Color).copy(this.sunRig.palette.top);
    (u.uSkyHorizon.value as Color).copy(this.sunRig.palette.horizon);
    (u.uSkyBottom.value as Color).copy(this.sunRig.palette.bottom);
    (u.uCloudColor.value as Color).copy(this.sunRig.palette.cloud);
    (u.uSunGlow.value as Color).copy(this.sunRig.palette.sunGlow);
    u.uSunGlowStrength.value = this.sunRig.palette.sunGlowStrength;
    u.uDensity.value = this.density;
    u.uSpeed.value = this.speed;
    u.uCloudMix.value = this.cloudMix;
    const wind = u.uWind.value as number[];
    wind[0] = this.wind.x;
    wind[1] = this.wind.y;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
