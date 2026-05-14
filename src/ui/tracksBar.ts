import type { AudioManager, AudioChannel } from '../audio/audioManager';
import type { AudioAsset } from '../audio/manifest';

// Bottom-center: per-channel "now playing" row above the full catalog row.
// Whole thing polls audio.listPlaying() — churn is rare enough that 200ms
// feels live. Chips are clickable and will audition a track on the SFX
// channel (so a click-to-preview doesn't fight whatever ambient is running).
export function createTracksBar(audio: AudioManager, assets: AudioAsset[]): void {
  const wrapper = document.createElement('div');
  wrapper.style.cssText = [
    'position: fixed',
    'bottom: 16px',
    'left: 50%',
    'transform: translateX(-50%)',
    'display: flex',
    'flex-direction: column',
    'gap: 6px',
    'align-items: center',
    'padding: 8px 14px',
    'background: rgba(15, 15, 15, 0.7)',
    'color: #ddd',
    'font: 12px/1.3 system-ui, sans-serif',
    'border-radius: 12px',
    'backdrop-filter: blur(6px)',
    'z-index: 1000',
    'user-select: none',
    'max-width: min(640px, 60vw)',
  ].join('; ');

  const channels: AudioChannel[] = ['ambient', 'music', 'narration', 'sfx'];

  const channelRow = document.createElement('div');
  channelRow.style.cssText = 'display: flex; gap: 8px; flex-wrap: wrap; justify-content: center;';
  const channelLabels: Record<AudioChannel, HTMLDivElement> = {} as Record<AudioChannel, HTMLDivElement>;
  for (const ch of channels) {
    const div = document.createElement('div');
    div.style.cssText = 'padding: 2px 8px; border-radius: 999px; background: rgba(255,255,255,0.06); white-space: nowrap;';
    channelLabels[ch] = div;
    channelRow.appendChild(div);
  }

  const trackRow = document.createElement('div');
  trackRow.style.cssText = 'display: flex; gap: 6px; flex-wrap: wrap; justify-content: center;';
  const trackChips = new Map<string, HTMLDivElement>();
  for (const a of assets) {
    const chip = document.createElement('div');
    chip.style.cssText = 'padding: 2px 8px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.15); transition: background 120ms, color 120ms, border-color 120ms; cursor: pointer;';
    chip.textContent = a.id;
    chip.title = `audition ${a.id} on sfx channel`;
    chip.addEventListener('click', async () => {
      // Audition: route to sfx channel so we don't fight the ambient/music
      // bus. exclusive on sfx so repeated clicks restart the preview rather
      // than overlapping.
      try { await audio.resume(); } catch { /* ignored */ }
      audio.play(a.id, { channel: 'sfx', volume: 0.8, fadeIn: 0.05, exclusive: true });
    });
    trackChips.set(a.id, chip);
    trackRow.appendChild(chip);
  }

  wrapper.appendChild(channelRow);
  wrapper.appendChild(trackRow);
  document.body.appendChild(wrapper);

  const ACTIVE = '#9fd66b';
  const IDLE = '#8a8a8a';

  const render = () => {
    const playing = audio.listPlaying();
    const byChannel: Partial<Record<AudioChannel, string>> = {};
    const playingIds = new Set<string>();
    for (const p of playing) {
      // If somehow two sources hit the same channel, keep the first seen —
      // ambient/music are designed to be one-at-a-time per channel.
      if (!byChannel[p.channel]) byChannel[p.channel] = p.id;
      playingIds.add(p.id);
    }
    for (const ch of channels) {
      const id = byChannel[ch];
      channelLabels[ch].textContent = id ? `${ch}: ${id}` : `${ch}: —`;
      channelLabels[ch].style.color = id ? ACTIVE : IDLE;
    }
    for (const [id, chip] of trackChips) {
      const on = playingIds.has(id);
      chip.style.background = on ? 'rgba(159, 214, 107, 0.18)' : 'transparent';
      chip.style.borderColor = on ? 'rgba(159, 214, 107, 0.55)' : 'rgba(255,255,255,0.15)';
      chip.style.color = on ? '#cfe9b3' : IDLE;
    }
  };
  render();
  setInterval(render, 200);
}
