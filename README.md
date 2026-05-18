# Like Every Cloud

Realtime web scene for the Like Every Cloud project — interior of a Chad cassette shop with two time states (past / present), spatialized audio, a data-driven interaction engine, atmospheric volumetrics, and a dev panel for editing the scene in the browser.

three.js + Vite + TypeScript.

**Live demo:** _(URL will land here after the first Cloudflare Pages deploy — see Hosting below)_

---

## First-time setup (no technical background needed)

If you've never used GitHub, Terminal, or Node before, follow these steps in order. You only do most of them once. Skip ahead to **Run** below if you already have everything installed.

### Step 1 — Install GitHub Desktop

GitHub Desktop is a free app that copies code from the internet onto your computer.

1. Open a web browser and go to **<https://desktop.github.com>**.
2. Click **Download for macOS** (or **Download for Windows** if you're on Windows).
3. Open the file your browser downloaded.
   - **Mac:** drag the GitHub Desktop icon into your **Applications** folder.
   - **Windows:** double-click the installer and click through the prompts.
4. Open GitHub Desktop. The first time you launch it, it asks you to sign in to GitHub. If you don't have a GitHub account, click the link to create one (it's free, just an email + password).

### Step 2 — Install Node.js

Node.js is the program that actually runs this project's code. It comes with `npm`, which is a tool that downloads libraries.

1. Go to **<https://nodejs.org>**.
2. Click the big green button labeled **LTS** (this is the stable version).
3. Open the file your browser downloaded and click through the installer using all the defaults. Restart your computer if it asks.

### Step 3 — Download the project with GitHub Desktop

1. Open GitHub Desktop.
2. From the menu bar, choose **File → Clone Repository…** (Mac: ⌘⇧O).
3. Click the **URL** tab in the dialog that appears.
4. In the URL box, paste:
   ```
   https://github.com/malmutairiturki/Like-Every-Cloud
   ```
5. Under **Local Path**, GitHub Desktop suggests a folder like `Documents/GitHub/Like-Every-Cloud`. Leave it as-is (you'll need to know this path in a moment).
6. Click **Clone**. Wait for the progress bar to finish — it might take a minute.

### Step 4 — Open Terminal

Terminal is a text window where you type commands to your computer.

- **Mac:** press **⌘ Space** to open Spotlight, type `Terminal`, and press **Return**. A window with a blinking cursor opens.
- **Windows:** open the **Start menu**, type `PowerShell`, and press Enter.

### Step 5 — Move into the project folder

You need to tell Terminal which folder to work in.

1. Type these two letters and a space: `cd ` ← **with a space after, and do NOT press Return yet.**
2. Open **Finder** (Mac) or **File Explorer** (Windows) and find the folder GitHub Desktop made — usually `Documents/GitHub/Like-Every-Cloud`.
3. **Drag that folder onto the Terminal window.** Terminal will paste the full path for you automatically.
4. Now press **Return**. Your Terminal prompt should now show `Like-Every-Cloud` somewhere in the line — that means you're inside the project.

### Step 6 — Install the project's dependencies

Type this and press **Return**:

```bash
npm install
```

This downloads all the libraries the project needs. The first time, it takes 1–3 minutes and prints a lot of text. You only need to do this once (or again whenever the project is updated and someone tells you to).

### Step 7 — Start the project

Type this and press **Return**:

```bash
npm run dev
```

After a moment, you'll see a line that says something like:

```
  ➜  Local:   http://localhost:5173/
```

### Step 8 — Open it in your browser

Open Chrome, Safari, or Firefox and go to:

```
http://localhost:5173
```

The scene loads. The page boots **muted** — click the mute button in the bottom-left pill to start audio.

### Stopping and restarting

- **To stop the project:** click back on the Terminal window and press **Control + C** (the letter C, with the Control key — same on Mac and Windows). The prompt comes back.
- **To start it again later:** open Terminal, drag the project folder onto it after typing `cd `, press Return, then type `npm run dev` and press Return. You can skip `npm install` unless someone tells you the project's dependencies changed.

### If something goes wrong

- **`command not found: npm`** — Node.js isn't installed (or didn't finish installing). Redo Step 2 and restart Terminal.
- **`command not found: cd`** — extremely unlikely; you probably typed something else. Try again.
- **The browser says "can't connect"** — make sure Terminal is still running and showing `Local: http://localhost:5173/`. If it's not, redo Step 7.
- **Port 5173 already in use** — you already have the project running in another Terminal window. Close that one (Control + C in it) and try again.

---

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
- `npm run compress` — re-compresses every runtime GLB in place (Draco mesh + WebP textures). Run after re-exporting from Blender — drops the bundle ~91%. `npm run compress hero_table` runs on just one file.

## Hosting

The repo is wired to deploy to **Cloudflare Pages**. Every push to `main` triggers an automatic rebuild + deploy — directors visit the URL, no clone or install needed on their side.

### First-time setup (one-time, per Cloudflare account)

1. Sign in to **<https://dash.cloudflare.com>** (the GitHub-OAuth option uses no extra credentials).
2. Left nav → **Workers & Pages** → **Pages** tab → **Connect to Git**.
3. Authorize Cloudflare to read this repo (only this repo — don't grant org-wide unless that's what you want).
4. Build configuration:
   - **Framework preset:** Vite
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`
   - **Root directory:** _(leave blank — repo root)_
   - **Environment variables:** none required
5. **Save and Deploy.** First build takes ~2 minutes. After it succeeds you get a URL like `like-every-cloud.pages.dev`.
6. Add the URL to the **Live demo** line at the top of this README and commit.

### Subsequent deploys

Just push to `main`. Cloudflare watches the branch and redeploys automatically — usually live within ~90 seconds. Pull requests get their own preview URL so unfinished work can be reviewed before merging.

### Hand-off to a new Cloudflare account

If directors want their own copy on their own Cloudflare account: fork the repo, repeat the steps above pointing at the fork. No code changes needed.

## What you see

A Blender-exported shop interior with hero objects (boombox, speaker, amp, table, monoblock chair, four cassettes on the table). Click a cassette to play its track through the boombox, spatialized via HRTF.

The outside ↔ inside transition is animated by a `TweenCameraMode` that lerps position + lookAt for ~1.6s before handing off to the destination camera (freeform outside, rails orbit inside).

### Two views

- **Demo view** — http://localhost:5173 — what visitors see. Player UI only: `go inside →` pill (top center), mute + master volume (bottom left), track inventory (bottom center). No dev tooling, no scene markers.
- **Dev view** — http://localhost:5173/?dev=1 — adds the full lil-gui authoring panel (top right), the per-hero state radio panel (bottom right), the green/cyan camera anchor markers in the scene, and the hover-label chip. Same scene, different UI.

### Player HUD (always visible)

- **top-center** — `go inside → / ← go outside` view toggle
- **bottom-left** — mute toggle + master volume
- **bottom-center** — track inventory, lit per channel when something is playing

### Dev panel (top right, `?dev=1` only)

Folder-grouped, with a primary view-toggle button at the very top:

- **state** — `target` (past / present), `progress` scrub, `duration`, snap / animate buttons, transition strategy dropdown
- **camera** — mode dropdown (`freeform` / `interior-walk` / `interior-orbit`), mode-specific tunables, **bookmarks** (`go to bookmark` dropdown + `save bookmark…` + `delete current bookmark`), wall-cull on / offset, `set outside view here` (camera.position + camera.lookAt → exterior pose), `set doorway here` (camera.position → doorway waypoint). The green and cyan dots in the scene are read-only visualizations of the saved positions — they follow whatever you save.
- **edit** — `edit hero` dropdown, `gizmo` mode toggle (translate / rotate — also **W** / **E** keys), **⌘Z / ⌃Z** to undo a drag, `save → manifest.json`. Only one gizmo is visible at a time so translate can't accidentally trigger rotation.
- **atmosphere** — preset (`morning-shaft` / `none`), shaft intensity / fog density / dust opacity / dust size / dust count sliders, per-shaft radius sliders, `edit shaft` handle gizmo, `save → morning-shaft.json`
- **audio** — mute, master vol, per-channel vols (ambient / music / narration / sfx)

In-scene helpers: hover any interactive object to see a small chip with its `hero_id`. Click a track chip in the bottom tracks bar to audition it on the `sfx` channel.

## Persisted state

Three JSON files capture everything you tune live. All three round-trip via dev-only Vite middlewares (`apply: 'serve'` — they don't exist in production builds) and use schema-aware client formatters so the on-disk layout stays compact and human-editable.

| File | Endpoint | Owns |
|---|---|---|
| [`public/heroes/manifest.json`](public/heroes/manifest.json) | `POST /__lec/save-manifest` | Hero entries + per-state placements |
| [`public/atmosphere/morning-shaft.json`](public/atmosphere/morning-shaft.json) | `POST /__lec/save-atmosphere` | Shaft endpoints + radii + atmosphere tunables |
| [`public/camera/positions.json`](public/camera/positions.json) | `POST /__lec/save-camera` | Exterior pose + doorway + AABB + cull + per-mode tunables + bookmarks |
| [`public/states.json`](public/states.json) | _(read-only)_ | Per-state ambient music id + volume |

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
  "doorway": [0.5, 1.3, 2.0],
  "interiorAABB": {
    "min": [-2.75, -0.5, -3.2],
    "max": [1, 3.5, 2.5]
  },
  "cull": { "offset": 0, "enabled": true },
  "tunables": {
    "freeform": { "damping": 0.05, "rotateSpeed": 1, "zoomSpeed": 1 },
    "interior-walk": { "t": 0, "speed": 0.0006, "smoothing": 0.1 },
    "interior-orbit": { "t": 0, "speed": 0.0006, "smoothing": 0.1 }
  },
  "bookmarks": {
    "back-corner": { "position": [-1.8, 1.2, -1.6], "target": [-0.4, 1.0, 0.5] }
  }
}
```

The exterior pose is applied to the camera before the first frame renders. `doorway` is the waypoint the entry/exit tween curves through. `interiorAABB` defines the inside of the building for the wall-cull system. `cull` carries the runtime cull tunables. Each named camera mode's `tunables` are restored from `tunables[modeName]` (matched against `getTunables()` keys), so OrbitControls damping / rails wheel speed / saved scrub-position all survive a refresh. The optional `bookmarks` map carries named camera poses surfaced in the dev panel as `go to bookmark`; the tween auto-routes through the doorway when a bookmark crosses the interior wall.

### State config schema

```json
{
  "past":    { "ambient": "test_music_1", "ambientVolume": 0.6 },
  "present": { "ambient": "test_music_5", "ambientVolume": 0.5 }
}
```

Per-state ambient music is data-driven. On startup [`src/state/stateConfig.ts`](src/state/stateConfig.ts) loads `public/states.json` and synthesizes `stateEnter` rules (one per state with an `ambient`) that play on the `music` channel, spatialized to `hero_speaker`. To change the music a state plays, edit the file — no code change required.

See [Camera & view state](#camera--view-state) below for the full state machine.

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

### Camera & view state

Two layers sit on top of each other: a high-level **view** (outside vs inside) and a lower-level **camera mode** (how the camera is currently being driven). The view drives which mode gets installed; the mode owns frame-to-frame motion.

#### View states

| View | Default mode | Animated entry destination |
|---|---|---|
| **exterior** | `freeform` | `exteriorPos` → `exteriorTarget` |
| **interior** | `interior-orbit` | `interiorPath[0]` → `interiorCenter` |

`getView()` returns the current, `setView(v)` triggers a transition. Not persisted — every page load opens at `exterior`.

#### Camera modes

Four implementations of `CameraMode` (`init / update / dispose / getTunables`):

| Mode | Class | Behavior | Persisted tunables |
|---|---|---|---|
| `freeform` | `FreeformMode` | OrbitControls — mouse-drag = orbit, right-drag = pan, wheel = zoom. Pivot is `exteriorTarget` by default; `setEditTarget` overrides it with a point on the camera's forward ray so the view doesn't jump when you start editing. | `damping`, `rotateSpeed`, `zoomSpeed` |
| `interior-walk` | `RailsMode` | Closed Catmull-Rom curve through `interiorPath`. Wheel scrolls along the curve via `targetT`, damped by `smoothing`. Look-at follows the next path point ("ahead"). | `t`, `speed`, `smoothing` |
| `interior-orbit` | `RailsMode` | Same path as walk, but look-at locked to `interiorCenter`. Feels like an orbit. | `t`, `speed`, `smoothing` |
| `(transient)` | `TweenCameraMode` | Smootherstep lerp between two poses, optionally via a `doorway` waypoint (CatmullRom over 3 points). Hands off to a destination mode via `onComplete`. Lives only during the entry/exit animation. | — |

#### Transition flow

| User action | What runs |
|---|---|
| Click **`go inside →`** / **`← go outside`** | `setView(target)` snapshots current pose → if entering interior, resets both rails cameras' `t=0` → constructs a `TweenCameraMode` with `doorway` as waypoint → after `VIEW_TWEEN_DURATION` (1.6s), `setCamera(destName)` swaps in `freeform` (outside) or `interior-orbit` (inside) |
| Pick a **camera mode** in the dropdown | `setCamera(name)` — disposes current, inits new. No tween. |
| Pick a hero / shaft handle / camera handle | Auto-switches to `freeform`, keeps current camera transform, parks the orbit pivot on the forward ray at the gizmo target's depth |
| In **freeform interior**, camera leaves `interiorAABB` | Wall-cull clip plane activates: perpendicular to camera→room-center at the AABB face closest to camera, offset by `cullSettings.offset`. Inert in every other view/mode. |

#### Wall cull (clipping plane)

When in interior view AND active mode is `freeform` AND camera is outside `interiorAABB`, a single `THREE.Plane` is repositioned each frame perpendicular to the camera→room-center vector, sitting at the AABB face closest to the camera plus the user-tunable `offset`. WebGL discards every fragment on the camera side of that plane via per-material `clippingPlanes`. The plane is attached to every photoscan material at boot; heroes are excluded so they never clip. Inert in every other state (entry/exit tween + rails + camera-inside-AABB + exterior view).

#### Source vectors

| Vector | Source | Used by |
|---|---|---|
| `exteriorPos` | positions.json `exterior.position` | tween destination (outside), boot-time `camera.position` |
| `exteriorTarget` | positions.json `exterior.target` | freeform OrbitControls target, tween lookAt destination |
| `doorway` | positions.json `doorway` | tween waypoint between exterior↔interior |
| `interiorAABB` | positions.json `interiorAABB` | wall-cull boundary |
| `cullSettings` | positions.json `cull` | clip-plane on/off + offset |
| `interiorPath[0..5]` | hardcoded in [src/app.ts](src/app.ts) | RailsMode curve (shared by walk + orbit) |
| `interiorCenter` | hardcoded in [src/app.ts](src/app.ts) | interior-orbit look-at |

#### Persistence

| What | Where | Saved by |
|---|---|---|
| Exterior pose | positions.json `exterior` | `set outside view here` |
| Doorway waypoint | positions.json `doorway` | `set doorway here` |
| Interior AABB | positions.json `interiorAABB` | either save button (rewrites full file) |
| Wall-cull offset + enabled | positions.json `cull` | either save button (rewrites full file) |
| Per-mode tunables | positions.json `tunables[modeName]` | either save button (rewrites full file) |
| Camera bookmarks | positions.json `bookmarks[name]` | `save bookmark…` / `delete current bookmark` |
| Hero placements + state tags | heroes/manifest.json | `save → manifest.json` |
| Atmosphere shafts + tunables | atmosphere/morning-shaft.json | `save → morning-shaft.json` |
| Per-state ambient music | states.json | hand-edited (no save UI) |
| Audio master + channel volumes | `sessionStorage` (per-tab) | every slider edit |

Everything else (selected hero/handle, current view, current state target, transition progress) is session-only.

#### Gotchas worth knowing

- **Rails `t` is persisted.** Scroll halfway around the interior loop and save, next session opens at that scrub point. The view-toggle resets `t=0` on entry so the rails picks up at the entrance regardless.
- **The tween disposes the previous mode** before animating. Click "go inside" mid-tween and the in-flight tween is disposed; a new one starts from wherever the camera currently is.
- **`OrbitControls` only exists during freeform.** `currentTarget()` falls back to a point on the forward ray for rails / tween modes when the tween needs a starting lookAt.

## Layout

```
public/
  atmosphere/
    morning-shaft.json        shafts + tunables + dust count
  audio/
    test_music_*.{mp3,m4a}    placeholder tracks
  camera/
    positions.json            exterior pose + per-mode tunables + bookmarks
  heroes/
    manifest.json             hero entries + placements
    hero_*.glb                exported heroes (gitignored)
  scene/
    shared.glb                Blender scene export (gitignored)
  states.json                 per-state ambient music + volume
src/
  app.ts                      top-level wiring + the tick loop
  main.ts                     entry
  state/                      past/present controller + states.json loader
  transitions/                OpacityCrossfade, InstantSwap
  camera/                     FreeformMode, RailsMode, TweenCameraMode
  scene/                      scene graph, tagging, wallCull, cameraHandles, gizmoUndo
  loaders/                    GLBLoader (Draco), HeroLoader (multi-placement → Group)
  interaction/                pointer raycaster, engine, rules, actions
  audio/                      Web Audio wrapper, asset manifest
  persist/                    saveFlows (custom JSON formatters + middleware POSTs)
  ui/                         audioControls, tracksBar, heroStatePanel, hoverLabel
  debug/                      debugPanel (lil-gui)
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
