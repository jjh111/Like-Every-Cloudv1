// Tiny unobtrusive corner button to enter or exit the authoring view.
// Clicking it toggles `?dev=1` in the URL and reloads — the page reloads
// (rather than mounting/unmounting the dev panel live) because the dev
// UI lifecycle is wired at boot in app.ts. Cheap, predictable, and the
// asset cache means it's near-instant on the second load.
export function createDevToggle(currentlyDev: boolean): void {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.title = currentlyDev ? 'Exit dev view' : 'Open dev panel';
  btn.style.cssText = [
    'position: fixed',
    'top: 16px',
    'right: 16px',
    'width: 36px',                  // slightly larger touch target
    'height: 36px',
    'padding: 0',
    'background: rgba(15, 15, 15, 0.55)',
    'color: #ddd',
    'border: 1px solid rgba(255, 255, 255, 0.2)',
    'border-radius: 999px',
    'cursor: pointer',
    'font: 14px/1 system-ui, sans-serif',
    'backdrop-filter: blur(6px)',
    'z-index: 1000',
    'user-select: none',
    'display: flex',
    'align-items: center',
    'justify-content: center',
    'opacity: 0.7',
    'touch-action: manipulation',   // no 300ms iOS tap delay
    'transition: opacity 120ms ease',
  ].join('; ');
  btn.textContent = currentlyDev ? '×' : '⚙';

  // Pointer events fire for both mouse hover AND touch contact — so the
  // visual emphasis works for both input modes.
  btn.addEventListener('pointerenter', () => { btn.style.opacity = '1'; });
  btn.addEventListener('pointerleave', () => { btn.style.opacity = '0.7'; });

  btn.addEventListener('click', () => {
    const url = new URL(window.location.href);
    if (currentlyDev) url.searchParams.delete('dev');
    else url.searchParams.set('dev', '1');
    window.location.href = url.toString();
  });

  document.body.appendChild(btn);
}
