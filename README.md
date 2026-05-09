# Like Every Cloud

Realtime web scene for the Like Every Cloud project — interior of a Chad cassette shop with two time states (past / present) and interactive hero objects.

three.js + Vite + TypeScript.

## Run

```bash
npm install
npm run dev
```

Open http://localhost:5173.

### Scripts

- `npm run dev` — Vite dev server with hot reload (port 5173)
- `npm run build` — typecheck + production build to `dist/`
- `npm run typecheck` — `tsc --noEmit`
- `npm run preview` — serve the built `dist/`

## What's there

A placeholder scene stands in for the eventual GLB assets — a 6×6×3m room with shelves on each wall, a counter at the back, and two boombox stand-ins. Past objects are warm brown, present objects are cool blue, shared architecture is neutral.

The dev panel (top right) controls everything via three folders:

- **State** — switch target between `past` / `present`, scrub progress 0..1, set transition duration. Snap or animate.
- **Transition** — swap the visual strategy used when state changes. `instant-swap` (baseline) or `opacity-crossfade (sample)`. The actual UX is *not committed yet* — this is the swap point.
- **Camera** — swap between camera modes:
  - `freeform` — orbit/zoom (OrbitControls)
  - `rails-walk` — first-person along a closed path; scroll wheel advances
  - `rails-orbit` — same path, always looks at room center

Click the boombox heroes to log their `hero_id` to the console.

## Architecture

Three pluggable systems sit on top of one committed convention.

### Committed: `userData.state` tagging

Every mesh that participates in past/present swap carries `userData.state: "past" | "present" | "both"`. Same convention preserved through Blender Custom Properties → glTF userData. See [src/scene/tagging.ts](src/scene/tagging.ts).

### Pluggable: Transition

Implementations of `Transition` ([src/transitions/transition.ts](src/transitions/transition.ts)) decide what state changes look like. To add one: implement the interface, register it in the `transitions` record in [src/app.ts](src/app.ts).

### Pluggable: CameraMode

Same pattern, [src/camera/cameraMode.ts](src/camera/cameraMode.ts). `RailsMode` takes a `RailsConfig` with waypoints and a look-at strategy (`'ahead'` or a fixed `Vector3`). Path waypoints are defined inline in [src/app.ts](src/app.ts).

## Layout

```
public/
  scene/         GLB scene buckets land here (past_shell.glb, etc.)
  heroes/
    manifest.json   hero positions + state + interaction metadata
src/
  app.ts                top-level wiring
  main.ts               entry
  state/                past/present controller
  transitions/          state-change strategies
  camera/               camera mode strategies
  scene/                scene graph + state tagging helpers
  loaders/              GLBLoader (Draco), HeroLoader
  interaction/          pointer raycaster
  placeholder/          placeholder geometry — delete once GLBs land
  debug/                lil-gui dev panel
```

## Asset pipeline

Rhino 8 → Blender → glTF → three.js:

1. Organize Rhino scene into layer buckets (`PAST/SHELL`, `PAST/PROPS`, `PAST/HEROES`, `PRESENT/*`, `SHARED`).
2. Split into per-bucket `.3dm`; mesh and export FBX per bucket.
3. In Blender: import per bucket into Collections, link object data for repeated props, tag with Custom Properties (`state`, `interactive`, `hero_id`).
4. Export each bucket as binary `.glb` with Draco compression + Custom Properties → drop in `public/scene/`.
5. Heroes export individually with manifest entries → drop in `public/heroes/`.

Once GLBs land, replace `buildPlaceholderScene()` in [src/app.ts](src/app.ts) with `GLBLoader` calls.

## Notes

- Draco decoder is currently loaded from `https://www.gstatic.com/draco/versioned/decoders/1.5.6/`. Vendor locally before shipping.
- `OpacityCrossfade` clones materials per mesh, which defeats InstancedMesh sharing. Real assets should use a smarter approach (shader uniform / per-instance attribute) or a different transition.
