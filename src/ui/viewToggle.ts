// Top-center floating pill: outside/inside view toggle. The dev panel also
// exposes this (top button) but is hidden behind ?dev=1, so this is the only
// player-facing way to navigate in/out of the room.
//
// External mutations (dev panel button, keyboard shortcut, programmatic) flow
// back via the polling tick so the label stays in sync.
export function createViewToggle(
  getView: () => 'exterior' | 'interior',
  toggle: () => void,
): void {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.style.cssText = [
    'position: fixed',
    'top: 16px',
    'left: 50%',
    'transform: translateX(-50%)',
    'padding: 8px 18px',
    'background: rgba(15, 15, 15, 0.7)',
    'color: #ddd',
    'border: 1px solid rgba(255,255,255,0.25)',
    'border-radius: 999px',
    'cursor: pointer',
    'font: 13px/1.3 system-ui, sans-serif',
    'backdrop-filter: blur(6px)',
    'z-index: 1000',
    'user-select: none',
    'min-width: 130px',
    'text-align: center',
  ].join('; ');

  const render = (): void => {
    btn.textContent = getView() === 'exterior' ? 'go inside →' : '← go outside';
  };
  render();
  btn.addEventListener('click', () => {
    toggle();
    render();
  });
  document.body.appendChild(btn);

  // External mutations (dev panel toggleView, future keyboard shortcut) —
  // 100ms polling matches the dev panel's mirror loop, cheap and uncomplicated.
  setInterval(render, 100);
}
