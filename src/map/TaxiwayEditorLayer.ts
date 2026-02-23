import L from 'leaflet';
import { catmullRom } from './curveUtils';
import { DataLoader } from '../data/DataLoader';
import type { Gate } from './GateLayer';

// ── Public interfaces ────────────────────────────────────────────────────────

export interface EditorNode {
  id: string;
  lat: number;
  lon: number;
  /** 'gate' when snapped to a gate dot; 'runway_end' when snapped near a runway threshold */
  type: 'normal' | 'gate' | 'runway_end';
  /** Gate id or external node id this was snapped to, if any */
  snappedToId?: string;
}

export interface EditorTaxiway {
  id: string;
  name: string;
  width_ft: number;
  subtype: 'taxiway' | 'taxilane' | 'gate_backup';
  nodes: EditorNode[];
}

export interface EditorSavePayload {
  metadata: {
    airport: string;
    description: string;
    coordinate_system: string;
    source: string;
    last_updated: string;
  };
  taxiways: Array<{
    id: string;
    name: string;
    width_ft: number;
    subtype: string;
    nodes: Array<{ id: string; lat: number; lon: number }>;
  }>;
  graph_edges: Array<{ from: string; to: string; dist_ft: number }>;
}

// ── Colours ──────────────────────────────────────────────────────────────────

const COLOR_NORMAL_NODE   = '#29b6f6';   // blue
const COLOR_GATE_NODE     = '#ffd600';   // gold
const COLOR_RUNWAY_NODE   = '#ff7043';   // orange-red
const COLOR_ACTIVE_LINE   = '#00e676';   // green — line being drawn
const COLOR_FINALIZED     = '#ff9800';   // amber — taxiway/taxilane finalized
const COLOR_GATE_BACKUP   = '#ce93d8';   // purple — gate backup path
const COLOR_PREVIEW       = '#29b6f680'; // translucent blue
const COLOR_SNAP_RING     = '#ffffff';

const SNAP_RADIUS_PX = 18; // pixels

// ── TaxiwayEditorLayer ────────────────────────────────────────────────────────

/**
 * TaxiwayEditorLayer
 *
 * Provides an interactive draw-on-map mode for authoring custom taxiway
 * centerlines.  Users place nodes by clicking; nodes auto-snap to gates
 * and existing nodes within a pixel radius.  Lines are smoothed using
 * Catmull-Rom interpolation between nodes.
 *
 * Usage:
 *   const editor = new TaxiwayEditorLayer(map, gates);
 *   editor.enable();    // attach listeners
 *   editor.disable();   // detach listeners, keep drawn data
 *   editor.serialize(); // get save payload
 */
export class TaxiwayEditorLayer {
  private map: L.Map;
  private gates: Gate[];

  /** All fully committed taxiways (line was ended with Escape / right-click / End Line btn) */
  private allTaxiways: EditorTaxiway[] = [];
  /** The taxiway currently being drawn (null when not in draw mode) */
  private activeTaxiway: EditorTaxiway | null = null;

  private isEnabled = false;
  /** Index in allTaxiways of the taxiway currently being edited (null if editing a new line) */
  private editingIndex: number | null = null;
  /** Map of finalized taxiway ids to their polyline for click detection */
  private finalizedPolylines: Map<string, L.Polyline> = new Map();

  // ── Leaflet layers ─────────────────────────────────────────────────────────
  private finalizedLayer     = L.layerGroup();   // finalized taxiways
  private activePolylineLayer= L.layerGroup();   // current line smooth curve
  private nodeMarkerLayer    = L.layerGroup();   // all placed node circles
  private previewLayer       = L.layerGroup();   // live cursor dashed segment
  private snapRingLayer      = L.layerGroup();   // snap highlight ring

  // ── Drag state ────────────────────────────────────────────────────────────
  /** Index into activeTaxiway.nodes of the node currently being dragged, or null */
  private _draggingNodeIndex: number | null = null;
  /** True once the pointer has moved far enough to count as a drag */
  private _isDragging = false;
  /** Set to true on mouseup after a drag so the subsequent click can be swallowed */
  private _dragJustEnded = false;

  // ── Event-handler references (needed for removal) ─────────────────────────
  private _onClickHandler       = this._onMapClick.bind(this);
  private _onMouseMoveHandler   = this._onMapMouseMove.bind(this);
  private _onContextMenuHandler = this._onMapRightClick.bind(this);
  private _onKeyDownHandler     = this._onKeyDown.bind(this);
  private _onMouseDownHandler   = this._onMouseDown.bind(this);
  private _onMouseUpHandler     = this._onMouseUp.bind(this);

  // ── Callbacks for the EditorPanel UI ──────────────────────────────────────
  /** Called whenever the editor state changes (node placed, line ended, clear) */
  onStateChange?: (allTaxiways: EditorTaxiway[], active: EditorTaxiway | null) => void;
  /** Toast message callback */
  onStatus?: (msg: string, type?: 'ok' | 'warn' | 'err') => void;

  constructor(map: L.Map, gates: Gate[]) {
    this.map   = map;
    this.gates = gates;

    // Add all layers to the map; they render on top of everything else (high z-index)
    this.finalizedLayer     .addTo(map);
    this.activePolylineLayer.addTo(map);
    this.nodeMarkerLayer    .addTo(map);
    this.previewLayer       .addTo(map);
    this.snapRingLayer      .addTo(map);
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  enable(): void {
    if (this.isEnabled) return;
    this.isEnabled = true;
    this.map.getContainer().style.cursor = 'crosshair';
    this.map.on('click',       this._onClickHandler);
    this.map.on('mousemove',   this._onMouseMoveHandler);
    this.map.on('contextmenu', this._onContextMenuHandler);
    this.map.on('mousedown',   this._onMouseDownHandler);
    this.map.on('mouseup',     this._onMouseUpHandler);
    document.addEventListener('keydown', this._onKeyDownHandler);
    this.onStatus?.('Editor active — click map to place nodes; drag nodes to reposition', 'ok');
  }

  disable(): void {
    if (!this.isEnabled) return;
    this.isEnabled = false;
    this.map.getContainer().style.cursor = '';
    this.map.off('click',       this._onClickHandler);
    this.map.off('mousemove',   this._onMouseMoveHandler);
    this.map.off('contextmenu', this._onContextMenuHandler);
    this.map.off('mousedown',   this._onMouseDownHandler);
    this.map.off('mouseup',     this._onMouseUpHandler);
    document.removeEventListener('keydown', this._onKeyDownHandler);
    // Clean up any in-progress drag
    this._draggingNodeIndex = null;
    this._isDragging = false;
    this.map.dragging.enable();
    this.previewLayer.clearLayers();
    this.snapRingLayer.clearLayers();
    this.onStatus?.('Editor disabled', 'ok');
  }

  /**
   * Begin a new taxiway with the given metadata.
   * If a line was actively being drawn, it is finalized first.
   */
  startNewLine(meta: Pick<EditorTaxiway, 'id' | 'name' | 'width_ft' | 'subtype'>): void {
    if (this.activeTaxiway && this.activeTaxiway.nodes.length >= 2) {
      this._finalizeActive();
    } else if (this.activeTaxiway) {
      // Less than 2 nodes — discard silently
      this.activeTaxiway = null;
    }
    this.editingIndex = null;  // clear edit mode
    this.activeTaxiway = { ...meta, nodes: [] };
    this._redrawActive();
    this._notify();
    this.onStatus?.(`New line: "${meta.id}" — click map to start placing nodes`, 'ok');
  }

  /**
   * Start editing an existing finalized taxiway by its index.
   */
  startEditingLine(index: number): void {
    if (index < 0 || index >= this.allTaxiways.length) {
      this.onStatus?.('Invalid taxiway index', 'err');
      return;
    }
    if (this.activeTaxiway && this.activeTaxiway.nodes.length >= 2) {
      this._finalizeActive();
    }
    this.editingIndex = index;
    this.activeTaxiway = { ...this.allTaxiways[index] };  // clone for editing
    this.allTaxiways.splice(index, 1);  // remove from finalized
    this._redrawActive();
    this._notify();
    this.onStatus?.(`Editing "${this.activeTaxiway.id}" — Shift+click nodes to delete, Esc to cancel`, 'ok');
  }

  /**
   * Delete a node at the given index from the active taxiway.
   */
  deleteNodeFromActive(nodeIndex: number): void {
    if (!this.activeTaxiway || nodeIndex < 0 || nodeIndex >= this.activeTaxiway.nodes.length) {
      this.onStatus?.('Cannot delete node', 'warn');
      return;
    }
    this.activeTaxiway.nodes.splice(nodeIndex, 1);
    this._redrawActive();
    this._notify();
    this.onStatus?.(`Node deleted — ${this.activeTaxiway.nodes.length} nodes remaining`, 'ok');
  }

  /**
   * End the current line being drawn or edited.
   * If in edit mode, saves back to allTaxiways.
   */
  endCurrentLine(): void {
    if (!this.activeTaxiway) {
      this.onStatus?.('No active line to end', 'warn');
      return;
    }
    if (this.activeTaxiway.nodes.length < 2) {
      this.onStatus?.('Need at least 2 nodes — line discarded', 'warn');
      // If was editing, restore it
      if (this.editingIndex !== null) {
        this.allTaxiways.splice(this.editingIndex, 0, this.activeTaxiway);
      }
      this.activeTaxiway = null;
      this.editingIndex = null;
      this._redrawActive();
      this._notify();
      return;
    }
    this._finalizeActive();
    this._notify();
  }

  /**
   * Remove the last placed node from the active taxiway.
   */
  undoLastNode(): void {
    if (!this.activeTaxiway || this.activeTaxiway.nodes.length === 0) {
      this.onStatus?.('Nothing to undo', 'warn');
      return;
    }
    this.activeTaxiway.nodes.pop();
    this._redrawActive();
    this._notify();
    this.onStatus?.(`Undo — ${this.activeTaxiway.nodes.length} nodes remaining`, 'ok');
  }

  /**
   * Clear ALL drawn taxiways and reset editor state.
   */
  clearAll(): void {
    this.allTaxiways = [];
    this.activeTaxiway = null;
    this.editingIndex = null;
    this.finalizedPolylines.clear();
    this.finalizedLayer.clearLayers();
    this.activePolylineLayer.clearLayers();
    this.nodeMarkerLayer.clearLayers();
    this.previewLayer.clearLayers();
    this.snapRingLayer.clearLayers();
    this._notify();
    this.onStatus?.('All taxiways cleared', 'warn');
  }

  /**
   * Returns the full list of committed taxiways.
   */
  getTaxiways(): EditorTaxiway[] {
    return this.allTaxiways;
  }

  getActiveTaxiway(): EditorTaxiway | null {
    return this.activeTaxiway;
  }

  /**
   * Returns true if currently editing an existing taxiway (vs. drawing new).
   */
  isEditingExistingLine(): boolean {
    return this.editingIndex !== null;
  }

  /**
   * Pre-populate the editor from a previously saved custom_taxiways.json.
   * Call this before enable() so users can resume editing saved lines.
   */
  loadFromSaved(rawTaxiways: Array<{
    id: string;
    name: string;
    width_ft: number;
    subtype: string;
    nodes: Array<{ id: string; lat: number; lon: number }>;
  }>): void {
    this.allTaxiways = rawTaxiways
      .filter(tw => Array.isArray(tw.nodes) && tw.nodes.length >= 2)
      .map(tw => ({
        id:       tw.id,
        name:     tw.name,
        width_ft: tw.width_ft ?? 75,
        subtype:  (tw.subtype === 'taxilane' ? 'taxilane' : tw.subtype === 'gate_backup' ? 'gate_backup' : 'taxiway') as 'taxiway' | 'taxilane' | 'gate_backup',
        nodes:    tw.nodes.map(n => ({
          id:   n.id,
          lat:  n.lat,
          lon:  n.lon,
          type: 'normal' as const,
        })),
      }));
    this._redrawAllFinalized();
    this._redrawActive();
    this._notify();
  }

  /**
   * Build the save payload from all committed taxiways.
   */
  serialize(): EditorSavePayload {
    const taxiwayNodes = this.allTaxiways.map(tw => ({
      id:       tw.id,
      name:     tw.name,
      width_ft: tw.width_ft,
      subtype:  tw.subtype,
      nodes:    tw.nodes.map(n => ({ id: n.id, lat: n.lat, lon: n.lon })),
    }));

    // Build graph edges: consecutive node pairs within each taxiway (bidirectional)
    // + shared-node connections when two taxiways share the same snapped node id.
    const edgeSet = new Set<string>();
    const edges: EditorSavePayload['graph_edges'] = [];

    const addEdge = (a: EditorNode, b: EditorNode) => {
      const key = [a.id, b.id].sort().join('|');
      if (edgeSet.has(key)) return;
      edgeSet.add(key);
      const d = DataLoader.haversineFt(a.lat, a.lon, b.lat, b.lon);
      edges.push({ from: a.id, to: b.id, dist_ft: Math.round(d) });
    };

    for (const tw of this.allTaxiways) {
      for (let i = 0; i < tw.nodes.length - 1; i++) {
        addEdge(tw.nodes[i], tw.nodes[i + 1]);
      }
    }

    // Cross-taxiway connectivity at shared nodes
    // Build a map: nodeId → [node, ...] across all taxiways
    const nodeById = new Map<string, EditorNode>();
    for (const tw of this.allTaxiways) {
      for (const n of tw.nodes) nodeById.set(n.id, n);
    }

    // If two taxiways share a node (same id or snappedToId), the in-taxiway
    // consecutive edges already handle it since the node id is the same.
    // But if a node was snapped to a gate (GATE_X), we need an edge from
    // the GATE_X id to this node's predecessor/successor — those edges already
    // exist because the node itself IS the GATE_X node.

    return {
      metadata: {
        airport:           'KSLC',
        description:       'Custom taxiway network — drawn with ATC Simulator editor',
        coordinate_system: 'WGS84 decimal degrees',
        source:            'ATC Simulator Taxiway Editor',
        last_updated:      new Date().toISOString(),
      },
      taxiways: taxiwayNodes,
      graph_edges: edges,
    };
  }

  /**
   * Serialize and POST to the Vite dev-server save endpoint.
   */
  async saveToFile(): Promise<void> {
    if (this.allTaxiways.length === 0) {
      this.onStatus?.('Nothing to save — draw some taxiways first', 'warn');
      return;
    }
    this.onStatus?.('Saving…');
    try {
      const payload = this.serialize();
      
      // Validate payload before sending to catch NaN/Infinity issues early
      const jsonStr = JSON.stringify(payload, (key, value) => {
        // Handle NaN and Infinity values
        if (typeof value === 'number') {
          if (!isFinite(value)) {
            console.warn(`Invalid numeric value in payload at ${key}: ${value}, converting to 0`);
            return 0;
          }
        }
        return value;
      }, 2);
      
      // Validate JSON can be parsed back
      try {
        JSON.parse(jsonStr);
      } catch (parseErr) {
        throw new Error(`Payload serialization failed: ${(parseErr as Error).message}`);
      }
      
      const resp = await fetch('/api/save-taxiways', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: jsonStr,
      });
      
      if (!resp.ok) {
        const contentType = resp.headers.get('content-type');
        let errorMsg = `HTTP ${resp.status}`;
        try {
          if (contentType?.includes('application/json')) {
            const json = await resp.json() as { error?: string };
            errorMsg = json.error || errorMsg;
          } else {
            const text = await resp.text();
            errorMsg = text || errorMsg;
          }
        } catch {
          // Fallback to status text if response isn't parseable
          errorMsg = resp.statusText || errorMsg;
        }
        throw new Error(errorMsg);
      }
      
      const json = await resp.json() as { ok?: boolean; error?: string };
      if (json.ok) {
        this.onStatus?.(
          `✔ Saved ${payload.taxiways.length} taxiways, ${payload.graph_edges.length} edges → data/custom_taxiways.json. Reload to apply.`,
          'ok',
        );
      } else {
        throw new Error(json.error ?? 'Unknown error');
      }
    } catch (e) {
      this.onStatus?.(`Save failed: ${(e as Error).message}`, 'err');
    }
  }

  // ── Internal: Map event handlers ──────────────────────────────────────────

  private _onMapClick(e: L.LeafletMouseEvent): void {
    // Swallow the click that fires immediately after a drag-release
    if (this._dragJustEnded) {
      this._dragJustEnded = false;
      return;
    }

    const isShiftClick = (e.originalEvent as MouseEvent).shiftKey;

    // ── If shift-clicking and editing, try to delete a node ───────────────
    if (isShiftClick && this.activeTaxiway) {
      const nodeIdx = this._findNodeNearLatlng(e.latlng);
      if (nodeIdx !== null) {
        this.deleteNodeFromActive(nodeIdx);
        return;
      }
    }

    // ── If not editing, ignore clicks (must use panel to start new line) ────
    if (!this.activeTaxiway) {
      this.onStatus?.('Start a new line first (use the panel)', 'warn');
      return;
    }

    // ── Normal click: place a node ──────────────────────────────────────────
    const snap = this._findSnapTarget(e.latlng);
    const node: EditorNode = snap
      ? snap
      : {
          id:  `n_${Date.now()}_${this.activeTaxiway.nodes.length}`,
          lat: e.latlng.lat,
          lon: e.latlng.lng,
          type: 'normal',
        };

    this.activeTaxiway.nodes.push(node);
    this._redrawActive();
    this._notify();

    const typeLabel = node.type === 'gate' ? ' [GATE]' : node.type === 'runway_end' ? ' [RWY]' : '';
    const editMsg = this.editingIndex !== null ? ' (Shift+click node to delete)' : '';
    this.onStatus?.(
      `Node ${this.activeTaxiway.nodes.length}${typeLabel} — Esc/right-click to end${editMsg}`,
      'ok',
    );
  }

  // ── Mouse down / up for node dragging ────────────────────────────────────

  private _onMouseDown(e: L.LeafletMouseEvent): void {
    if (!this.activeTaxiway) return;
    const nodeIdx = this._findNodeNearLatlng(e.latlng);
    if (nodeIdx === null) return;
    // Start tracking a potential drag on this node
    this._draggingNodeIndex = nodeIdx;
    this._isDragging = false;
    // Disable map panning so the drag moves the node, not the viewport
    this.map.dragging.disable();
    L.DomEvent.stopPropagation(e);
  }

  private _onMouseUp(_e: L.LeafletMouseEvent): void {
    if (this._draggingNodeIndex !== null) {
      if (this._isDragging) {
        this._dragJustEnded = true;
        this._notify();
      }
      this._isDragging = false;
      this._draggingNodeIndex = null;
      this.map.dragging.enable();
    }
  }

  private _onMapMouseMove(e: L.LeafletMouseEvent): void {
    // ── Handle node drag ──────────────────────────────────────────────────
    if (this._draggingNodeIndex !== null && this.activeTaxiway) {
      this._isDragging = true;
      const node = this.activeTaxiway.nodes[this._draggingNodeIndex];
      node.lat = e.latlng.lat;
      node.lon = e.latlng.lng;
      node.type = 'normal';      // detach from snap target on move
      node.snappedToId = undefined;
      this._redrawActive();
      return; // skip snap ring / preview during drag
    }

    this.snapRingLayer.clearLayers();
    this.previewLayer.clearLayers();

    const snap = this._findSnapTarget(e.latlng);

    if (snap) {
      // Show snap ring
      L.circleMarker([snap.lat, snap.lon], {
        radius:      14,
        color:       COLOR_SNAP_RING,
        weight:      2,
        fill:        false,
        interactive: false,
        className:   'editor-snap-ring',
      }).addTo(this.snapRingLayer);
    }

    if (!this.activeTaxiway || this.activeTaxiway.nodes.length === 0) return;

    // Build preview curve: last few placed nodes + cursor
    const placed = this.activeTaxiway.nodes;
    const cursorPt = snap
      ? { lat: snap.lat, lon: snap.lon }
      : { lat: e.latlng.lat, lon: e.latlng.lng };

    // Take up to the last 3 placed nodes + cursor as control points
    const controlPts = [
      ...placed.slice(-3).map(n => ({ lat: n.lat, lon: n.lon })),
      cursorPt,
    ];
    const smoothed = catmullRom(controlPts, 6);

    L.polyline(smoothed.map(p => [p.lat, p.lon] as L.LatLngExpression), {
      color:       COLOR_PREVIEW,
      weight:      2.5,
      opacity:     0.7,
      dashArray:   '6 5',
      interactive: false,
    }).addTo(this.previewLayer);
  }

  private _onMapRightClick(e: L.LeafletMouseEvent): void {
    L.DomEvent.preventDefault(e.originalEvent);
    this.endCurrentLine();
  }

  private _onKeyDown(e: KeyboardEvent): void {
    if (!this.isEnabled) return;
    if (e.key === 'Escape') {
      this.endCurrentLine();
    } else if (e.key === 'z' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      this.undoLastNode();
    }
  }

  // ── Internal: Snap detection ───────────────────────────────────────────────

  /**
   * Finds an existing node or gate within SNAP_RADIUS_PX of the given latlng.
   * Returns an EditorNode ready to use, or null if nothing snappable is nearby.
   */
  private _findSnapTarget(latlng: L.LatLng): EditorNode | null {
    const mapPt = this.map.latLngToLayerPoint(latlng);
    let bestDist = SNAP_RADIUS_PX;
    let best: EditorNode | null = null;

    // ── Snap to existing editor nodes ─────────────────────────────────────
    const allNodes: EditorNode[] = [
      ...this.allTaxiways.flatMap(tw => tw.nodes),
      ...(this.activeTaxiway?.nodes ?? []),
    ];
    for (const n of allNodes) {
      const nPt = this.map.latLngToLayerPoint([n.lat, n.lon]);
      const dist = mapPt.distanceTo(nPt);
      if (dist < bestDist) {
        bestDist = dist;
        // Return a clone with the same id so the two taxiways share this node
        best = { ...n };
      }
    }
    if (best) return best;

    // ── Snap to gate dots ─────────────────────────────────────────────────
    for (const gate of this.gates) {
      const gPt = this.map.latLngToLayerPoint([gate.lat, gate.lon]);
      const dist = mapPt.distanceTo(gPt);
      if (dist < bestDist) {
        bestDist = dist;
        best = {
          id:          `GATE_${gate.id}`,
          lat:         gate.parking_lat ?? gate.lat,
          lon:         gate.parking_lon ?? gate.lon,
          type:        'gate',
          snappedToId: gate.id,
        };
      }
    }
    return best;
  }

  // ── Internal: Rendering ────────────────────────────────────────────────────

  /**
   * Re-draw the active taxiway line and its node markers.
   * Called after every node placement, undo, or line start.
   */
  private _redrawActive(): void {
    this.activePolylineLayer.clearLayers();

    // Redraw only the active taxiway's node markers — finalized lines show clean curves only
    this.nodeMarkerLayer.clearLayers();

    if (!this.activeTaxiway || this.activeTaxiway.nodes.length === 0) return;

    // Draw active taxiway node markers
    for (const n of this.activeTaxiway.nodes) this._addNodeMarker(n, true);

    if (this.activeTaxiway.nodes.length < 2) return;

    // Pick line colour based on subtype
    const activeColor =
      this.activeTaxiway.subtype === 'gate_backup' ? COLOR_GATE_BACKUP : COLOR_ACTIVE_LINE;

    // Smooth polyline for the active taxiway
    const pts = this.activeTaxiway.nodes.map(n => ({ lat: n.lat, lon: n.lon }));
    const smoothed = catmullRom(pts, 6);
    L.polyline(smoothed.map(p => [p.lat, p.lon] as L.LatLngExpression), {
      color:   activeColor,
      weight:  3,
      opacity: 0.9,
      interactive: false,
    }).addTo(this.activePolylineLayer);
  }

  /**
   * Move the active taxiway into allTaxiways and re-render the finalized layer.
   */
  private _finalizeActive(): void {
    if (!this.activeTaxiway || this.activeTaxiway.nodes.length < 2) return;
    
    // If editing an existing line, just update it in place and re-render
    if (this.editingIndex !== null) {
      this.allTaxiways.splice(this.editingIndex, 0, this.activeTaxiway);
      this._redrawAllFinalized();
      this.onStatus?.(
        `Line updated (${this.allTaxiways.length} total). Start a new line or click Save.`,
        'ok',
      );
    } else {
      this.allTaxiways.push(this.activeTaxiway);
      this._renderFinalizedTaxiway(this.activeTaxiway);
      this.onStatus?.(
        `Line saved (${this.allTaxiways.length} total). Start a new line or click Save.`,
        'ok',
      );
    }
    
    this.activeTaxiway = null;
    this.editingIndex = null;
    this.activePolylineLayer.clearLayers();
    this.previewLayer.clearLayers();
  }

  private _renderFinalizedTaxiway(tw: EditorTaxiway): void {
    if (tw.nodes.length < 2) return;
    const pts = tw.nodes.map(n => ({ lat: n.lat, lon: n.lon }));
    const smoothed = catmullRom(pts, 6);
    const lineColor = tw.subtype === 'gate_backup' ? COLOR_GATE_BACKUP : COLOR_FINALIZED;
    const typeLabel =
      tw.subtype === 'taxilane'    ? 'Taxilane'    :
      tw.subtype === 'gate_backup' ? 'Gate Backup' :
                                     'Taxiway';
    const polyline = L.polyline(smoothed.map(p => [p.lat, p.lon] as L.LatLngExpression), {
      color:       lineColor,
      weight:      2.5,
      opacity:     0.85,
      interactive: true,
      className:   'editor-finalized-polyline',
    })
      .bindTooltip(
        `${typeLabel} ${tw.id} — ${tw.name}\nClick to edit`,
        { permanent: false },
      )
      .addTo(this.finalizedLayer);
    
    // Store for click detection
    this.finalizedPolylines.set(tw.id, polyline);
  }

  /** Redraw all finalized taxiways (used after clear-all, edit, and restore) */
  private _redrawAllFinalized(): void {
    this.finalizedLayer.clearLayers();
    this.finalizedPolylines.clear();
    for (const tw of this.allTaxiways) this._renderFinalizedTaxiway(tw);
  }

  private _addNodeMarker(node: EditorNode, isActive: boolean): void {
    const color =
      node.type === 'gate'       ? COLOR_GATE_NODE   :
      node.type === 'runway_end' ? COLOR_RUNWAY_NODE  :
                                   COLOR_NORMAL_NODE;

    const marker = L.circleMarker([node.lat, node.lon], {
      radius:      isActive ? 5 : 4,
      color,
      weight:      isActive ? 2 : 1.5,
      fillColor:   color,
      fillOpacity: 0.9,
      interactive: isActive,  // clickable if editing
      className:   isActive ? 'editor-node-marker' : '',
    });
    
    if (isActive) {
      marker.bindTooltip('Shift+click to delete', { permanent: false });
    }
    
    marker.addTo(this.nodeMarkerLayer);
  }

  private _notify(): void {
    this.onStateChange?.(this.allTaxiways, this.activeTaxiway);
  }

  /**
   * Find the index of a finalized taxiway polyline near the given latlng.
   */
  private _findPolylineNearLatlng(latlng: L.LatLng): number | null {
    let bestIdx = -1;
    let bestDist = Infinity;
    let idx = 0;

    for (const tw of this.allTaxiways) {
      const pts = tw.nodes.map(n => ({ lat: n.lat, lon: n.lon }));
      const smoothed = catmullRom(pts, 6);
      
      for (const p of smoothed) {
        const pt = this.map.latLngToLayerPoint([p.lat, p.lon]);
        const clickPt = this.map.latLngToLayerPoint(latlng);
        const dist = pt.distanceTo(clickPt);
        if (dist < 12 && dist < bestDist) {
          bestDist = dist;
          bestIdx = idx;
        }
      }
      idx++;
    }

    return bestIdx >= 0 ? bestIdx : null;
  }

  /**
   * Find the index of a node marker near the given latlng (active taxiway only).
   */
  private _findNodeNearLatlng(latlng: L.LatLng): number | null {
    if (!this.activeTaxiway) return null;
    const mapPt = this.map.latLngToLayerPoint(latlng);
    let bestIdx = -1;
    let bestDist = Infinity;

    this.activeTaxiway.nodes.forEach((node, i) => {
      const nPt = this.map.latLngToLayerPoint([node.lat, node.lon]);
      const dist = mapPt.distanceTo(nPt);
      if (dist < 12 && dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    });

    return bestIdx >= 0 ? bestIdx : null;
  }
}
