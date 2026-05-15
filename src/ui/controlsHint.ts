// Brief controls hint that fades in shortly after first paint and dismisses
// after 7 seconds OR on the first real user gesture (drag / scroll / key).
// Aimed at first-time visitors who don't yet know orbit controls are mouse-
// drag. Re-appears on every load — small recurring tax in exchange for
// behavior that doesn't depend on localStorage timing edges.
export function createControlsHint(): void {
  const hint = document.createElement('div');
  hint.style.cssText = [
    'position: fixed',
    'top: 64px',
    'left: 50%',
    'transform: translateX(-50%)',
    'padding: 10px 18px',
    'background: rgba(15, 15, 15, 0.55)',
    'color: #ddd',
    'border-radius: 999px',
    'font: 12px/1.4 system-ui, sans-serif',
    'backdrop-filter: blur(6px)',
    'z-index: 1001',
    'pointer-events: none',
    'opacity: 0',
    'transition: opacity 0.6s ease',
    'user-select: none',
    'max-width: 90vw',
    'text-align: center',
  ].join('; ');
  hint.textContent = 'drag to look · scroll to zoom · click cassettes to play · "go inside" to enter';
  document.body.appendChild(hint);

  // Fade in shortly after load — the scene's already visible by now, so this
  // doesn't compete with the loading overlay's fade-out.
  setTimeout(() => { hint.style.opacity = '1'; }, 800);

  let dismissed = false;
  const dismiss = (e?: Event): void => {
    // Only respond to genuine user input, not synthetic events fired by
    // tooling / browser at load time.
    if (e && !e.isTrusted) return;
    if (dismissed) return;
    dismissed = true;
    hint.style.opacity = '0';
    setTimeout(() => hint.remove(), 700);
    window.removeEventListener('pointerdown', dismiss);
    window.removeEventListener('wheel', dismiss);
    window.removeEventListener('keydown', dismiss);
  };

  window.addEventListener('pointerdown', dismiss);
  window.addEventListener('wheel', dismiss);
  window.addEventListener('keydown', dismiss);
  setTimeout(() => dismiss(), 7000);
}
