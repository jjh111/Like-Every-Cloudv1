import type { Object3D } from 'three';
import type { StateController } from '../state/stateController';

// Bottom-right floating panel: every hero in the lookup with a past/present/both
// radio. Toggling sets userData.state on the Object3D and invokes
// onStateToggled (the caller re-inits the transition + refreshes the
// dev-panel dropdown labels). Polls every 500ms so external changes
// (loads, saves, future per-state edits) reflect in the radios.
export function createHeroStatePanel(
  heroLookup: Map<string, Object3D>,
  state: StateController,
  onStateToggled: () => void,
): void {
  const panel = document.createElement('div');
  panel.style.cssText = [
    'position: fixed',
    'bottom: 16px',
    'right: 16px',
    'padding: 10px 14px',
    'background: rgba(15, 15, 15, 0.72)',
    'color: #ddd',
    'font: 11px/1.35 system-ui, sans-serif',
    'border-radius: 12px',
    'backdrop-filter: blur(6px)',
    'z-index: 1000',
    'user-select: none',
    'min-width: 250px',
    'max-height: 70vh',
    'overflow-y: auto',
  ].join('; ');
  document.body.appendChild(panel);

  const header = document.createElement('div');
  header.style.cssText = 'font-weight: 600; margin-bottom: 8px; display: flex; gap: 8px; align-items: center; justify-content: space-between;';
  const headerName = document.createElement('span');
  const headerStateBadge = document.createElement('span');
  headerStateBadge.style.cssText = 'padding: 1px 7px; border-radius: 999px; background: rgba(159, 214, 107, 0.18); color: #cfe9b3; font-weight: 500; font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em;';
  header.appendChild(headerName);
  header.appendChild(headerStateBadge);
  panel.appendChild(header);

  // Column headers — small caption row above the radio columns.
  const colHeader = document.createElement('div');
  colHeader.style.cssText = 'display: grid; grid-template-columns: 1fr 36px 36px 36px; gap: 4px; font-size: 9px; text-transform: uppercase; letter-spacing: 0.08em; color: #888; padding: 2px 0 4px;';
  colHeader.innerHTML = '<span></span><span style="text-align:center">past</span><span style="text-align:center">pres</span><span style="text-align:center">both</span>';
  panel.appendChild(colHeader);

  const rowsRoot = document.createElement('div');
  panel.appendChild(rowsRoot);

  interface RowRefs {
    radios: Record<'past' | 'present' | 'both', HTMLInputElement>;
  }
  const rows = new Map<string, RowRefs>();

  const states: Array<'past' | 'present' | 'both'> = ['past', 'present', 'both'];

  const buildRows = () => {
    while (rowsRoot.firstChild) rowsRoot.removeChild(rowsRoot.firstChild);
    rows.clear();

    const keys = Array.from(heroLookup.keys()).sort();
    for (const id of keys) {
      const obj = heroLookup.get(id);
      if (!obj) continue;
      // Groups (#all) have no state — skip in the panel.
      if (id.endsWith('#all')) continue;

      const row = document.createElement('div');
      row.style.cssText = 'display: grid; grid-template-columns: 1fr 36px 36px 36px; gap: 4px; padding: 2px 0; align-items: center; border-top: 1px solid rgba(255,255,255,0.05);';

      const label = document.createElement('span');
      label.textContent = id;
      label.style.cssText = 'opacity: 0.85; font-family: ui-monospace, Menlo, monospace; font-size: 10.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;';
      row.appendChild(label);

      // Per-row radio name — keeps the three options mutually exclusive
      // within the row without colliding across rows.
      const groupName = 'state-' + id.replace(/[^a-z0-9]/gi, '-');
      const radios: Partial<Record<'past' | 'present' | 'both', HTMLInputElement>> = {};
      for (const s of states) {
        const cell = document.createElement('label');
        cell.style.cssText = 'display: flex; justify-content: center; align-items: center; cursor: pointer;';
        const input = document.createElement('input');
        input.type = 'radio';
        input.name = groupName;
        input.value = s;
        input.style.cssText = 'accent-color: #9fd66b; cursor: pointer;';
        input.addEventListener('change', () => {
          if (!input.checked) return;
          // heroLookup is instance-keyed, so this change targets only this
          // specific Object3D. Multi-placement heroes get one row each.
          obj.userData.state = s;
          onStateToggled();
        });
        cell.appendChild(input);
        row.appendChild(cell);
        radios[s] = input;
      }
      rowsRoot.appendChild(row);
      rows.set(id, { radios: radios as RowRefs['radios'] });
    }
  };

  buildRows();

  // Polling tick: keep the header and the radio selections in sync with
  // current data so external changes (e.g. a save that reloads tags, or
  // future per-state edits) reflect here.
  const render = () => {
    const count = rows.size;
    headerName.textContent = `${count} hero${count === 1 ? '' : 'es'}`;
    headerStateBadge.textContent = state.current;
    for (const [id, refs] of rows) {
      const obj = heroLookup.get(id);
      if (!obj) continue;
      const tag = (obj.userData.state ?? 'past') as 'past' | 'present' | 'both';
      for (const s of states) {
        const input = refs.radios[s];
        const shouldBe = s === tag;
        if (input.checked !== shouldBe) input.checked = shouldBe;
      }
    }
  };
  render();
  setInterval(render, 500);
}

// Build the edit-hero dropdown map. Keys are display labels with a state
// suffix (e.g. `hero_speaker (past)`); values are the bare hero ids that
// setEditTarget understands. lil-gui treats object-shaped option lists as
// label→value, so we get readable labels without changing the setter.
export function buildHeroDropdownMap(heroLookup: Map<string, Object3D>): Record<string, string> {
  const map: Record<string, string> = { '(none)': '(none)' };
  for (const k of Array.from(heroLookup.keys()).sort()) {
    const obj = heroLookup.get(k);
    if (!obj) continue;
    if (k.endsWith('#all')) {
      map[`${k} (group)`] = k;
      continue;
    }
    const tag = obj.userData.state as string | undefined;
    map[tag ? `${k} (${tag})` : k] = k;
  }
  return map;
}
