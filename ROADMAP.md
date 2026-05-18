# Roadmap

Where the project is headed, in priority tiers. Living doc — re-prioritize as we go.

Status legend: ⏳ in progress · ✅ done · 🔲 planned · ⏸ deferred

---

## Tier 0 — directors can see it (this week)

| Item | Why | Status |
|---|---|---|
| Deploy to **Cloudflare Pages** | Directors get a live link; auto-deploys on push to `main`. Cloudflare picked over Vercel/Netlify for unlimited bandwidth on the free tier. Constraint: the canonical repo is client-owned, so Cloudflare's GitHub OAuth couldn't install directly — resolved by forking to `jjh111/Like-Every-Cloud` and pointing Cloudflare at the fork. `npm run deploy` pushes both remotes in one command. Full topology + handoff steps in README's Hosting section. | ⏳ repo + fork prep done; awaiting URL from first successful Cloudflare build |
| **Demo-quality first-load** | Loading overlay so directors don't stare at a blank canvas during the 3–5s asset pull | 🔲 |
| **Read-only viewer mode** | `?dev=1` gate hides the dev panel + state radio panel + camera-handle markers so the directors link looks like a polished thing, not a Blender debugger | 🔲 |

---

## Tier 1 — author pipeline (next 1–2 weeks)

| Item | Why | Status |
|---|---|---|
| **Blender export utility** in `Working - gitignore/lec_pipeline.py` | Codifies the lessons from the table debug session — `bake_and_export(empty_name, file_name)` does modifier-apply + temp-zero-empty + Draco export in one call. Future re-exports are one function call from the Blender scripting tab | 🔲 |
| **Manifest validator** — `npm run validate-manifest` | Checks every placement has its GLB, no duplicate hero ids, schema matches loader. CI runs it. Catches authoring mistakes before they hit the scene | 🔲 |
| **State authoring polish** | The bottom-right hero-state radio panel is the canonical UI now. Future: a "state diff" overlay showing which heroes change between past/present side-by-side | 🔲 |
| **Source-asset provenance** | `SOURCES.md` per-hero with origin URL + license. Directors will ask. | 🔲 |

---

## Tier 2 — get assets shippable (next month)

| Item | Why | Status |
|---|---|---|
| **Texture compression** | `npm run compress` runs `gltf-transform optimize --compress draco --texture-compress webp` over every runtime GLB. Boombox 13MB → 1.1MB (91% reduction); whole asset bundle 42MB → 3.6MB. Re-run after every Blender re-export. | ✅ |
| **Re-evaluate `.gitignore`** | Post-compression, runtime GLBs are checked in via `!` exceptions in `.gitignore`. Total git-tracked asset weight: ~3.6 MB. | ✅ |
| **Texture resolution audit** | Most prop textures don't need 2K. 1K or 512 is fine for cassette-sized things. `npx gltf-transform resize` per-asset. Lower priority now that WebP cut everything to <1MB; revisit if files grow. | ⏸ |
| **Switch to KTX2 / Basis** | GPU-native textures — less VRAM, faster GPU upload than WebP. Needs the `ktx` CLI installed (not in brew core; build from KTX-Software releases or grab a prebuilt binary). Bring back `KTX2Loader` in `glbLoader.ts` and flip `--texture-compress` to `ktx2`. Defer until we hit a memory ceiling — not an issue for a 5-hero scene. | ⏸ |
| **LODs** | Probably not needed at this scale | ⏸ |
| **CDN for assets** | Likely never needed at this size | ⏸ |

---

## Tier 3 — production runtime (after directors see it)

| Item | Why | Status |
|---|---|---|
| **Dev panel vs. player UI split** | `?dev=1` gates the dev surface in Tier 0; this is the deeper rebuild — a real `src/ui/player/` folder with the visitor-facing HUD (prompts, hints, captions). Dev stays in `src/debug/` | 🔲 |
| **Player-visible state controls** | At minimum a "go inside / outside" button surfaced as player UI (it currently lives only in the dev panel) | 🔲 |
| **Game-state machine** | Currently `state` (past/present) + `view` (exterior/interior). As interactions stack (cassette grabbed → music playing → narration triggered), promote to a real FSM. Hand-rolled, not XState | 🔲 |
| **Audio cue authoring** | The mixer + channels exist. Missing: a *cue* layer — "when X happens, play Y at Z volume after T ms". Probably a JSON like `public/states.json` but for triggered events | 🔲 |

---

## Tier 4 — polish

| Item | Why | Status |
|---|---|---|
| **Post-processing** | Bloom on the morning shaft, color grading for past vs. present | 🔲 |
| **Subtle motion** | Camera idle drift, cloth wind on the table skirt | 🔲 |
| **Per-hero transitions** | Beyond the global crossfade — a cassette fading vs. the chair rotating into place vs. the boombox lighting up | 🔲 |
| **Sound design pass** | Diegetic ambience layered with the existing music channel | 🔲 |

---

## Cross-cutting

| Item | Why | Status |
|---|---|---|
| **Branching** | Currently everything's on `main`. Switch to: `main` = stable demo (auto-deploys when hosting is set up); active work on `dev` or feature branches; PR review before merging to `main` | 🔲 |
| **CI** | GitHub Actions: `npm ci && npm run typecheck && npm run build` on every PR + main push. Catches regressions before deploy | 🔲 |
| **Unit tests** | Vitest. Just the data layer for now — manifest parsing, save-flow formatters, cross-hero group logic. 3D rendering is tested visually via the deployed preview | 🔲 |
| **`CONTRIBUTING.md`** | The README has a non-technical setup section. Add a technical-collaborator doc: "how to add a new hero", "how to set a new state", "how to debug the scene" | 🔲 |

---

## Pipeline overview

```
                 source models                Blender               three.js
                ──────────────              ───────────          ─────────────
  external  ──▶ /Working - gitignore/  ──▶  Cassetteshop-Main  ──▶  public/heroes/*.glb
   (Sketchfab,    /ExternalModels                .blend                public/scene/shared.glb
    Polyhaven)                              (staging — Heroes-          ↑
                                            Source, Palette-Shop)       │ KTX2 compression
                                                  │                     │ (Tier 2)
                                                  │ bake_and_export()
                                                  │ (Tier 1 utility)
                                                  ▼
                                            public/heroes/*.glb ─────────┘

                                            public/heroes/manifest.json  ───▶  HeroLoader
                                            public/camera/positions.json  ──▶  app.ts boot
                                            public/atmosphere/*.json      ──▶  MorningShaft
                                            public/states.json            ──▶  buildStateRules

                                            three.js runtime arranges everything
                                            via the manifest — Blender is staging,
                                            three.js is the scene.
```

**Authoring loop** (the way we work, end-to-end):
1. Source a model → `Working - gitignore/ExternalModels/<thing>/`
2. Bring into Blender (`Cassetteshop-Main.blend`), into `Heroes-Source`
3. Flat-bake / clean up → drop a `*_hero` copy into `Palette-Shop` under a `hero_*` empty
4. `bake_and_export('hero_<name>', 'hero_<name>.glb')` from Blender scripting tab (Tier 1 utility)
5. Add a placement to `public/heroes/manifest.json` (or drag it into place via the dev panel + hit save)
6. Tag past / present / both via the bottom-right state panel
7. Iterate live in `npm run dev`; commit when happy

---

## Recent shipped work (so we don't forget)

- **2026-05-18** — Cloudflare Pages prep + fork-based hosting: added `.nvmrc` pinning Node 20 for the build environment; removed unused hero GLBs (`hero_amp`, `hero_cassette`, `hero_monoblock_chair`, `hero_speaker`) from `public/heroes/` so they don't ship to the host; stripped `.DS_Store` from `public/`. Created `jjh111/Like-Every-Cloud` fork to work around Cloudflare's OAuth-into-repo-owner constraint — Cloudflare watches the fork, `origin` remains the client's repo. `npm run deploy` does `git push origin main && git push fork main` in one command. **Total `dist/` is now ~31 MB** (was 36 MB), audio placeholders accounting for ~23 MB of that. README's Hosting section documents the topology, fresh-clone setup, and client-handoff steps.
- **2025-05-15** — Demo-mode polish + asset compression: `?dev=1` query string gates the dev/authoring surfaces (lil-gui panel, state radios, scene markers); top-center "go inside / outside" pill + top-right ⚙ dev-toggle for the demo view; loading overlay over the sky gradient; one-time controls hint chip; runtime assets committed to git (6 heroes + shared.glb whitelisted via `.gitignore` `!` exceptions); **`npm run compress` reduced the asset bundle 91.6% (42.6 MB → 3.6 MB)** via Draco mesh + WebP texture pipeline.
- **2025-05-15** — Cleanup pass: gizmo purity (single-mode + W/E toggle + translate-purity watchdog), camera-save UX (read-only markers + two clear save buttons), RailsMode boot-pose fix, doorway off-path guard, cross-hero group prefers `#all` wrappers, DoubleSide on hero materials, README first-time setup walkthrough, `hero_table` and `hero_chair` re-exported with modifier-baked geometry + normalized empty origins.
- **earlier** — Tier 1+2 architecture refactor: bookmarks, gizmo undo, hover labels, data-driven state music, hero/shared GLB pipeline, dev-panel save flows, wall cull, camera handles.

See `git log` for the full sequence.
