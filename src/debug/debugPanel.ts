import GUI from 'lil-gui';
import type { StateController } from '../state/stateController';
import type { Transition } from '../transitions/transition';
import type { CameraMode } from '../camera/cameraMode';
import type { AudioManager } from '../audio/audioManager';
import type { Atmosphere } from '../atmosphere/atmosphere';
import type { TimeOfDayClock } from '../atmosphere/timeOfDayClock';
import type { MorningShaft } from '../atmosphere/morningShaft';

export interface DebugDeps {
  state: StateController;
  transitions: Record<string, Transition>;
  setTransition: (name: string) => void;
  initialTransition: string;
  cameras: Record<string, CameraMode>;
  initialCamera: string;
  setCamera: (name: string) => void;
  getActiveCamera: () => CameraMode;
  atmospheres: Record<string, Atmosphere>;
  initialAtmosphere: string;
  setAtmosphere: (name: string) => void;
  getActiveAtmosphere: () => Atmosphere;
  audio: AudioManager;
  /** High-level outside/inside toggle. */
  getView: () => 'exterior' | 'interior';
  toggleView: () => void;
  /** Edit-mode controls — pick a hero, get a single gizmo whose mode (translate
   *  vs rotate) is governed by setGizmoMode.
   *  Object-keyed: display label (e.g. "hero_speaker (past)") → bare hero id. */
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
  /** Snapshot current camera position + target as the exterior pose, persist
   *  positions.json. Updates the green exterior marker on next sync tick. */
  saveCameraPose: () => void;
  /** Snapshot current camera position as the doorway waypoint, persist
   *  positions.json. Updates the cyan doorway marker on next sync tick. */
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
  /** Time-of-day clock (unified lighting source). Panel exposes a t slider,
   *  a paused/auto toggle, day-length slider, and snap-to-time buttons. */
  clock: TimeOfDayClock;
  /** Morning shaft — needed for the "snap to shaft reference t" button
   *  which jumps the clock to the time at which the authored shafts are
   *  drawn so the gizmo handles align with the cone visuals during edits. */
  morningShaft: MorningShaft;
}

type Controller = ReturnType<GUI['add']>;

export type DebugPanel = GUI & {
  /** Rebuild the edit-hero dropdown options. Called after the hero state
   *  panel changes a tag — labels include the state suffix, so they go
   *  stale on retag. */
  refreshHeroDropdown(newMap: Record<string, string>): void;
};

const BOOKMARK_PLACEHOLDER = '(none)';

export function createDebugPanel(deps: DebugDeps): DebugPanel {
  const gui = new GUI({ title: 'LEC dev panel' });

  // Top-level: view toggle is the primary nav action, kept loose at the
  // top rather than buried in a folder. Label flips with deps.getView().
  const viewProxy = { go: () => deps.toggleView() };
  const viewBtn = gui.add(viewProxy, 'go').name('go inside →');

  // ── state ──────────────────────────────────────────────────────────────
  const stateFolder = gui.addFolder('state');
  const stateProxy = {
    target: deps.state.target,
    progress: deps.state.progress,
    duration: deps.state.duration,
    transition: deps.initialTransition,
    snapPast: () => {
      deps.state.duration = 0;
      deps.state.setTarget('past');
    },
    snapPresent: () => {
      deps.state.duration = 0;
      deps.state.setTarget('present');
    },
    animateOther: (() => {
      let next: 'past' | 'present' = 'present';
      return () => {
        deps.state.duration = stateProxy.duration > 0 ? stateProxy.duration : 1;
        deps.state.setTarget(next);
        next = next === 'present' ? 'past' : 'present';
      };
    })(),
  };
  stateFolder.add(stateProxy, 'target', ['past', 'present'])
    .onChange((v: 'past' | 'present') => deps.state.setTarget(v))
    .listen();
  stateFolder.add(stateProxy, 'progress', 0, 1, 0.001)
    .onChange((v: number) => deps.state.setProgress(v))
    .listen();
  stateFolder.add(stateProxy, 'duration', 0, 5, 0.1)
    .onChange((v: number) => { deps.state.duration = v; });
  stateFolder.add(stateProxy, 'snapPast').name('snap → past');
  stateFolder.add(stateProxy, 'snapPresent').name('snap → present');
  stateFolder.add(stateProxy, 'animateOther').name('animate to other');
  stateFolder.add(stateProxy, 'transition', Object.keys(deps.transitions))
    .onChange((v: string) => deps.setTransition(v));

  // ── time of day ────────────────────────────────────────────────────────
  // Drives the unified SunRig (directional light + ambient + sky palette).
  // CloudSky + MorningShaft both read the clock through SunRig — moving
  // this slider re-paints the entire scene's lighting.
  //
  // Default is paused so the directors see a stable scene; toggling "running"
  // advances time by `dayLengthSeconds` real seconds = 24 scene hours.
  const timeFolder = gui.addFolder('time of day');
  const timeProxy = {
    t: deps.clock.t,
    clock: deps.clock.formatHM(),
    running: deps.clock.running,
    dayLengthSeconds: deps.clock.dayLengthSeconds,
    dawn: () => { deps.clock.t = 0.25; },
    noon: () => { deps.clock.t = 0.5; },
    dusk: () => { deps.clock.t = 0.75; },
    midnight: () => { deps.clock.t = 0; },
    shaftRef: () => { deps.clock.t = deps.morningShaft.shaftReferenceT; },
  };
  // t slider — both directions: panel ↔ clock. The clock might tick on
  // its own (when running), so we .listen() to mirror back into the slider.
  timeFolder.add(timeProxy, 't', 0, 1, 0.001)
    .onChange((v: number) => { deps.clock.t = v; })
    .listen();
  // Read-only clock chip (HH:MM). Refreshed below via the controller list.
  const clockCtrl = timeFolder.add(timeProxy, 'clock').disable().listen();
  timeFolder.add(timeProxy, 'running')
    .onChange((v: boolean) => { deps.clock.running = v; })
    .listen()
    .name('auto cycle');
  timeFolder.add(timeProxy, 'dayLengthSeconds', 30, 1800, 10)
    .onChange((v: number) => { deps.clock.dayLengthSeconds = v; })
    .name('day length (s)');
  timeFolder.add(timeProxy, 'dawn').name('snap → dawn');
  timeFolder.add(timeProxy, 'noon').name('snap → noon');
  timeFolder.add(timeProxy, 'dusk').name('snap → dusk');
  timeFolder.add(timeProxy, 'midnight').name('snap → midnight');
  timeFolder.add(timeProxy, 'shaftRef').name('snap → shaft reference');
  // Cheap polling tick so the HH:MM chip + t slider stay in sync when the
  // clock advances on its own. The lil-gui .listen() handles `t` and
  // `running`; the formatted `clock` string needs a manual refresh.
  setInterval(() => {
    timeProxy.t = deps.clock.t;
    timeProxy.clock = deps.clock.formatHM();
    timeProxy.running = deps.clock.running;
    clockCtrl.updateDisplay();
  }, 200);

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
      // After save: re-build the dropdown so the new entry is selectable.
      // Use a tiny delay so the save flow's await resolves first; the
      // bookmarks map is mutated synchronously before the network call,
      // so 0ms (microtask) is enough.
      setTimeout(() => {
        refreshBookmarks(trimmed);
      }, 0);
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
  // Per-mode tunables get their own sub-folder so they sit visually next
  // to the camera-mode dropdown regardless of when they're added/removed.
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

  // Bookmarks: tween-to-pose dropdown. Picking a bookmark immediately fires
  // goToBookmark, then the proxy resets to "(none)" so picking the same
  // bookmark again re-fires onChange (lil-gui skips same-value changes).
  let bookmarkCtrl: Controller = buildBookmarkController();
  function buildBookmarkController(): Controller {
    return cameraFolder.add(cameraProxy, 'bookmark', bookmarkOptions())
      .name('go to bookmark')
      .onChange((v: string) => {
        if (v === BOOKMARK_PLACEHOLDER) return;
        deps.goToBookmark(v);
        // Defer the reset to after the current change handler so lil-gui
        // doesn't see a recursive setValue mid-event.
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
  cameraFolder.add(deps.cullSettings, 'enabled')
    .name('wall cull on')
    .listen();
  cameraFolder.add(deps.cullSettings, 'offset', -1, 3, 0.05)
    .name('cull offset (m)')
    .listen();

  // The two anchor points. Each button snapshots the LIVE camera into the
  // corresponding persisted slot and rewrites positions.json. The colored
  // markers in the scene (green = exterior, cyan = doorway) follow on the
  // next sync tick so you always see where the saved values live.
  //
  //   set outside view here  → camera.position + camera.lookAt → exterior pose
  //   set doorway here       → camera.position → doorway waypoint
  cameraFolder.add(cameraProxy, 'saveExterior').name('set outside view here');
  cameraFolder.add(cameraProxy, 'saveDoorway').name('set doorway here');

  // ── edit ───────────────────────────────────────────────────────────────
  const editFolder = gui.addFolder('edit');
  const editProxy = {
    target: '(none)',
    gizmoMode: 'translate' as 'translate' | 'rotate',
    save: () => deps.saveHeroPositions(),
  };
  // editTargetCtrl is reassigned by refreshHeroDropdown when state tags
  // change — destroying and re-adding is the only lil-gui pattern for
  // updating option lists.
  let editTargetCtrl = editFolder.add(editProxy, 'target', deps.heroIds)
    .name('edit hero')
    .onChange(onEditTargetChanged);
  function onEditTargetChanged(v: string): void {
    // Picking a hero clears the shaft selection — one gizmo target at a time.
    // The camera-handle markers are passive visualizations now, so there's
    // nothing to clear there.
    if (v !== '(none)') {
      if (atmosProxy.shaftHandle !== '(none)') {
        atmosProxy.shaftHandle = '(none)';
        shaftHandleCtrl.updateDisplay();
        deps.setShaftEditTarget('(none)');
      }
    }
    deps.setEditTarget(v);
    // attachGizmo resets mode to translate on every pick — keep the dropdown
    // in sync so it doesn't lie about the current state.
    editProxy.gizmoMode = 'translate';
    gizmoModeCtrl.updateDisplay();
  }
  // Single gizmo with mode toggle. Default translate; user picks rotate when
  // they want to spin a hero. The W / E keyboard shortcuts (in app.ts) do
  // the same thing — this dropdown is the discoverable surface.
  const gizmoModeCtrl = editFolder.add(editProxy, 'gizmoMode', ['translate', 'rotate'])
    .name('gizmo (W/E)')
    .onChange((v: 'translate' | 'rotate') => deps.setGizmoMode(v));
  editFolder.add(editProxy, 'save').name('save → manifest.json');

  // ── atmosphere ─────────────────────────────────────────────────────────
  const atmosFolder = gui.addFolder('atmosphere');
  const atmosProxy = {
    atmosphere: deps.initialAtmosphere,
    shaftHandle: '(none)',
    saveShafts: () => deps.saveShaftConfig(),
  };
  atmosFolder.add(atmosProxy, 'atmosphere', Object.keys(deps.atmospheres))
    .name('preset')
    .onChange((v: string) => {
      // Reset shaft edit when atmosphere changes — new atmosphere may not
      // have shaft handles at all.
      atmosProxy.shaftHandle = '(none)';
      shaftHandleCtrl.updateDisplay();
      deps.setShaftEditTarget('(none)');
      deps.setAtmosphere(v);
      refreshAtmosphereTunables();
    });
  let atmosphereTunableControllers: Controller[] = [];
  function refreshAtmosphereTunables() {
    for (const c of atmosphereTunableControllers) c.destroy();
    atmosphereTunableControllers = [];
    const t = deps.getActiveAtmosphere().getTunables?.();
    if (!t) return;
    for (const s of t.specs) {
      const c = atmosFolder
        .add(t.target as Record<string, number>, s.key, s.min, s.max, s.step)
        .name(s.label)
        .listen();
      atmosphereTunableControllers.push(c);
    }
  }
  refreshAtmosphereTunables();
  // Shaft endpoint editing — pick a handle, the existing TransformControls
  // gizmo attaches to it. The yellow sphere is the door/window origin; the
  // blue sphere is where the shaft splashes on the floor.
  const shaftHandleCtrl = atmosFolder.add(atmosProxy, 'shaftHandle', deps.shaftHandleIds)
    .name('edit shaft')
    .onChange((v: string) => {
      // Picking a shaft handle clears the hero selection — one gizmo at a time.
      if (v !== '(none)') {
        if (editProxy.target !== '(none)') {
          editProxy.target = '(none)';
          editTargetCtrl.updateDisplay();
          deps.setEditTarget('(none)');
        }
      }
      deps.setShaftEditTarget(v);
    });
  atmosFolder.add(atmosProxy, 'saveShafts').name('save → morning-shaft.json');

  // ── audio ──────────────────────────────────────────────────────────────
  const audioFolder = gui.addFolder('audio');
  const audioProxy = {
    muted: deps.audio.muted,
    master: deps.audio.getMasterVolume(),
    ambient: deps.audio.getChannelVolume('ambient'),
    music: deps.audio.getChannelVolume('music'),
    narration: deps.audio.getChannelVolume('narration'),
    sfx: deps.audio.getChannelVolume('sfx'),
  };
  audioFolder.add(audioProxy, 'muted')
    .name('muted')
    .onChange((v: boolean) => deps.audio.setMuted(v))
    .listen();
  audioFolder.add(audioProxy, 'master', 0, 1, 0.01)
    .name('master vol')
    .onChange((v: number) => deps.audio.setMasterVolume(v));
  audioFolder.add(audioProxy, 'ambient', 0, 1, 0.01)
    .name('ambient vol')
    .onChange((v: number) => deps.audio.setChannelVolume('ambient', v));
  audioFolder.add(audioProxy, 'music', 0, 1, 0.01)
    .name('music vol')
    .onChange((v: number) => deps.audio.setChannelVolume('music', v));
  audioFolder.add(audioProxy, 'narration', 0, 1, 0.01)
    .name('narration vol')
    .onChange((v: number) => deps.audio.setChannelVolume('narration', v));
  audioFolder.add(audioProxy, 'sfx', 0, 1, 0.01)
    .name('sfx vol')
    .onChange((v: number) => deps.audio.setChannelVolume('sfx', v));

  // Detect external changes (view toggle, programmatic camera swap, W/E/R
  // shortcuts, mute via the bottom-left pill) so the panel mirrors state
  // instead of being stale.
  let lastActiveCam = deps.getActiveCamera();
  setInterval(() => {
    stateProxy.target = deps.state.target;
    stateProxy.progress = deps.state.progress;
    stateProxy.duration = deps.state.duration;
    audioProxy.muted = deps.audio.muted;
    viewBtn.name(deps.getView() === 'exterior' ? 'go inside →' : '← go outside');

    const activeCam = deps.getActiveCamera();
    if (activeCam !== lastActiveCam) {
      lastActiveCam = activeCam;
      for (const [k, v] of Object.entries(deps.cameras)) {
        if (v === activeCam) {
          cameraProxy.camera = k;
          break;
        }
      }
      refreshCameraTunables();
    }

    // W/E shortcuts mutate gizmo mode in app.ts without going through the
    // dropdown — pull the displayed value into sync each tick.
    const mode = deps.getGizmoMode();
    if (editProxy.gizmoMode !== mode) {
      editProxy.gizmoMode = mode;
      gizmoModeCtrl.updateDisplay();
    }
  }, 100);

  // Public surface beyond the GUI itself: a way to update the edit-hero
  // dropdown options when the hero state panel retags something. lil-gui
  // doesn't reconfigure option lists in place, so we destroy + recreate.
  const refreshHeroDropdown = (newMap: Record<string, string>): void => {
    const previousValue = editProxy.target;
    editTargetCtrl.destroy();
    editTargetCtrl = editFolder.add(editProxy, 'target', newMap)
      .name('edit hero')
      .onChange(onEditTargetChanged);
    // Preserve the user's current selection across the rebuild, but only
    // if it still appears in the new option list (state retag never
    // changes the underlying ids, so this is essentially always safe).
    if (Object.values(newMap).includes(previousValue)) {
      editTargetCtrl.setValue(previousValue);
    }
  };

  return Object.assign(gui, { refreshHeroDropdown });
}
