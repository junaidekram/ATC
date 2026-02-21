import type { TaxiwayEditorLayer, EditorTaxiway } from '../map/TaxiwayEditorLayer';

/**
 * EditorPanel
 *
 * A floating HUD panel that appears on the map when the taxiway editor is
 * enabled.  It exposes controls for starting / ending lines, setting taxiway
 * metadata, undo, clear, and save.
 *
 * The panel is injected into `.map-container` so it sits above the map but
 * below any full-screen overlays.
 */
export class EditorPanel {
  private editor: TaxiwayEditorLayer;
  private container!: HTMLElement;
  private statusEl!: HTMLElement;
  private listEl!: HTMLElement;
  private isVisible = false;

  // Input refs
  private idInput!:     HTMLInputElement;
  private nameInput!:   HTMLInputElement;
  private widthInput!:  HTMLInputElement;
  private subtypeInput!: HTMLSelectElement;

  constructor(editor: TaxiwayEditorLayer) {
    this.editor = editor;
    this._buildDOM();
    this._bindEditorCallbacks();
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  show(): void {
    if (this.isVisible) return;
    this.isVisible = true;
    this.container.classList.add('editor-panel--visible');
  }

  hide(): void {
    if (!this.isVisible) return;
    this.isVisible = false;
    this.container.classList.remove('editor-panel--visible');
  }

  toggle(): void {
    this.isVisible ? this.hide() : this.show();
  }

  isShowing(): boolean {
    return this.isVisible;
  }

  // ── DOM construction ───────────────────────────────────────────────────────

  private _buildDOM(): void {
    // Inject into map-container (parent of #map)
    const mapContainer =
      document.querySelector<HTMLElement>('.map-container') ??
      document.body;

    this.container = document.createElement('div');
    this.container.className = 'editor-panel';
    this.container.innerHTML = this._template();
    mapContainer.appendChild(this.container);

    // Cache element refs
    this.statusEl    = this.container.querySelector<HTMLElement>('.ep-status')!;
    this.listEl      = this.container.querySelector<HTMLElement>('.ep-taxiway-list')!;
    this.idInput     = this.container.querySelector<HTMLInputElement>('#ep-id')!;
    this.nameInput   = this.container.querySelector<HTMLInputElement>('#ep-name')!;
    this.widthInput  = this.container.querySelector<HTMLInputElement>('#ep-width')!;
    this.subtypeInput= this.container.querySelector<HTMLSelectElement>('#ep-subtype')!;

    // Prevent map clicks firing through the panel
    L_stopPropagation(this.container);

    // Button listeners
    this._btn('ep-btn-newline',   () => this._onNewLine());
    this._btn('ep-btn-endline',   () => this.editor.endCurrentLine());
    this._btn('ep-btn-undo',      () => this.editor.undoLastNode());
    this._btn('ep-btn-clear',     () => this._onClearAll());
    this._btn('ep-btn-save',      () => this.editor.saveToFile());
    this._btn('ep-btn-close',     () => this.hide());
  }

  private _template(): string {
    return `
    <div class="ep-header">
      <span class="ep-title">✏ TAXIWAY EDITOR</span>
      <button id="ep-btn-close" class="ep-close-btn" title="Close panel">✕</button>
    </div>

    <div class="ep-section ep-meta">
      <div class="ep-row">
        <label class="ep-label" for="ep-id">ID</label>
        <input id="ep-id"    class="ep-input" type="text"   value="A"   placeholder="e.g. CA" maxlength="6" />
      </div>
      <div class="ep-row">
        <label class="ep-label" for="ep-name">Name</label>
        <input id="ep-name"  class="ep-input" type="text"   value="Alpha" placeholder="e.g. Custom Alpha" />
      </div>
      <div class="ep-row">
        <label class="ep-label" for="ep-width">Width ft</label>
        <input id="ep-width" class="ep-input ep-input--sm" type="number" value="75" min="10" max="300" />
      </div>
      <div class="ep-row">
        <label class="ep-label" for="ep-subtype">Type</label>
        <select id="ep-subtype" class="ep-input ep-select">
          <option value="taxiway"      selected>Taxiway</option>
          <option value="taxilane">Taxilane</option>
          <option value="gate_backup">Gate Backup</option>
        </select>
      </div>
    </div>

    <div class="ep-section ep-actions">
      <button id="ep-btn-newline" class="ep-btn ep-btn--primary" title="Start drawing a new line">▶ New Line</button>
      <button id="ep-btn-endline" class="ep-btn"                 title="End current line (Esc)">◼ End Line</button>
      <button id="ep-btn-undo"    class="ep-btn ep-btn--warn"    title="Undo last node (Ctrl+Z)">↩ Undo Node</button>
      <button id="ep-btn-clear"   class="ep-btn ep-btn--danger"  title="Delete all drawn taxiways">⊗ Clear All</button>
    </div>

    <div class="ep-section">
      <div class="ep-section-title">DRAWN TAXIWAYS (<span class="ep-count">0</span>)</div>
      <div class="ep-taxiway-list"></div>
    </div>

    <div class="ep-status ok">Ready</div>

    <button id="ep-btn-save" class="ep-save-btn" title="Save to data/custom_taxiways.json">
      💾 SAVE TO FILE
    </button>

    <div class="ep-hint">
      Click map → place node &nbsp;|&nbsp; Drag node → reposition (no snap)<br>
      Shift+click node → delete &nbsp;|&nbsp; Click finalized line → edit<br>
      Esc / right-click → end &nbsp;|&nbsp; 🔵 normal &nbsp; 🟡 gate snap &nbsp; 🔴 runway snap
    </div>
    `;
  }

  // ── Button helpers ─────────────────────────────────────────────────────────

  private _btn(id: string, fn: () => void): void {
    this.container.querySelector(`#${id}`)?.addEventListener('click', fn);
  }

  private _onNewLine(): void {
    const id      = (this.idInput.value.trim()    || 'A').toUpperCase();
    const name    = this.nameInput.value.trim()   || `Taxiway ${id}`;
    const width   = parseInt(this.widthInput.value, 10) || 75;
    const subtype = this.subtypeInput.value as 'taxiway' | 'taxilane' | 'gate_backup';
    this.editor.startNewLine({ id, name, width_ft: width, subtype });
  }

  private _onClearAll(): void {
    if (confirm('Delete ALL drawn taxiways? This cannot be undone.')) {
      this.editor.clearAll();
    }
  }

  // ── Editor callbacks ───────────────────────────────────────────────────────

  private _bindEditorCallbacks(): void {
    this.editor.onStateChange = (all, active) => this._refresh(all, active);
    this.editor.onStatus      = (msg, type)   => this._setStatus(msg, type ?? 'ok');
  }

  private _refresh(all: EditorTaxiway[], active: EditorTaxiway | null): void {
    // Update count
    const countEl = this.container.querySelector<HTMLElement>('.ep-count');
    if (countEl) countEl.textContent = String(all.length);

    // Rebuild taxiway list with edit/delete buttons
    this.listEl.innerHTML = '';
    for (let i = 0; i < all.length; i++) {
      const tw = all[i];
      const row = document.createElement('div');
      row.className = 'ep-tw-row';
      
      const editBtn = document.createElement('button');
      editBtn.className = 'ep-tw-btn ep-tw-btn--edit';
      editBtn.title = 'Edit this taxiway';
      editBtn.textContent = '✏';
      editBtn.addEventListener('click', () => this.editor.startEditingLine(i));
      
      const delBtn = document.createElement('button');
      delBtn.className = 'ep-tw-btn ep-tw-btn--delete';
      delBtn.title = 'Delete this taxiway';
      delBtn.textContent = '✕';
      delBtn.addEventListener('click', () => this._onDeleteTaxiway(i, tw.id));
      
      row.innerHTML = `
        <span class="ep-tw-id">${tw.id}</span>
        <span class="ep-tw-name">${tw.name}</span>
        <span class="ep-tw-nodes">${tw.nodes.length} nodes</span>
      `;
      row.appendChild(editBtn);
      row.appendChild(delBtn);
      this.listEl.appendChild(row);
    }

    // Highlight if drawing
    const newLineBtn = this.container.querySelector<HTMLButtonElement>('#ep-btn-newline');
    const endLineBtn = this.container.querySelector<HTMLButtonElement>('#ep-btn-endline');
    if (newLineBtn) newLineBtn.classList.toggle('ep-btn--drawing', active !== null);
    if (endLineBtn) endLineBtn.classList.toggle('ep-btn--active', active !== null);

    // Show active line summary if drawing
    if (active) {
      const editMsg = this.editor.isEditingExistingLine() ? ' (editing)' : ' (new)';
      this._setStatus(
        `Drawing "${active.id}" — ${active.nodes.length} node${active.nodes.length !== 1 ? 's' : ''}${editMsg}`,
        'ok',
      );
    }
  }

  private _onDeleteTaxiway(index: number, id: string): void {
    if (confirm(`Delete taxiway "${id}"?`)) {
      const all = this.editor.getTaxiways();
      all.splice(index, 1);
      this.editor.onStateChange?.(all, this.editor.getActiveTaxiway());
    }
  }

  private _setStatus(msg: string, type: 'ok' | 'warn' | 'err' = 'ok'): void {
    this.statusEl.textContent = msg;
    this.statusEl.className   = `ep-status ${type}`;
  }
}

/** Stop all mouse/touch events from bubbling through the panel to the map */
function L_stopPropagation(el: HTMLElement): void {
  [
    'click', 'dblclick', 'mousedown', 'mousemove',
    'touchstart', 'touchmove', 'wheel',
  ].forEach(evt => el.addEventListener(evt, e => e.stopPropagation()));
}
