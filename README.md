# Like Every Cloud

Realtime web scene for the Like Every Cloud project — interior of a Chad cassette shop with two time states (past / present), interactive cassettes, spatialized audio, and a pluggable interaction system.

three.js + Vite + TypeScript.

## Run

```bash
npm install
npm run dev
```

Open http://localhost:5173. The page boots **muted**; click the mute button in the bottom-left pill to start.

### Scripts

- `npm run dev` — Vite dev server with hot reload (port 5173)
- `npm run build` — typecheck + production build to `dist/`
- `npm run typecheck` — `tsc --noEmit`
- `npm run preview` — serve the built `dist/`

## What you see

A placeholder 6×6×3m room stands in for the eventual GLB assets — back wall, left wall (past shelves, warm brown), right wall (present shelves, cool gray), counter, two boombox stand-ins on the counter, and **30 labeled cassettes** (15 per side) spread across the shelves. Past objects are warm brown, present are cool blue, shared architecture is neutral.

### Audio

- Bottom-left pill: master volume + mute toggle. Volume is always editable, including while muted. Settings persist across reloads in `sessionStorage`; mute resets on each reload.
- On unmute the **shop music** starts looping (placeholder track — Annour's "playing it full blaring" when you walk in).
- Click any cassette → its track replaces the shop music, **spatialized** to the corresponding boombox via HRTF panning. The active boombox glows (warm amber on past, cool blue on present).
- Click either boombox → halts the music channel cleanly.
- The dev panel exposes master + per-channel volumes for `ambient` / `music` / `narration` / `sfx`.

### Dev panel (top right)

Flat layout, one global collapse. Sections from top to bottom:

- **State** — `target`, `progress` (scrub 0..1), `duration`, `snap → past`, `snap → present`, `animate to other`
- **Transition** — strategy dropdown: `opacity-crossfade` (default) or `instant-swap`
- **Audio** — `muted`, master vol, per-channel vols, `resume audio`
- **Camera** — mode dropdown (`freeform`, `rails-walk`, `rails-orbit`) + mode-specific tunables (rails: `t` / wheel speed / smoothing; freeform: damping / rotate speed / zoom speed)

## Architecture

Three pluggable systems sit on top of one committed convention. New behavior is added by editing data, not by changing the engine.

### Committed: `userData.state` tagging

Every mesh that participates in past/present swap carries `userData.state: "past" | "present" | "both"`. Cassettes also carry `userData.track_id` (which audio asset to play) and `userData.audio_source_hero_id` (which boombox to play through). Same convention preserved through Blender Custom Properties → glTF userData. See [src/scene/tagging.ts](src/scene/tagging.ts).

### Pluggable: Transition

Implementations of `Transition` ([src/transitions/transition.ts](src/transitions/transition.ts)) decide what state changes look like. To add one: implement the interface, register it in the `transitions` record in [src/app.ts](src/app.ts).

### Pluggable: CameraMode

Same pattern, [src/camera/cameraMode.ts](src/camera/cameraMode.ts). `RailsMode` takes a `RailsConfig` with waypoints and a look-at strategy (`'ahead'` or a fixed `Vector3`). Each mode declares its own tunables via `getTunables()` — the dev panel rebuilds the slider list when you switch modes.

### Data-driven: InteractionEngine

The cassette-and-boombox behavior is **not** hardcoded. It's declared in [src/interaction/rules.ts](src/interaction/rules.ts) as a list of `InteractionRule`s. Each rule matches an event (`click`, `hoverIn`, `hoverOut`, or `load`) plus optional `heroId` / `heroIdPrefix` / `whenState` filters, and fires a list of `Action`s.

Available actions ([src/interaction/actions.ts](src/interaction/actions.ts)):

- `audio.play` — play an asset with optional `loop`, `volume`, `fadeIn`, `channel`, `exclusive`, `at` (spatial origin)
- `audio.playFromUserData` — same, but read the asset id from the clicked object's `userData[key]` (one rule covers all 30 cassettes)
- `audio.stop` — stop a specific asset across channels
- `audio.stopChannel` — halt every track on a channel (this is what the boombox click does)
- `state.set` — set the state controller's target
- `camera.setMode` — switch camera modes
- `log` — console diagnostic
- `callback` — escape hatch with `(info: EventInfo) => void`

The `at` field for spatialization can be a fixed `position`, a `heroId` to resolve, or `heroIdFromUserData` to read a hero reference off the clicked object. That last form is how every cassette plays through the boombox in its own state without per-cassette wiring.

### Audio: channels, exclusivity, spatialization

[src/audio/audioManager.ts](src/audio/audioManager.ts) wraps Web Audio with named channels (`ambient` / `music` / `narration` / `sfx`), each with its own gain node. The playing map is keyed by `(id, channel)` so the same buffer can run on multiple channels simultaneously.

- `exclusive: true` on a play call fades out other tracks on the same channel — that's how cassette clicks swap cleanly without layering.
- `at` enables HRTF spatialization: `panningModel: 'HRTF'`, `distanceModel: 'inverse'`, `refDistance: 2`, `rolloffFactor: 1`. Listener orientation tracks the camera each frame via `syncSpatial(camera)` called from the render tick.
- Master gain starts at 0 (muted). `setMuted(false)` restores the preferred level, which persists in `sessionStorage` (channels too). The muted flag itself does not persist — every page load starts muted, by design.

## Layout

```
public/
  scene/                    GLB scene buckets land here (past_shell.glb, etc.)
  heroes/
    manifest.json           hero positions + state + interaction metadata
  audio/                    test tracks (mp3/m4a) — replaced by curated final assets
src/
  app.ts                    top-level wiring + bottom-left audio controls
  main.ts                   entry
  state/                    past/present controller
  transitions/              state-change strategies (OpacityCrossfade, InstantSwap)
  camera/                   camera mode strategies + tunables
  scene/                    scene graph + state-tagging helpers
  loaders/                  GLBLoader (Draco), HeroLoader
  interaction/
    pointer.ts              raycaster, event emitter
    actions.ts              Action + InteractionRule types
    engine.ts               resolves rule matches and runs actions
    rules.ts                declarative behavior — the file you edit to change UX
  audio/
    audioManager.ts         Web Audio wrapper, channels, HRTF panning
    manifest.ts             preloaded assets
  placeholder/              placeholder geometry — delete once GLBs land
  debug/                    lil-gui dev panel
scripts/                    Rhino Python utilities (run via Rhino's Script Editor)
  find_heavy_meshes.py      list heaviest meshes + duplicate groups
  select_by_id.py           select objects by pasted GUIDs
  select_duplicate_extras.py preselect dupes (keeping one canonical) for deletion
docs/
  brief.md                  director brief + meeting notes
```

## Asset pipeline

The Rhino reference geometry has been imported into Blender, but most of the shop is being **rebuilt by hand** in Blender rather than cleaned up from the import. Treat the inherited Rhino content as reference — pull bits you want to keep, model the rest fresh.

### Authoring in Blender

Organize per state, with shared architecture in its own collection:

- `PAST/SHELL`, `PAST/PROPS`, `PAST/HEROES`
- `PRESENT/SHELL`, `PRESENT/PROPS`, `PRESENT/HEROES`
- `SHARED` — architecture (floor, walls, ceiling) present in both states

For each object that participates in state-swap, set Custom Properties (`Object → Properties → Custom Properties`):

| Property                  | Value                                | Required on   |
| ------------------------- | ------------------------------------ | ------------- |
| `state`                   | `"past"` / `"present"` / `"both"`    | every mesh    |
| `interactive`             | `true`                               | heroes only   |
| `hero_id`                 | unique string, e.g. `"hero_boombox_past"` | heroes only   |
| `track_id`                | audio asset id, e.g. `"test_music_3"` | cassettes     |
| `audio_source_hero_id`    | `hero_id` of the boombox to play through | cassettes  |

Link object data (`Ctrl+L → Object Data`) for any repeated prop (cassettes, books, glasses, tea cups) so the exported GLB only ships one mesh per kind.

### Cassette wall

The cassette wall is **data-driven, not modeled**. Today the runtime spawns 30 cassettes from a `(label, track_id)` table in [src/placeholder/placeholderScene.ts](src/placeholder/placeholderScene.ts). For the real asset:

- Model **one** cassette mesh.
- Either ship it as a hero and let the runtime spawn the wall from a manifest, or bake the wall directly into a `past_props` / `present_props` GLB with each cassette carrying its own `track_id` and `audio_source_hero_id` Custom Properties.

The first option keeps the wall content editable without re-export.

### Export from Blender

Per-bucket binary `.glb` with Draco compression. Check the glTF exporter dialog:

- ☑️ **Custom Properties** — preserves `state` / `interactive` / `hero_id` / etc. as glTF `userData`
- ☑️ **Apply Modifiers**
- Draco compression on, level 6

Files land in:

- `public/scene/past_shell.glb`, `past_props.glb`, `present_shell.glb`, `present_props.glb`, `shared.glb`
- `public/heroes/<hero_id>.glb`, referenced from `public/heroes/manifest.json`

### Runtime swap-in

Once GLBs land, replace `buildPlaceholderScene()` in [src/app.ts](src/app.ts) with `GLBLoader` calls. The loader is already wired in [src/loaders/glbLoader.ts](src/loaders/glbLoader.ts) and the hero loader in [src/loaders/heroLoader.ts](src/loaders/heroLoader.ts) reads the manifest. No engine changes needed — the interaction rules already match by `hero_id` and prefix, so existing rules keep working as long as `hero_id`s line up.

### Rhino utilities

[`scripts/`](scripts) holds Python tools written against the original 1GB `.3dm` (`find_heavy_meshes.py`, `select_by_id.py`, `select_duplicate_extras.py`, `make_pipeline_diagram.py`). They're kept around for one-off trips back to the Rhino file — handy if you decide to pull a specific scanned mesh out rather than rebuild it.

## Adjacent audio considerations not yet built

Architected for but not implemented:

- **Reverb (`ConvolverNode` + IR)**: different impulse responses for past (lively, hard surfaces) vs present (muted, sitaara fabric on walls).
- **Outside/inside muffling**: a low-pass filter wired in before the master, toggled during the entry transition.
- **Sewing machine purr / street ambient**: lives on the `ambient` channel (already wired, currently idle). Will coexist with the music channel; no engine changes needed.

## Notes

- Draco decoder is currently loaded from `https://www.gstatic.com/draco/versioned/decoders/1.5.6/`. Vendor locally before shipping.
- `OpacityCrossfade` clones materials per mesh, which defeats InstancedMesh sharing. Real assets should use a smarter approach (shader uniform / per-instance attribute) or a different transition.
- Test audio in `public/audio/` is placeholder. Final tracks need licensing — see `docs/brief.md` for the four options under discussion.
