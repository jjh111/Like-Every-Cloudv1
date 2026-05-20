import { Vector3 } from 'three';

// Continuous scene clock. Pure data — no three.js scene side-effects. SunRig
// reads it; CloudSky reads it; MorningShaft reads it. The dev panel
// manipulates it via setT() / setRunning() / setDayLength().
//
// `t` is normalised time-of-day in [0, 1):
//   0     = midnight (sun straight down)
//   0.25  = sunrise  (sun on the eastern horizon)
//   0.5   = noon     (sun at apex)
//   0.75  = sunset   (sun on the western horizon)
//
// Sun direction: simple east-to-west arc through the zenith, with an optional
// `latitudeTilt` so noon isn't perfectly overhead — Chad sits near 12°N, so a
// tiny tilt toward -z (north) keeps the noon sun a hair off-axis and reads
// more naturally. Default tilt of -0.16 rad makes the runtime sun direction
// at t = 0.42 coincide with the morning-shaft system's authored direction
// (derived: shaft 0 aim - origin → sun ≈ (0.49, 0.86, -0.14)), so existing
// authored atmospheres look unchanged on first load.
export interface TimeOfDayClockOptions {
  initialT?: number;
  dayLengthSeconds?: number;
  running?: boolean;
  latitudeTilt?: number;
}

export class TimeOfDayClock {
  private _t: number;
  /** Real seconds per simulated 24-hour day. 600s ≈ 25 min in scene per real minute. */
  dayLengthSeconds: number;
  private _running: boolean;
  /** Radians. Negative → sun arc tilts toward -z (north for this scene). */
  latitudeTilt: number;

  constructor(opts: TimeOfDayClockOptions = {}) {
    this._t = wrap01(opts.initialT ?? 0.42);
    this.dayLengthSeconds = opts.dayLengthSeconds ?? 600;
    this._running = opts.running ?? false;
    this.latitudeTilt = opts.latitudeTilt ?? -0.16;
  }

  get t(): number { return this._t; }
  set t(v: number) { this._t = wrap01(v); }

  get running(): boolean { return this._running; }
  set running(v: boolean) { this._running = v; }

  tick(dt: number): void {
    if (!this._running || this.dayLengthSeconds <= 0) return;
    this._t = wrap01(this._t + dt / this.dayLengthSeconds);
  }

  /** Sun direction (unit vector pointing FROM ground TO sun) at the current t.
   *  Reuses `target` if provided; otherwise allocates. */
  getSunDirection(target?: Vector3): Vector3 {
    return computeSunDirection(this._t, this.latitudeTilt, target);
  }

  /** Sun direction at an arbitrary t — useful for reference points (e.g.
   *  morning shafts cache the authored sun direction at a reference t and
   *  rotate from there each frame). */
  sunDirectionAt(t: number, target?: Vector3): Vector3 {
    return computeSunDirection(t, this.latitudeTilt, target);
  }

  /** Sun altitude factor in [-1, 1]. +1 = zenith, 0 = horizon, -1 = nadir. */
  getAltitude(): number {
    return Math.sin((this._t - 0.25) * Math.PI * 2);
  }

  /** "HH:MM" for the dev panel's time chip. */
  formatHM(): string {
    const hours = this._t * 24;
    const h = Math.floor(hours);
    const m = Math.floor((hours - h) * 60);
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
  }
}

function wrap01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  const r = v - Math.floor(v);
  return r < 0 ? r + 1 : r;
}

function computeSunDirection(t: number, tilt: number, target?: Vector3): Vector3 {
  const out = target ?? new Vector3();
  // phase: 0 at sunrise (t=0.25), π/2 at noon (t=0.5), π at sunset (t=0.75),
  // 3π/2 at midnight (t=1=0). So x = cos(phase), y = sin(phase) gives the
  // east → up → west → down arc. Tilt rotates that arc around X toward -Z.
  const phase = (t - 0.25) * Math.PI * 2;
  const ct = Math.cos(tilt);
  const st = Math.sin(tilt);
  out.x = Math.cos(phase);
  out.y = Math.sin(phase) * ct;
  out.z = Math.sin(phase) * st;
  return out.normalize();
}
