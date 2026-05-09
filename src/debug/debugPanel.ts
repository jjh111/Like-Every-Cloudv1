import GUI from 'lil-gui';
import type { StateController } from '../state/stateController';
import type { Transition } from '../transitions/transition';
import type { CameraMode } from '../camera/cameraMode';

export interface DebugDeps {
  state: StateController;
  transitions: Record<string, Transition>;
  setTransition: (name: string) => void;
  initialTransition: string;
  cameras: Record<string, CameraMode>;
  setCamera: (name: string) => void;
  initialCamera: string;
}

export function createDebugPanel(deps: DebugDeps): GUI {
  const gui = new GUI({ title: 'LEC dev panel' });

  const stateFolder = gui.addFolder('State');
  const proxy = {
    target: deps.state.target,
    progress: deps.state.progress,
    duration: deps.state.duration,
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

  stateFolder
    .add(proxy, 'target', ['past', 'present'])
    .onChange((v: 'past' | 'present') => deps.state.setTarget(v))
    .listen();
  stateFolder
    .add(proxy, 'progress', 0, 1, 0.001)
    .onChange((v: number) => deps.state.setProgress(v))
    .listen();
  stateFolder
    .add(proxy, 'duration', 0, 5, 0.1)
    .onChange((v: number) => {
      deps.state.duration = v;
    });
  stateFolder.add(proxy, 'snapPast').name('snap → past');
  stateFolder.add(proxy, 'snapPresent').name('snap → present');
  stateFolder.add(proxy, 'animateOther').name('animate to other');

  const transitionFolder = gui.addFolder('Transition');
  const tProxy = { name: deps.initialTransition };
  transitionFolder
    .add(tProxy, 'name', Object.keys(deps.transitions))
    .name('strategy')
    .onChange((v: string) => deps.setTransition(v));

  const cameraFolder = gui.addFolder('Camera');
  const cProxy = { name: deps.initialCamera };
  cameraFolder
    .add(cProxy, 'name', Object.keys(deps.cameras))
    .name('mode')
    .onChange((v: string) => deps.setCamera(v));

  // Keep proxy in sync so .listen() reflects external changes (auto-tick).
  setInterval(() => {
    proxy.target = deps.state.target;
    proxy.progress = deps.state.progress;
    proxy.duration = deps.state.duration;
  }, 100);

  return gui;
}
