// Top-center floating pill: outside/inside view toggle. The dev panel also
// exposes this (top button) but is hidden behind ?dev=1, so this is the only
// player-facing way to navigate in/out of the room.
//
// External mutations (dev panel button, keyboard shortcut, programmatic) flow
// back via the polling tick so the label stays in sync.
//
// Interactivity notes:
//  - Entire `<button>` element is the click target (including padding +
//    transparent border). Hover/active CSS makes that explicit so the whole
//    pill reads as tappable, not just the arrow text.
//  - `pointer-events: auto` is defensive against any future overlay that
//    might inherit `none` from a parent stylesheet.
export function createViewToggle(
  getView: () => 'exterior' | 'interior',
  toggle: () => void,
): void {
  const btn = document.createElement('button');
  btn.type = 'button';
  const baseCss = [
    'position: fixed',
    'top: 16px',
    'left: 50%',
    'transform: translateX(-50%)',
    'padding: 10px 22px',           // larger touch / click target
    'background: rgba(15, 15, 15, 0.7)',
    'color: #ddd',
    'border: 1px solid rgba(255, 255, 255, 0.25)',
    'border-radius: 999px',
    'cursor: pointer',
    'font: 13px/1.3 system-ui, sans-serif',
    'backdrop-filter: blur(6px)',
    'z-index: 1000',
    'user-select: none',
    'min-width: 150px',
    'text-align: center',
    'pointer-events: auto',
    'transition: background 120ms ease, border-color 120ms ease, transform 120ms ease',
  ];
  btn.style.cssText = baseCss.join('; ');

  // Hover + active feedback so the entire pill visibly reacts — not just the
  // text/arrow. Without these the rest of the padding can feel like dead space.
  btn.addEventListener('pointerenter', () => {
    btn.style.background = 'rgba(35, 35, 35, 0.82)';
    btn.style.borderColor = 'rgba(255, 255, 255, 0.45)';
  });
  btn.addEventListener('pointerleave', () => {
    btn.style.background = 'rgba(15, 15, 15, 0.7)';
    btn.style.borderColor = 'rgba(255, 255, 255, 0.25)';
    btn.style.transform = 'translateX(-50%)';
  });
  btn.addEventListener('pointerdown', () => {
    btn.style.transform = 'translateX(-50%) scale(0.97)';
  });
  btn.addEventListener('pointerup', () => {
    btn.style.transform = 'translateX(-50%)';
  });

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
