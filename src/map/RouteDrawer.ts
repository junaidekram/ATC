import L from 'leaflet';
import type { TaxiWaypoint } from '../aircraft/FlightPhase';
import type { Taxiway } from './TaxiwayLayer';

/**
 * RouteDrawer
 *
 * Interactive tool that lets the controller click on the map to build a taxi
 * route for a selected aircraft.  Snaps each click to the nearest taxiway node
 * within MAX_SNAP_NM.  The drawn path is shown as a magenta dashed polyline.
 */
export class RouteDrawer {
  private map: L.Map;
  private taxiways: Taxiway[];
  private active = false;
  private callsign = '';
  private waypoints: TaxiWaypoint[] = [];

  // Leaflet drawables
  private layerGroup: L.LayerGroup;
  private markers: L.CircleMarker[] = [];
  private polyline: L.Polyline | null = null;

  // UI overlay
  private overlay: HTMLElement | null = null;

  /** Called when route is confirmed — parent receives callsign + waypoints */
  onCommit?: (callsign: string, waypoints: TaxiWaypoint[]) => void;

  private static readonly MAX_SNAP_NM = 0.05; // ~300 ft snap radius

  constructor(map: L.Map, taxiways: Taxiway[]) {
    this.map = map;
    this.taxiways = taxiways;
    this.layerGroup = L.layerGroup().addTo(map);
  }

  /** Activate drawing mode for a given aircraft */
  start(callsign: string): void {
    if (this.active) this.cancel();
    this.callsign  = callsign;
    this.waypoints = [];
    this.active    = true;
    this.map.on('click', this.handleMapClick);
    this.map.getContainer().style.cursor = 'crosshair';
    this.showOverlay();
  }

  cancel(): void {
    this.cleanup();
  }

  isActive(): boolean { return this.active; }

  // ── Overlay ───────────────────────────────────────────────────────────────

  private showOverlay(): void {
    this.removeOverlay();
    const div = document.createElement('div');
    div.id = 'route-drawer-overlay';
    div.innerHTML = `
      <div class="rd-header">
        <span class="rd-cs">${this.callsign}</span>
        <span class="rd-hint">Click taxiway to add waypoints</span>
      </div>
      <div class="rd-wpts" id="rd-wpts-list">No waypoints yet</div>
      <div class="rd-actions">
        <button id="rd-undo">↩ Undo</button>
        <button id="rd-clear">✕ Clear</button>
        <button id="rd-apply" class="rd-apply">✓ Apply Route</button>
        <button id="rd-cancel">Cancel</button>
      </div>`;
    document.body.appendChild(div);
    this.overlay = div;

    div.querySelector('#rd-undo')?.addEventListener('click',   () => this.undo());
    div.querySelector('#rd-clear')?.addEventListener('click',  () => { this.waypoints = []; this.redraw(); this.updateOverlayCounts(); });
    div.querySelector('#rd-apply')?.addEventListener('click',  () => this.commit());
    div.querySelector('#rd-cancel')?.addEventListener('click', () => this.cancel());

    this.updateOverlayCounts();
  }

  private removeOverlay(): void {
    if (this.overlay) { this.overlay.remove(); this.overlay = null; }
    document.getElementById('route-drawer-overlay')?.remove();
  }

  private updateOverlayCounts(): void {
    const listEl = document.getElementById('rd-wpts-list');
    if (!listEl) return;
    if (this.waypoints.length === 0) {
      listEl.textContent = 'No waypoints yet';
    } else {
      listEl.innerHTML = this.waypoints
        .map((w, i) => `<span class="rd-wpt">${i + 1}. ${w.lat.toFixed(5)}, ${w.lon.toFixed(5)} <em>${w.nodeId}</em></span>`)
        .join('');
    }
  }

  // ── Map interaction ───────────────────────────────────────────────────────

  private handleMapClick = (e: L.LeafletMouseEvent): void => {
    const clicked = { lat: e.latlng.lat, lon: e.latlng.lng };

    // Try to snap to nearest taxiway node
    const snapped = this.snapToTaxiway(clicked);

    this.waypoints.push(snapped);
    this.redraw();
    this.updateOverlayCounts();
  };

  /** Snap click to nearest taxiway coordinate — falls back to raw position if none close enough */
  private snapToTaxiway(pos: { lat: number; lon: number }): TaxiWaypoint {
    let bestDist = RouteDrawer.MAX_SNAP_NM;
    let best: TaxiWaypoint = { lat: pos.lat, lon: pos.lon, nodeId: `manual_${Date.now()}` };

    for (const tw of this.taxiways) {
      for (let i = 0; i < tw.coordinates.length; i++) {
        const c = tw.coordinates[i];
        const d = this.nmDistance(pos, { lat: c.lat, lon: c.lon });
        if (d < bestDist) {
          bestDist = d;
          best = { lat: c.lat, lon: c.lon, nodeId: `${tw.id}_${i}` };
        }
      }
    }
    return best;
  }

  // ── Drawing ───────────────────────────────────────────────────────────────

  private redraw(): void {
    this.layerGroup.clearLayers();
    this.markers = [];

    const latlngs = this.waypoints.map(w => [w.lat, w.lon] as [number, number]);

    if (latlngs.length >= 2) {
      this.polyline = L.polyline(latlngs, {
        color: '#ff00ff',
        weight: 3,
        dashArray: '8 5',
        opacity: 0.9,
      }).addTo(this.layerGroup);
    }

    this.waypoints.forEach((w, i) => {
      const m = L.circleMarker([w.lat, w.lon], {
        radius: i === 0 ? 7 : 5,
        color: '#ff00ff',
        fillColor: i === 0 ? '#ffffff' : '#ff00ff',
        fillOpacity: 1,
        weight: 2,
      }).addTo(this.layerGroup);
      this.markers.push(m);
    });
  }

  // ── Actions ───────────────────────────────────────────────────────────────

  private undo(): void {
    this.waypoints.pop();
    this.redraw();
    this.updateOverlayCounts();
  }

  private commit(): void {
    if (this.waypoints.length === 0) { this.cancel(); return; }
    const wpts = [...this.waypoints];
    const cs   = this.callsign;
    this.cleanup();
    this.onCommit?.(cs, wpts);
  }

  private cleanup(): void {
    this.active    = false;
    this.waypoints = [];
    this.map.off('click', this.handleMapClick);
    this.map.getContainer().style.cursor = '';
    this.layerGroup.clearLayers();
    this.markers   = [];
    this.polyline  = null;
    this.removeOverlay();
  }

  // ── Geometry ──────────────────────────────────────────────────────────────

  private nmDistance(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
    const R    = 3440.065;
    const dLat = (b.lat - a.lat) * Math.PI / 180;
    const dLon = (b.lon - a.lon) * Math.PI / 180;
    const aa   = Math.sin(dLat / 2) ** 2 +
                 Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) *
                 Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(aa), Math.sqrt(1 - aa));
  }
}
