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
  /** Edit-mode controls — pick a hero, get a translate/rotate/scale gizmo. */
  heroIds: string[];
  setEditTarget: (heroId: string) => void;
  setTransformMode: (mode: 'translate' | 'rotate' | 'scale') => void;
  /** So the panel can mirror W/E/R keyboard shortcuts. */
  getTransformMode: () => 'translate' | 'rotate' | 'scale';
  logHeroPositions: () => void;
  /** Persist edited positions back to public/heroes/manifest.json via dev middleware. */
  saveHeroPositions: () => void;
}

type Controller = ReturnType<GUI['add']>;

export function createDebugPanel(deps: DebugDeps): GUI {
  const gui = new GUI({ title: 'LEC dev panel' });

  // View toggle sits at the top — it's the primary navigation control. The
  // label updates from the polling tick below to reflect the current view.
  const viewProxy = { go: () => deps.toggleView() };
  const viewBtn = gui.add(viewProxy, 'go').name('go inside →');

  const proxy = {
    target: deps.state.target,
    progress: deps.state.progress,
    duration: deps.state.duration,
    transition: deps.initialTransition,
    camera: deps.initialCamera,
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
        deps.state.duration = proxy.duration > 0 ? proxy.duration : 1;
        deps.state.setTarget(next);
        next = next === 'present' ? 'past' : 'present';
      };
    })(),
  };

  gui.add(proxy, 'target', ['past', 'present'])
    .onChange((v: 'past' | 'present') => deps.state.setTarget(v))
    .listen();
  gui.add(proxy, 'progress', 0, 1, 0.001)
    .onChange((v: number) => deps.state.setProgress(v))
    .listen();
  gui.add(proxy, 'duration', 0, 5, 0.1)
    .onChange((v: number) => { deps.state.duration = v; });
  gui.add(proxy, 'snapPast').name('snap → past');
  gui.add(proxy, 'snapPresent').name('snap → present');
  gui.add(proxy, 'animateOther').name('animate to other');

  gui.add(proxy, 'transition', Object.keys(deps.transitions))
    .onChange((v: string) => deps.setTransition(v));

  // Audio cluster — sits between state/transition and camera, so each section
  // is contiguous rather than camera being split by audio sliders.
  const audioProxy = {
    muted: deps.audio.muted,
    master: deps.audio.getMasterVolume(),
    ambient: deps.audio.getChannelVolume('ambient'),
    music: deps.audio.getChannelVolume('music'),
    narration: deps.audio.getChannelVolume('narration'),
    sfx: deps.audio.getChannelVolume('sfx'),
    resume: () => { void deps.audio.resume(); },
  };
  gui.add(audioProxy, 'muted')
    .name('muted')
    .onChange((v: boolean) => deps.audio.setMuted(v))
    .listen();
  gui.add(audioProxy, 'master', 0, 1, 0.01)
    .name('master vol')
    .onChange((v: number) => deps.audio.setMasterVolume(v));
  gui.add(audioProxy, 'ambient', 0, 1, 0.01)
    .name('ambient vol')
    .onChange((v: number) => deps.audio.setChannelVolume('ambient', v));
  gui.add(audioProxy, 'music', 0, 1, 0.01)
    .name('music vol')
    .onChange((v: number) => deps.audio.setChannelVolume('music', v));
  gui.add(audioProxy, 'narration', 0, 1, 0.01)
    .name('narration vol')
    .onChange((v: number) => deps.audio.setChannelVolume('narration', v));
  gui.add(audioProxy, 'sfx', 0, 1, 0.01)
    .name('sfx vol')
    .onChange((v: number) => deps.audio.setChannelVolume('sfx', v));
  gui.add(audioProxy, 'resume').name('resume audio');

  gui.add(proxy, 'camera', Object.keys(deps.cameras))
    .name('camera mode')
    .onChange((v: string) => {
      deps.setCamera(v);
      refreshTunables();
    })
    .listen();

  // Edit-mode block: pick a hero, get a TransformControls gizmo on it.
  // Auto-switches to freeform camera when a target is picked. The 'log
  // positions' button prints current transforms to console — paste into
  // public/heroes/manifest.json to persist the new placement.
  const editProxy = {
    target: '(none)',
    mode: 'translate' as 'translate' | 'rotate' | 'scale',
    log: () => deps.logHeroPositions(),
    save: () => deps.saveHeroPositions(),
  };
  gui.add(editProxy, 'target', deps.heroIds)
    .name('edit hero')
    .onChange((v: string) => deps.setEditTarget(v));
  gui.add(editProxy, 'mode', ['translate', 'rotate', 'scale'])
    .name('mode (W/E/R)')
    .onChange((v: 'translate' | 'rotate' | 'scale') => deps.setTransformMode(v))
    .listen();
  gui.add(editProxy, 'log').name('log positions');
  gui.add(editProxy, 'save').name('save → manifest.json');

  // Atmosphere picker + its own tunables (refreshed whenever it changes).
  const atmosProxy = { atmosphere: deps.initialAtmosphere };
  gui.add(atmosProxy, 'atmosphere', Object.keys(deps.atmospheres))
    .name('atmosphere')
    .onChange((v: string) => {
      deps.setAtmosphere(v);
      refreshAtmosphereTunables();
    });

  let tunableControllers: Controller[] = [];
  let atmosphereTunableControllers: Controller[] = [];

  function refreshTunables() {
    for (const c of tunableControllers) c.destroy();
    tunableControllers = [];
    const { target, specs } = deps.getActiveCamera().getTunables();
    for (const s of specs) {
      const c = gui
        .add(target as Record<string, number>, s.key, s.min, s.max, s.step)
        .name(s.label)
        .listen();
      tunableControllers.push(c);
    }
  }
  function refreshAtmosphereTunables() {
    for (const c of atmosphereTunableControllers) c.destroy();
    atmosphereTunableControllers = [];
    const t = deps.getActiveAtmosphere().getTunables?.();
    if (!t) return;
    for (const s of t.specs) {
      const c = gui
        .add(t.target as Record<string, number>, s.key, s.min, s.max, s.step)
        .name(s.label)
        .listen();
      atmosphereTunableControllers.push(c);
    }
  }
  refreshTunables();
  refreshAtmosphereTunables();

  // Detect external camera changes (e.g. the view toggle button) so the
  // panel's dropdown + tunables follow along.
  let lastActiveCam = deps.getActiveCamera();
  setInterval(() => {
    proxy.target = deps.state.target;
    proxy.progress = deps.state.progress;
    proxy.duration = deps.state.duration;
    audioProxy.muted = deps.audio.muted;
    editProxy.mode = deps.getTransformMode();
    viewBtn.name(deps.getView() === 'exterior' ? 'go inside →' : '← go outside');

    const activeCam = deps.getActiveCamera();
    if (activeCam !== lastActiveCam) {
      lastActiveCam = activeCam;
      for (const [k, v] of Object.entries(deps.cameras)) {
        if (v === activeCam) {
          proxy.camera = k;
          break;
        }
      }
      refreshTunables();
    }
  }, 100);

  return gui;
}
