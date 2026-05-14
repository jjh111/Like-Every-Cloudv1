# Like Every Cloud

Realtime web scene for the Like Every Cloud project — interior of a Chad cassette shop with two time states (past / present), spatialized audio, a data-driven interaction engine, atmospheric volumetrics, and a dev panel for editing the scene in the browser.

three.js + Vite + TypeScript.

## Run

```bash
npm install
npm run dev
```

Open http://localhost:5173. The page boots **muted**; click the mute button in the bottom-left pill to start audio.

### Scripts

- `npm run dev` — Vite dev server with hot reload (port 5173)
- `npm run build` — typecheck + production build to `dist/`
- `npm run typecheck` — `tsc --noEmit`
- `npm run preview` — serve the built `dist/`

## What you see

A Blender-exported shop interior with hero objects (boombox, speaker, amp, table, monoblock chair, four cassettes on the table). Click a cassette to play its track through the boombox, spatialized via HRTF. Use the dev panel (top right) to toggle inside / outside, scrub between past and present, edit hero placements, tune the atmosphere, etc.

The outside ↔ inside transition is animated by a `TweenCameraMode` that lerps position + lookAt for ~1.6s before handing off to the destination camera (freeform outside, rails orbit inside).

### Three HUD pills

- **bottom-left** — mute toggle + master volume
- **bottom-center** — track inventory, lit per channel when something is playing
- **bottom-right** — hero count + current state

### Dev panel (top right)

Folder-grouped, with a primary view-toggle button at the very top:

- **state** — `target` (past / present), `progress` scrub, `duration`, snap / animate buttons, transition strategy dropdown
- **camera** — mode dropdown (`freeform` / `interior-walk` / `interior-orbit`), `save → positions.json`, mode-specific tunables
- **edit** — `edit hero` dropdown (translate / rotate / scale gizmo, **W / E / R** shortcuts), `save → manifest.json`
- **atmosphere** — preset (`morning-shaft` / `none`), shaft intensity / fog density / dust opacity / dust size / dust count sliders, per-shaft radius sliders, `edit shaft` handle gizmo, `save → morning-shaft.json`
- **audio** — mute, master vol, per-channel vols (ambient / music / narration / sfx)

## Persisted state

Three JSON files capture everything you tune live. All three round-trip via dev-only Vite middlewares (`apply: 'serve'` — they don't exist in production builds) and use schema-aware client formatters so the on-disk layout stays compact and human-editable.

| File | Endpoint | Owns |
|---|---|---|
| [`public/heroes/manifest.json`](public/heroes/manifest.json) | `POST /__lec/save-manifest` | Hero entries + per-state placements |
| [`public/atmosphere/morning-shaft.json`](public/atmosphere/morning-shaft.json) | `POST /__lec/save-atmosphere` | Shaft endpoints + radii + atmosphere tunables |
| [`public/camera/positions.json`](public/camera/positions.json) | `POST /__lec/save-camera` | Exterior pose + per-camera-mode tunables |

### Hero manifest schema

```json
{
  "heroes": [
    {
      "id": "hero_boombox",
      "url": "/heroes/hero_boombox.glb",
      "interactive": true,
      "placements": [
        { "state": "past", "position": [0.77, 0.82, -0.9], "rotation": [0, -1.05, 0] }
      ]
    }
  ]
}
```

Each placement carries `state`, optional `position` / `rotation` / `scale` (number or `[x,y,z]`), `visible`, `material_variant`, and `userData` (used by cassettes for `track_id` and `audio_source_hero_id`).

Heroes with **more than one placement** (e.g. the four cassettes) get wrapped in a `Group` at runtime. Each instance is selectable in the edit dropdown as `hero_cassette#0` … `#3`, and a bulk handle `hero_cassette#all` translates / rotates the entire row from one origin. Saving captures **world** transforms so any `#all` offset is baked into the children, then resets the group back to identity.

### Atmosphere schema

```json
{
  "shafts": [
    { "origin": [0.6, 2.0, -0.2], "aim": [-0.4, -0.4, 0.2], "radius": 2.0 }
  ],
  "shaftIntensity": 0.35,
  "fogDensity": 0.018,
  "dustOpacity": 0.65,
  "dustSize": 0.05,
  "dustCount": 800
}
```

`origin` is the door/window opening; `aim` is where the shaft splashes on the floor. The `edit shaft` dropdown attaches the gizmo to one of two colored sphere handles per shaft (yellow = origin, blue = aim) so you can drag endpoints with the same TransformControls used for heroes.

### Camera schema

```json
{
  "exterior": {
    "position": [5.94, 1.32, -1.56],
    "target": [2, 1.5, -1.6]
  },
  "tunables": {
    "freeform": { "damping": 0.05, "rotateSpeed": 1, "zoomSpeed": 1 },
    "interior-walk": { "t": 0, "speed": 0.0006, "smoothing": 0.1 },
    "interior-orbit": { "t": 0, "speed": 0.0006, "smoothing": 0.1 }
  }
}
```

The exterior pose is applied to the camera before the first frame renders. Each named camera mode's tunables are restored from `tunables[modeName]` (matched against `getTunables()` keys), so OrbitControls damping / rails wheel speed / saved scrub-position all survive a refresh.

## Architecture

Four pluggable systems sit on top of one committed convention. New behavior is added by editing data, not by changing the engine.

### Committed: `userData.state` tagging

Every mesh that participates in past / present swap carries `userData.state: "past" | "present" | "both"`. Heroes carry `hero_id` (unique string), `interactive` (boolean). Cassettes carry `track_id` (audio asset) and `audio_source_hero_id` (the boombox to play through). Convention is preserved through Blender Custom Properties → glTF userData. See [src/scene/tagging.ts](src/scene/tagging.ts).

### Pluggable: Transition

[src/transitions/transition.ts](src/transitions/transition.ts) — `init / update / dispose`. `OpacityCrossfade` (clones materials, fades by progress) and `InstantSwap` so far. Add one by implementing the interface and registering in [src/app.ts](src/app.ts).

### Pluggable: CameraMode

[src/camera/cameraMode.ts](src/camera/cameraMode.ts) — same pattern. `FreeformMode` (OrbitControls with a persistent orbit pivot), `RailsMode` (CatmullRom curve walk with wheel-driven speed), `TweenCameraMode` (transient animator that lerps between two poses and hands off via `onComplete`). Each declares its own tunables via `getTunables()` — the dev panel rebuilds the slider list when you switch modes.

### Pluggable: Atmosphere

[src/atmosphere/atmosphere.ts](src/atmosphere/atmosphere.ts) — same again. `MorningShaft` swaps in `FogExp2`, draws shaft cones with an additive shader (view-aligned + along-shaft falloff), and runs a `Points` dust system with CPU-driven drift and wraparound on a room AABB. `NoAtmosphere` is the no-op. Both restore prior fog on dispose.

### Data-driven: InteractionEngine

[src/interaction/rules.ts](src/interaction/rules.ts) — declarative behavior. Each rule matches an event (`click` / `hoverIn` / `hoverOut` / `load`) plus optional `heroId` / `heroIdPrefix` / `whenState` filters and fires actions ([src/interaction/actions.ts](src/interaction/actions.ts)):

- `audio.play`, `audio.playFromUserData` — read asset id from clicked object's `userData[key]`
- `audio.stop`, `audio.stopChannel`
- `state.set`, `camera.setMode`
- `log`, `callback` (escape hatch)

The `at` field for spatialization can be a fixed `position`, a `heroId` to resolve, or `heroIdFromUserData` (one rule covers all cassettes — each carries its own `audio_source_hero_id` pointing at the boombox).

`heroIdPrefix` does a `startsWith` match — so `'hero_cassette'` matches `hero_cassette#0`, `#1`, etc. without needing per-instance rules.

### Audio: channels, exclusivity, spatialization

[src/audio/audioManager.ts](src/audio/audioManager.ts) wraps Web Audio with named channels (`ambient` / `music` / `narration` / `sfx`), each with its own gain node. The playing map is keyed by `(id, channel)` so the same buffer can run on multiple channels simultaneously.

- `exclusive: true` on a play call fades out other tracks on the same channel — that's how cassette clicks swap cleanly
- `at` enables HRTF spatialization with `panningModel: 'HRTF'`, `distanceModel: 'inverse'`, `refDistance: 2`, `rolloffFactor: 1`. Listener tracks the camera each frame via `syncSpatial(camera)`
- Master gain boots at 0 (muted). `setMuted(false)` restores the preferred level; volumes persist in `sessionStorage` (channels too). The muted flag itself does **not** persist — every page load starts muted, by design

## Layout

```
public/
  atmosphere/
    morning-shaft.json        shafts + tunables + dust count
  audio/
    test_music_*.{mp3,m4a}    placeholder tracks
  camera/
    positions.json            exterior pose + per-mode tunables
  heroes/
    manifest.json             hero entries + placements
    hero_*.glb                exported heroes (gitignored)
  scene/
    shared.glb                Blender scene export (gitignored)
src/
  app.ts                      top-level wiring, save handlers, HUD pills
  main.ts                     entry
  state/                      past/present controller
  transitions/                OpacityCrossfade, InstantSwap
  camera/                     FreeformMode, RailsMode, TweenCameraMode
  scene/                      scene graph, tagging helpers
  loaders/                    GLBLoader (Draco), HeroLoader (multi-placement → Group)
  interaction/                pointer raycaster, engine, rules, actions
  audio/                      Web Audio wrapper, asset manifest
  atmosphere/                 MorningShaft, NoAtmosphere, Atmosphere interface
  debug/                      lil-gui dev panel
scripts/
  blender_auto_tag.py         walks scene and sets state / interactive / hero_id Custom Properties
  find_heavy_meshes.py        Rhino: list heaviest meshes + duplicate groups
  select_by_id.py             Rhino: select objects by pasted GUIDs
  select_duplicate_extras.py  Rhino: preselect dupes (keeping one canonical) for deletion
```

## Asset pipeline

The scene is being **rebuilt by hand** in Blender from greybox primitives — proportional shells get named with hero ids, then I run a `bpy` script that bevels / unwraps / builds procedural PBR materials / sets origins / applies transforms / exports per-bucket GLBs. The Rhino import is reference only.

### Authoring conventions

Custom Properties (`Object → Properties → Custom Properties`):

| Property | Value | Required on |
|---|---|---|
| `state` | `"past"` / `"present"` / `"both"` | every mesh |
| `interactive` | `true` | heroes only |
| `hero_id` | unique string (e.g. `"hero_boombox"`) | heroes only |
| `track_id` | audio asset id | cassettes |
| `audio_source_hero_id` | `hero_id` of the boombox to play through | cassettes |

Link object data (`Ctrl+L → Object Data`) for repeated props so the GLB ships one mesh per kind.

### Export from Blender

Per-bucket binary `.glb` with Draco compression. Check the glTF exporter dialog:

- ☑️ **Custom Properties** — preserves the tagging convention through to glTF userData
- ☑️ **Apply Modifiers**
- Draco compression on, level 6

### Post-export compression

```bash
gltf-transform optimize input.glb output.glb --compress draco --texture-compress webp --simplify false
```

`--simplify false` preserves whatever decimation you already did in Blender (run this conservatively so artifacts stay tunable).

## Console debugging

`window.__lec` exposes the live subsystems for DevTools poking:

```javascript
__lec.heroLookup.get('hero_boombox')            // Object3D
__lec.morningShaft.getCurrentConfig()           // shafts + tunables snapshot
__lec.audio.listPlaying()                       // [{id, channel}, ...]
__lec.atmospheres                               // { 'morning-shaft', 'none' }
__lec.activeCamera                              // current CameraMode (getter)
__lec.activeAtmosphere                          // current Atmosphere (getter)
__lec.transformControls.object                  // currently attached gizmo target
```

## Adjacent audio considerations not yet built

Architected for but not implemented:

- **Reverb (`ConvolverNode` + IR)**: different impulse responses for past (lively, hard surfaces) vs present (muted, sitaara fabric on walls)
- **Outside / inside muffling**: a low-pass filter wired in before the master, toggled during the entry transition
- **Sewing machine purr / street ambient**: lives on the `ambient` channel (already wired, currently idle). Will coexist with the music channel; no engine changes needed

## Notes

- Draco decoder is loaded from `https://www.gstatic.com/draco/versioned/decoders/1.5.6/`. Vendor locally before shipping.
- `OpacityCrossfade` clones materials per mesh, which defeats `InstancedMesh` sharing. Real assets should use a shader uniform / per-instance attribute or a different transition strategy.
- All save endpoints use `apply: 'serve'` and are path-pinned. They do not exist in `npm run build` output.
