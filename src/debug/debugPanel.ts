import GUI from 'lil-gui';
import type { StateController } from '../state/stateController';
import type { Transition } from '../transitions/transition';
import type { CameraMode } from '../camera/cameraMode';
import type { AudioManager } from '../audio/audioManager';
import type { Atmosphere } from '../atmosphere/atmosphere';

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
  /** Edit-mode controls — pick a hero, get a translate/rotate/scale gizmo.
   *  Object-keyed: display label (e.g. "hero_speaker (past)") → bare hero id. */
  heroIds: Record<string, string>;
  setEditTarget: (heroId: string) => void;
  setTransformMode: (mode: 'translate' | 'rotate' | 'scale') => void;
  /** So the panel can mirror W/E/R keyboard shortcuts. */
  getTransformMode: () => 'translate' | 'rotate' | 'scale';
  /** Persist edited positions back to public/heroes/manifest.json via dev middleware. */
  saveHeroPositions: () => void;
  /** Shaft-handle editing. Dropdown options + setter. */
  shaftHandleIds: string[];
  setShaftEditTarget: (id: string) => void;
  /** Persist shaft endpoints/radii/tunables back to morning-shaft.json. */
  saveShaftConfig: () => void;
  /** Persist exterior camera pose + per-mode tunables back to positions.json. */
  saveCameraPose: () => void;
}

type Controller = ReturnType<GUI['add']>;

export type DebugPanel = GUI & {
  /** Rebuild the edit-hero dropdown options. Called after the hero state
   *  panel changes a tag — labels include the state suffix, so they go
   *  stale on retag. */
  refreshHeroDropdown(newMap: Record<string, string>): void;
};

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
  stateFolder.close();

  // ── camera ─────────────────────────────────────────────────────────────
  const cameraFolder = gui.addFolder('camera');
  const cameraProxy = {
    camera: deps.initialCamera,
    saveExterior: () => deps.saveCameraPose(),
  };
  cameraFolder.add(cameraProxy, 'camera', Object.keys(deps.cameras))
    .name('camera mode')
    .onChange((v: string) => {
      deps.setCamera(v);
      refreshCameraTunables();
    })
    .listen();
  cameraFolder.add(cameraProxy, 'saveExterior').name('save → positions.json');
  // Per-camera tunables get added below cameraProxy via refreshCameraTunables.
  let cameraTunableControllers: Controller[] = [];
  function refreshCameraTunables() {
    for (const c of cameraTunableControllers) c.destroy();
    cameraTunableControllers = [];
    const { target, specs } = deps.getActiveCamera().getTunables();
    for (const s of specs) {
      const c = cameraFolder
        .add(target as Record<string, number>, s.key, s.min, s.max, s.step)
        .name(s.label)
        .listen();
      cameraTunableControllers.push(c);
    }
  }
  refreshCameraTunables();
  cameraFolder.close();

  // ── edit ───────────────────────────────────────────────────────────────
  const editFolder = gui.addFolder('edit');
  const editProxy = {
    target: '(none)',
    mode: 'translate' as 'translate' | 'rotate' | 'scale',
    save: () => deps.saveHeroPositions(),
  };
  // editTargetCtrl is reassigned by refreshHeroDropdown when state tags
  // change — destroying and re-adding is the only lil-gui pattern for
  // updating option lists.
  let editTargetCtrl = editFolder.add(editProxy, 'target', deps.heroIds)
    .name('edit hero')
    .onChange(onEditTargetChanged);
  function onEditTargetChanged(v: string): void {
    // Picking a hero clears any shaft-handle selection — only one gizmo
    // target at a time, otherwise the panel becomes a liar.
    if (v !== '(none)' && atmosProxy.shaftHandle !== '(none)') {
      atmosProxy.shaftHandle = '(none)';
      shaftHandleCtrl.updateDisplay();
      deps.setShaftEditTarget('(none)');
    }
    deps.setEditTarget(v);
  }
  editFolder.add(editProxy, 'mode', ['translate', 'rotate', 'scale'])
    .name('mode (W/E/R)')
    .onChange((v: 'translate' | 'rotate' | 'scale') => deps.setTransformMode(v))
    .listen();
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
      // Symmetric: picking a shaft handle clears the hero gizmo.
      if (v !== '(none)' && editProxy.target !== '(none)') {
        editProxy.target = '(none)';
        editTargetCtrl.updateDisplay();
        deps.setEditTarget('(none)');
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
  audioFolder.close();

  // Detect external changes (view toggle, programmatic camera swap, W/E/R
  // shortcuts, mute via the bottom-left pill) so the panel mirrors state
  // instead of being stale.
  let lastActiveCam = deps.getActiveCamera();
  setInterval(() => {
    stateProxy.target = deps.state.target;
    stateProxy.progress = deps.state.progress;
    stateProxy.duration = deps.state.duration;
    audioProxy.muted = deps.audio.muted;
    editProxy.mode = deps.getTransformMode();
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
