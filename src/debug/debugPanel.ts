import GUI from 'lil-gui';
import type { StateController } from '../state/stateController';
import type { Transition } from '../transitions/transition';
import type { CameraMode } from '../camera/cameraMode';
import type { AudioManager } from '../audio/audioManager';
import type { Atmosphere } from '../atmosphere/atmosphere';
import type { TimeOfDayClock } from '../atmosphere/timeOfDayClock';
import type { MorningShaft } from '../atmosphere/morningShaft';

// lil-gui = PLUMBING ONLY.
//
// After the HUD consolidation, the daily-driver controls live in the new
// surfaces: the timeline owns time-of-day + morph scrubbing, and the
// inspector owns hero selection / state tagging / audio / atmosphere /
// perf / gizmo toggles. lil-gui keeps the precise "write to disk" and
// fine-numeric authoring that those surfaces deliberately don't expose:
//
//   morph        duration · animate-to-other · transition algorithm
//   time of day  day length · snap-to-time buttons
//   camera       mode · per-mode tunables · bookmarks · save poses · wall cull
//   edit         gizmo mode (W/E) · save → manifest.json
//   atmosphere   shaft endpoint editing · save → morning-shaft.json
//
// Removed (now owned elsewhere, no duplicates):
//   - state target/progress + snap past/present  → timeline MORPH lane
//   - time-of-day t / clock / auto-cycle         → timeline TIME lane + transport
//   - audio muted/master/channels                → inspector AUDIO tab
//   - atmosphere preset + tunables               → inspector ATMOSPHERE tab
//   - edit-hero dropdown                         → inspector HEROES tab
//   - "go inside" button                         → the always-present scene button

export interface DebugDeps {
  state: StateController;
  transitions: Record<string, Transition>;
  setTransition: (name: string) => void;
  initialTransition: string;
  cameras: Record<string, CameraMode>;
  initialCamera: string;
  setCamera: (name: string) => void;
  getActiveCamera: () => CameraMode;
  // Atmosphere preset/tunables moved to the inspector; these remain in the
  // deps for API stability but are no longer surfaced by lil-gui.
  atmospheres: Record<string, Atmosphere>;
  initialAtmosphere: string;
  setAtmosphere: (name: string) => void;
  getActiveAtmosphere: () => Atmosphere;
  // Audio moved to the inspector AUDIO tab; kept in deps for API stability.
  audio: AudioManager;
  /** High-level outside/inside toggle (now driven by the scene button). */
  getView: () => 'exterior' | 'interior';
  toggleView: () => void;
  /** Hero selection moved to the inspector HEROES tab; kept for API stability. */
  heroIds: Record<string, string>;
  setEditTarget: (heroId: string) => void;
  /** Read the current gizmo mode for the edit-folder dropdown. */
  getGizmoMode: () => 'translate' | 'rotate';
  /** Switch the gizmo mode. The dropdown calls this; W/E keys also do. */
  setGizmoMode: (mode: 'translate' | 'rotate') => void;
  /** Persist edited positions back to public/heroes/manifest.json via dev middleware. */
  saveHeroPositions: () => void;
  /** Shaft-handle editing. Dropdown options + setter. */
  shaftHandleIds: string[];
  setShaftEditTarget: (id: string) => void;
  /** Persist shaft endpoints/radii/tunables back to morning-shaft.json. */
  saveShaftConfig: () => void;
  /** Snapshot current camera position + target as the exterior pose. */
  saveCameraPose: () => void;
  /** Snapshot current camera position as the doorway waypoint. */
  saveCurrentAsDoorway: () => void;
  /** Live tunables for the wall-cull clipping plane. Panel binds directly. */
  cullSettings: { offset: number; enabled: boolean };
  /** Camera bookmarks — live map, panel reads it directly on rebuild. */
  bookmarks: Record<string, { position: [number, number, number]; target: [number, number, number] }>;
  /** Tween the camera to a named bookmark. */
  goToBookmark: (name: string) => void;
  /** Snapshot current pose under a new bookmark name + persist. */
  saveCurrentAsBookmark: (name: string) => void;
  /** Remove a bookmark by name + persist. */
  deleteBookmark: (name: string) => void;
  /** Time-of-day clock — lil-gui exposes day-length + snap buttons only;
   *  the timeline owns the t scrub + play/pause. */
  clock: TimeOfDayClock;
  /** Morning shaft — for the "snap to shaft reference t" button. */
  morningShaft: MorningShaft;
}

type Controller = ReturnType<GUI['add']>;

export type DebugPanel = GUI & {
  /** No-op since hero selection moved to the inspector HEROES tab. Kept on
   *  the type so existing callers (app.ts onHeroRetag) stay valid. */
  refreshHeroDropdown(newMap: Record<string, string>): void;
};

const BOOKMARK_PLACEHOLDER = '(none)';

export function createDebugPanel(deps: DebugDeps): DebugPanel {
  const gui = new GUI({ title: 'LEC · plumbing' });
  // ID the lil-gui root so the director-mode CSS class can hide it
  // alongside the other dev panels in one selector group.
  gui.domElement.id = 'lec-debug-panel';
  // Cap height so the panel scrolls internally and never runs under the
  // 88px timeline strip at the bottom of the viewport.
  gui.domElement.style.maxHeight = 'calc(100vh - 96px)';
  gui.domElement.style.overflowY = 'auto';

  // ── morph ────────────────────────────────────────────────────────────────
  // Position-scrub lives in the timeline MORPH lane. Here we keep the
  // *animation* knobs: how long an auto-morph takes, a one-shot animate
  // button, and which crossfade algorithm runs.
  const morphFolder = gui.addFolder('morph');
  const morphProxy = {
    transition: deps.initialTransition,
    animateOther: (() => {
      let next: 'past' | 'present' = 'present';
      return () => {
        deps.state.duration = deps.state.duration > 0 ? deps.state.duration : 1;
        deps.state.setTarget(next);
        next = next === 'present' ? 'past' : 'present';
      };
    })(),
  };
  // Bind duration directly to the live state so .listen() mirrors external
  // changes (e.g. the timeline sets duration=0 while scrubbing).
  morphFolder.add(deps.state, 'duration', 0, 5, 0.1).name('duration (s)').listen();
  morphFolder.add(morphProxy, 'animateOther').name('animate to other');
  morphFolder.add(morphProxy, 'transition', Object.keys(deps.transitions))
    .onChange((v: string) => deps.setTransition(v));

  // ── time of day ────────────────────────────────────────────────────────
  // The t scrub + play/pause live in the timeline. Here: day length + the
  // snap-to-time buttons (incl. the shaft-reference t used while editing
  // the morning-shaft cones).
  const timeFolder = gui.addFolder('time of day');
  const timeProxy = {
    dayLengthSeconds: deps.clock.dayLengthSeconds,
    dawn: () => { deps.clock.t = 0.25; },
    noon: () => { deps.clock.t = 0.5; },
    dusk: () => { deps.clock.t = 0.75; },
    midnight: () => { deps.clock.t = 0; },
    shaftRef: () => { deps.clock.t = deps.morningShaft.shaftReferenceT; },
  };
  timeFolder.add(timeProxy, 'dayLengthSeconds', 30, 1800, 10)
    .onChange((v: number) => { deps.clock.dayLengthSeconds = v; })
    .name('day length (s)');
  timeFolder.add(timeProxy, 'dawn').name('snap → dawn');
  timeFolder.add(timeProxy, 'noon').name('snap → noon');
  timeFolder.add(timeProxy, 'dusk').name('snap → dusk');
  timeFolder.add(timeProxy, 'midnight').name('snap → midnight');
  timeFolder.add(timeProxy, 'shaftRef').name('snap → shaft reference');

  // ── camera ─────────────────────────────────────────────────────────────
  const cameraFolder = gui.addFolder('camera');
  const cameraProxy = {
    camera: deps.initialCamera,
    bookmark: BOOKMARK_PLACEHOLDER,
    saveExterior: () => deps.saveCameraPose(),
    saveDoorway: () => deps.saveCurrentAsDoorway(),
    saveBookmark: () => {
      const name = window.prompt('Bookmark name?');
      if (!name) return;
      const trimmed = name.trim();
      if (!trimmed) return;
      deps.saveCurrentAsBookmark(trimmed);
      setTimeout(() => { refreshBookmarks(trimmed); }, 0);
    },
    deleteBookmark: () => {
      const name = cameraProxy.bookmark;
      if (name === BOOKMARK_PLACEHOLDER) return;
      if (!window.confirm(`Delete bookmark "${name}"?`)) return;
      deps.deleteBookmark(name);
      cameraProxy.bookmark = BOOKMARK_PLACEHOLDER;
      setTimeout(() => refreshBookmarks(BOOKMARK_PLACEHOLDER), 0);
    },
  };
  cameraFolder.add(cameraProxy, 'camera', Object.keys(deps.cameras))
    .name('camera mode')
    .onChange((v: string) => {
      deps.setCamera(v);
      refreshCameraTunables();
    })
    .listen();
  const cameraTunablesFolder = cameraFolder.addFolder('tunables (active mode)');
  let cameraTunableControllers: Controller[] = [];
  function refreshCameraTunables() {
    for (const c of cameraTunableControllers) c.destroy();
    cameraTunableControllers = [];
    const { target, specs } = deps.getActiveCamera().getTunables();
    for (const s of specs) {
      const c = cameraTunablesFolder
        .add(target as Record<string, number>, s.key, s.min, s.max, s.step)
        .name(s.label)
        .listen();
      cameraTunableControllers.push(c);
    }
  }
  refreshCameraTunables();

  let bookmarkCtrl: Controller = buildBookmarkController();
  function buildBookmarkController(): Controller {
    return cameraFolder.add(cameraProxy, 'bookmark', bookmarkOptions())
      .name('go to bookmark')
      .onChange((v: string) => {
        if (v === BOOKMARK_PLACEHOLDER) return;
        deps.goToBookmark(v);
        setTimeout(() => {
          cameraProxy.bookmark = BOOKMARK_PLACEHOLDER;
          bookmarkCtrl.updateDisplay();
        }, 0);
      });
  }
  function bookmarkOptions(): Record<string, string> {
    const out: Record<string, string> = { [BOOKMARK_PLACEHOLDER]: BOOKMARK_PLACEHOLDER };
    for (const name of Object.keys(deps.bookmarks).sort()) {
      out[name] = name;
    }
    return out;
  }
  function refreshBookmarks(select: string) {
    bookmarkCtrl.destroy();
    cameraProxy.bookmark = select;
    bookmarkCtrl = buildBookmarkController();
  }
  cameraFolder.add(cameraProxy, 'saveBookmark').name('save bookmark…');
  cameraFolder.add(cameraProxy, 'deleteBookmark').name('delete current bookmark');

  // Wall-cull controls. `offset` pushes the clip plane deeper into the room
  // (positive = less wall cut, plane sits further from the camera).
  cameraFolder.add(deps.cullSettings, 'enabled').name('wall cull on').listen();
  cameraFolder.add(deps.cullSettings, 'offset', -1, 3, 0.05).name('cull offset (m)').listen();

  cameraFolder.add(cameraProxy, 'saveExterior').name('set outside view here');
  cameraFolder.add(cameraProxy, 'saveDoorway').name('set doorway here');

  // ── edit ───────────────────────────────────────────────────────────────
  // Hero SELECTION moved to the inspector HEROES tab. lil-gui keeps the
  // gizmo-mode toggle (the discoverable surface for the W/E keys) + the
  // save-to-manifest button (the disk write).
  const editFolder = gui.addFolder('edit');
  const editProxy = {
    gizmoMode: deps.getGizmoMode(),
    save: () => deps.saveHeroPositions(),
  };
  const gizmoModeCtrl = editFolder.add(editProxy, 'gizmoMode', ['translate', 'rotate'])
    .name('gizmo (W/E)')
    .onChange((v: 'translate' | 'rotate') => deps.setGizmoMode(v));
  editFolder.add(editProxy, 'save').name('save → manifest.json');

  // ── atmosphere ─────────────────────────────────────────────────────────
  // Preset + tunables moved to the inspector ATMOSPHERE tab. lil-gui keeps
  // the shaft endpoint editing (gizmo-driven) + the disk write.
  const atmosFolder = gui.addFolder('atmosphere');
  const atmosProxy = {
    shaftHandle: '(none)',
    saveShafts: () => deps.saveShaftConfig(),
  };
  atmosFolder.add(atmosProxy, 'shaftHandle', deps.shaftHandleIds)
    .name('edit shaft')
    .onChange((v: string) => deps.setShaftEditTarget(v));
  atmosFolder.add(atmosProxy, 'saveShafts').name('save → morning-shaft.json');

  // Sync poll: camera-mode swaps + W/E gizmo-mode changes happen outside the
  // panel, so mirror them into the displayed controls.
  let lastActiveCam = deps.getActiveCamera();
  setInterval(() => {
    const activeCam = deps.getActiveCamera();
    if (activeCam !== lastActiveCam) {
      lastActiveCam = activeCam;
      for (const [k, v] of Object.entries(deps.cameras)) {
        if (v === activeCam) { cameraProxy.camera = k; break; }
      }
      refreshCameraTunables();
    }
    const mode = deps.getGizmoMode();
    if (editProxy.gizmoMode !== mode) {
      editProxy.gizmoMode = mode;
      gizmoModeCtrl.updateDisplay();
    }
  }, 100);

  // Hero-dropdown refresh is now the inspector's job; keep a no-op so the
  // existing caller (app.ts onHeroRetag) stays valid without branching.
  const refreshHeroDropdown = (_newMap: Record<string, string>): void => { /* no-op */ };

  return Object.assign(gui, { refreshHeroDropdown });
}
