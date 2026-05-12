import GUI from 'lil-gui';
import type { StateController } from '../state/stateController';
import type { Transition } from '../transitions/transition';
import type { CameraMode } from '../camera/cameraMode';
import type { AudioManager } from '../audio/audioManager';

export interface DebugDeps {
  state: StateController;
  transitions: Record<string, Transition>;
  setTransition: (name: string) => void;
  initialTransition: string;
  cameras: Record<string, CameraMode>;
  initialCamera: string;
  setCamera: (name: string) => void;
  getActiveCamera: () => CameraMode;
  audio: AudioManager;
}

type Controller = ReturnType<GUI['add']>;

export function createDebugPanel(deps: DebugDeps): GUI {
  const gui = new GUI({ title: 'LEC dev panel' });

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
    });

  let tunableControllers: Controller[] = [];

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
  refreshTunables();

  setInterval(() => {
    proxy.target = deps.state.target;
    proxy.progress = deps.state.progress;
    proxy.duration = deps.state.duration;
    audioProxy.muted = deps.audio.muted;
  }, 100);

  return gui;
}
