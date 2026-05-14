import { type Box3, Euler, type Object3D, Quaternion, Vector3 } from 'three';
import type { CameraMode } from '../camera/cameraMode';
import type { MorningShaft } from '../atmosphere/morningShaft';
import type { HeroEntry, HeroPlacement } from '../loaders/heroLoader';
import type { CullSettings } from '../scene/wallCull';

// All three save flows share a few invariants:
//   - dev middleware writes the body verbatim (after JSON.parse validation),
//     so the client owns formatting. Custom formatters below preserve the
//     hand-curated layout that was checked into git.
//   - 3dp rounding everywhere — matches the existing files and keeps git
//     diffs small.

const r3 = (n: number): number => Math.round(n * 1000) / 1000;
const r3v = (v: Vector3): [number, number, number] => [r3(v.x), r3(v.y), r3(v.z)];

// ── manifest.json ────────────────────────────────────────────────────────
// Custom formatter so short placements + numeric arrays stay on one line.
// JSON.stringify(_, _, 2) explodes them into multi-line blocks and bloats
// the file vs the hand-curated layout.
const formatScalar = (v: unknown): string => JSON.stringify(v);
const formatNumArray = (arr: number[]): string => `[${arr.join(', ')}]`;
const formatPlacement = (p: HeroPlacement): string => {
  const parts: string[] = [`"state": ${formatScalar(p.state)}`];
  if (p.position) parts.push(`"position": ${formatNumArray(p.position)}`);
  if (p.rotation) parts.push(`"rotation": ${formatNumArray(p.rotation)}`);
  if (p.scale !== undefined) {
    parts.push(`"scale": ${Array.isArray(p.scale) ? formatNumArray(p.scale) : p.scale}`);
  }
  if (p.material_variant !== undefined) parts.push(`"material_variant": ${formatScalar(p.material_variant)}`);
  if (p.visible !== undefined) parts.push(`"visible": ${p.visible}`);
  let hasUserData = false;
  if (p.userData) {
    hasUserData = true;
    const ud = Object.entries(p.userData)
      .map(([k, v]) => `${formatScalar(k)}: ${formatScalar(v)}`)
      .join(', ');
    parts.push(`"userData": { ${ud} }`);
  }
  const oneLine = `{ ${parts.join(', ')} }`;
  // Placements with userData are conceptually richer — keep them expanded
  // for readability even if they'd fit on one line.
  if (!hasUserData && oneLine.length <= 110) return oneLine;
  return '{\n          ' + parts.join(',\n          ') + '\n        }';
};
const formatHero = (entry: HeroEntry): string => {
  const lines: string[] = [];
  lines.push(`      "id": ${formatScalar(entry.id)},`);
  lines.push(`      "url": ${formatScalar(entry.url)},`);
  if (entry.interactive !== undefined) {
    lines.push(`      "interactive": ${entry.interactive},`);
  }
  const placements = (entry.placements ?? []).map((p) => '        ' + formatPlacement(p)).join(',\n');
  lines.push('      "placements": [\n' + placements + '\n      ]');
  return '    {\n' + lines.join('\n') + '\n    }';
};
const formatManifest = (manifest: { heroes: HeroEntry[] }): string => {
  const heroes = (manifest.heroes ?? []).map(formatHero).join(',\n');
  return '{\n  "heroes": [\n' + heroes + '\n  ]\n}\n';
};

// ── camera positions.json ────────────────────────────────────────────────
export interface CameraSavePayload {
  exterior: { position: [number, number, number]; target: [number, number, number] };
  doorway: [number, number, number];
  interiorAABB: { min: [number, number, number]; max: [number, number, number] };
  cull: { offset: number; enabled: boolean };
  tunables: Record<string, Record<string, number>>;
  bookmarks: Record<string, { position: [number, number, number]; target: [number, number, number] }>;
}

const formatCameraPositions = (data: CameraSavePayload): string => {
  const ex = data.exterior;
  const ai = data.interiorAABB;
  const tunableLines = Object.entries(data.tunables).map(([name, vals]) => {
    const pairs = Object.entries(vals).map(([k, v]) => `"${k}": ${v}`).join(', ');
    return `    "${name}": { ${pairs} }`;
  });
  const bookmarkEntries = Object.entries(data.bookmarks);
  const bookmarkLines = bookmarkEntries.map(([name, b]) => (
    `    ${JSON.stringify(name)}: { "position": [${b.position.join(', ')}], "target": [${b.target.join(', ')}] }`
  ));
  // Bookmarks: keep the key out of the file entirely when empty so the
  // schema reads cleanly for first-time users until they save one.
  const bookmarksBlock = bookmarkEntries.length
    ? ',\n  "bookmarks": {\n' + bookmarkLines.join(',\n') + '\n  }'
    : '';
  return (
    '{\n' +
    '  "exterior": {\n' +
    `    "position": [${ex.position.join(', ')}],\n` +
    `    "target": [${ex.target.join(', ')}]\n` +
    '  },\n' +
    `  "doorway": [${data.doorway.join(', ')}],\n` +
    '  "interiorAABB": {\n' +
    `    "min": [${ai.min.join(', ')}],\n` +
    `    "max": [${ai.max.join(', ')}]\n` +
    '  },\n' +
    `  "cull": { "offset": ${data.cull.offset}, "enabled": ${data.cull.enabled} },\n` +
    '  "tunables": {\n' +
    tunableLines.join(',\n') + '\n' +
    '  }' +
    bookmarksBlock + '\n' +
    '}\n'
  );
};

// ── atmosphere morning-shaft.json ────────────────────────────────────────
const formatAtmosphereConfig = (cfg: ReturnType<MorningShaft['getCurrentConfig']>): string => {
  const shaftLines = cfg.shafts.map((s) =>
    `    { "origin": [${s.origin.join(', ')}], "aim": [${s.aim.join(', ')}], "radius": ${s.radius} }`,
  );
  return (
    '{\n' +
    '  "shafts": [\n' + shaftLines.join(',\n') + '\n  ],\n' +
    `  "shaftIntensity": ${cfg.shaftIntensity},\n` +
    `  "fogDensity": ${cfg.fogDensity},\n` +
    `  "dustOpacity": ${cfg.dustOpacity},\n` +
    `  "dustSize": ${cfg.dustSize},\n` +
    `  "dustCount": ${cfg.dustCount}\n` +
    '}\n'
  );
};

// ── snapshot helpers ─────────────────────────────────────────────────────
export const snapshotCameraTunables = (cam: CameraMode): Record<string, number> => {
  const { target, specs } = cam.getTunables();
  const t = target as Record<string, number>;
  const out: Record<string, number> = {};
  for (const s of specs) out[s.key] = t[s.key];
  return out;
};

export const applyCameraTunables = (cam: CameraMode, values: Record<string, number>): void => {
  const { target, specs } = cam.getTunables();
  const t = target as Record<string, number>;
  for (const s of specs) {
    if (typeof values[s.key] === 'number') t[s.key] = values[s.key];
  }
};

// ── Public API ───────────────────────────────────────────────────────────
export interface SaveFlowDeps {
  heroLookup: Map<string, Object3D>;
  morningShaft: MorningShaft;
  cameras: Record<string, CameraMode>;
  /** Source of truth for the exterior pose. Mutated by saveCameraPose() —
   *  every other save flow reads it verbatim, so saving the doorway or a
   *  bookmark never overwrites the curated outside shot. */
  exteriorPos: Vector3;
  exteriorTarget: Vector3;
  doorway: Vector3;
  interiorAABB: Box3;
  cullSettings: CullSettings;
  bookmarks: Record<string, { position: [number, number, number]; target: [number, number, number] }>;
  /** Snapshot of the live camera pose. Tween-friendly — callers usually
   *  pull from the active camera's controls.target, or the forward ray.
   *  Used for saveCameraPose (writes current → exterior) and bookmark save
   *  (writes current → bookmark entry). NOT used for doorway / delete saves. */
  snapshotPose: () => { position: [number, number, number]; target: [number, number, number] };
  /** True while the user has the exterior-pose marker selected for editing.
   *  When true, saveCameraPose preserves exteriorPos/Target as-is (the
   *  marker is already syncing into exteriorPos each tick via
   *  cameraHandles.syncToSources). When false, it snaps from the current
   *  camera — the "I framed a nice shot, save it" workflow. */
  isEditingExteriorMarker: () => boolean;
}

export interface SaveFlows {
  saveHeroPositions: () => Promise<void>;
  saveShaftConfig: () => Promise<void>;
  saveCameraPose: () => Promise<void>;
  saveCurrentAsDoorway: () => Promise<void>;
  /** Stash the current pose under `name` in the bookmarks map and persist. */
  saveCurrentAsBookmark: (name: string) => Promise<void>;
  /** Remove a bookmark and persist. No-op if it doesn't exist. */
  deleteBookmark: (name: string) => Promise<void>;
}

export function createSaveFlows(deps: SaveFlowDeps): SaveFlows {
  const {
    heroLookup,
    morningShaft,
    cameras,
    exteriorPos,
    exteriorTarget,
    doorway,
    interiorAABB,
    cullSettings,
    bookmarks,
    snapshotPose,
  } = deps;

  // Builds the payload from CURRENT exteriorPos/Target (source of truth).
  // saveCameraPose mutates those vectors before calling postCameraConfig so
  // its updated values land on disk; every other save flow leaves them
  // alone and inherits the previously-saved exterior.
  const buildCameraPayload = (): CameraSavePayload => {
    const tunables: Record<string, Record<string, number>> = {};
    for (const [name, cam] of Object.entries(cameras)) {
      tunables[name] = snapshotCameraTunables(cam);
    }
    return {
      exterior: { position: r3v(exteriorPos), target: r3v(exteriorTarget) },
      doorway: r3v(doorway),
      interiorAABB: { min: r3v(interiorAABB.min), max: r3v(interiorAABB.max) },
      cull: { offset: r3(cullSettings.offset), enabled: cullSettings.enabled },
      tunables,
      bookmarks,
    };
  };

  const postCameraConfig = async (label: string): Promise<void> => {
    try {
      const payload = buildCameraPayload();
      const body = formatCameraPositions(payload);
      const res = await fetch('/__lec/save-camera', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      });
      if (!res.ok) throw new Error(`save responded ${res.status}: ${await res.text()}`);
      const result = (await res.json()) as { saved?: string };
      console.log(`[camera] ${label} → ${result.saved}`, payload);
    } catch (e) {
      console.warn('[camera] save failed', e);
    }
  };

  // The ONLY save flow that updates the exterior pose.
  //
  //   - Normal workflow ("I orbited to a nice shot, hit save"): snapshot the
  //     live camera and write it into the source-of-truth vectors so
  //     subsequent setView('exterior') / wall-cull / bookmark saves all see
  //     the new pose immediately.
  //   - Marker-edit workflow ("I dragged the green exterior gizmo, hit
  //     save"): exteriorPos already reflects the marker via syncToSources.
  //     Skip the snapshot so the drag is preserved. Target is also left
  //     alone — to update the target separately, deselect the marker,
  //     orbit, and save.
  const saveCameraPose = async (): Promise<void> => {
    if (!deps.isEditingExteriorMarker()) {
      const p = snapshotPose();
      exteriorPos.set(p.position[0], p.position[1], p.position[2]);
      exteriorTarget.set(p.target[0], p.target[1], p.target[2]);
    }
    return postCameraConfig('exterior pose saved');
  };

  // Capture the camera's CURRENT world position as the doorway waypoint,
  // then save. Workflow: orbit to the threshold of the entrance, click
  // this, and the next inside↔outside tween will route through it.
  const saveCurrentAsDoorway = async (): Promise<void> => {
    const p = snapshotPose().position;
    doorway.set(p[0], p[1], p[2]);
    return postCameraConfig('doorway saved');
  };

  const saveCurrentAsBookmark = async (name: string): Promise<void> => {
    const p = snapshotPose();
    bookmarks[name] = { position: p.position, target: p.target };
    return postCameraConfig(`bookmark "${name}" saved`);
  };

  const deleteBookmark = async (name: string): Promise<void> => {
    if (!(name in bookmarks)) return;
    delete bookmarks[name];
    return postCameraConfig(`bookmark "${name}" deleted`);
  };

  const saveShaftConfig = async (): Promise<void> => {
    try {
      const config = morningShaft.getCurrentConfig();
      const body = formatAtmosphereConfig(config);
      const res = await fetch('/__lec/save-atmosphere', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      });
      if (!res.ok) {
        const msg = await res.text();
        throw new Error(`save responded ${res.status}: ${msg}`);
      }
      const result = (await res.json()) as { saved?: string };
      console.log('[atmosphere] saved →', result.saved, config);
    } catch (e) {
      console.warn('[atmosphere] save failed', e);
    }
  };

  const saveHeroPositions = async (): Promise<void> => {
    // Strategy: load the manifest fresh, snapshot each placement's WORLD
    // transform from the live scene (so any "#all" group offset is baked
    // in), then POST the new bytes. On success, re-localize the live group
    // back to identity so subsequent drags don't compound the old offset
    // on top of the new manifest.
    //
    // Importantly: scene mutation happens AFTER the POST returns 200 — if
    // the server rejects the write, the live scene is untouched.
    try {
      const res = await fetch('/heroes/manifest.json', { cache: 'no-store' });
      if (!res.ok) throw new Error('manifest fetch: ' + res.status);
      const manifest = (await res.json()) as { heroes: HeroEntry[] };

      const updated: string[] = [];
      const skipped: string[] = [];
      const writePlacement = (
        placement: HeroPlacement,
        pos: Vector3,
        quat: Quaternion,
        scale: Vector3,
      ): void => {
        placement.position = [r3(pos.x), r3(pos.y), r3(pos.z)];
        const e = new Euler().setFromQuaternion(quat);
        const ax = r3(e.x), ay = r3(e.y), az = r3(e.z);
        if (ax === 0 && ay === 0 && az === 0) delete placement.rotation;
        else placement.rotation = [ax, ay, az];
        const sx = r3(scale.x), sy = r3(scale.y), sz = r3(scale.z);
        if (sx === 1 && sy === 1 && sz === 1) delete placement.scale;
        else if (sx === sy && sy === sz) placement.scale = sx;
        else placement.scale = [sx, sy, sz];
      };

      // Pass 1: snapshot world transforms BEFORE mutating anything. Done
      // for every entry so we have a complete picture before POST.
      const allSnaps: Array<{
        entry: HeroEntry;
        multi: boolean;
        snaps: Array<{
          instanceId: string;
          obj: Object3D | undefined;
          pos: Vector3;
          quat: Quaternion;
          scale: Vector3;
        }>;
      }> = [];
      for (const entry of manifest.heroes ?? []) {
        const placements = entry.placements ?? [];
        const multi = placements.length > 1;
        const snaps = placements.map((_, i) => {
          const instanceId = multi ? `${entry.id}#${i}` : entry.id;
          const obj = heroLookup.get(instanceId);
          const pos = new Vector3();
          const quat = new Quaternion();
          const scale = new Vector3();
          if (obj) {
            obj.getWorldPosition(pos);
            obj.getWorldQuaternion(quat);
            obj.getWorldScale(scale);
          }
          return { instanceId, obj, pos, quat, scale };
        });
        allSnaps.push({ entry, multi, snaps });
      }

      // Pass 2: write snapshots into the manifest data structure.
      for (const { entry, snaps } of allSnaps) {
        const placements = entry.placements ?? [];
        for (let i = 0; i < placements.length; i++) {
          const snap = snaps[i];
          if (!snap.obj) {
            skipped.push(snap.instanceId + ' (not in scene)');
            continue;
          }
          writePlacement(placements[i], snap.pos, snap.quat, snap.scale);
          const liveState = snap.obj.userData.state;
          if (liveState === 'past' || liveState === 'present' || liveState === 'both') {
            placements[i].state = liveState;
          }
          updated.push(snap.instanceId);
        }
      }

      // Pass 3: POST. If this fails we abort — the live scene is still
      // intact, the manifest on disk is still the previous version.
      const saveRes = await fetch('/__lec/save-manifest', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: formatManifest(manifest),
      });
      if (!saveRes.ok) {
        const msg = await saveRes.text();
        throw new Error(`save responded ${saveRes.status}: ${msg}`);
      }
      const result = (await saveRes.json()) as { saved?: string };

      // Pass 4: NOW it's safe to normalize the live scene. Group back to
      // identity, children to the captured world transforms, so the
      // manifest stays the single source of truth for what's on screen
      // and a future drag-the-group starts from a clean offset.
      for (const { entry, multi, snaps } of allSnaps) {
        if (!multi) continue;
        const group = heroLookup.get(entry.id + '#all');
        if (!group) continue;
        group.position.set(0, 0, 0);
        group.quaternion.identity();
        group.scale.set(1, 1, 1);
        for (const snap of snaps) {
          if (!snap.obj) continue;
          snap.obj.position.copy(snap.pos);
          snap.obj.quaternion.copy(snap.quat);
          snap.obj.scale.copy(snap.scale);
        }
      }

      console.log('[manifest] saved →', result.saved);
      console.log('[manifest] updated:', updated);
      if (skipped.length) console.log('[manifest] skipped:', skipped);
    } catch (e) {
      console.warn('[manifest] save failed', e);
    }
  };

  return {
    saveHeroPositions,
    saveShaftConfig,
    saveCameraPose,
    saveCurrentAsDoorway,
    saveCurrentAsBookmark,
    deleteBookmark,
  };
}
