import L from 'leaflet';
import type { TaxiWaypoint } from '../aircraft/FlightPhase';
import type { Taxiway } from './TaxiwayLayer';

type Position = { lat: number; lon: number };

/**
 * PushbackDrawer
 *
 * When pushback is approved, shows an interactive 2-segment path on the map:
 *   • White dashed segment 1 — straight reverse from nose to turn point.
 *   • Cyan dashed segment 2  — alignment onto the taxiway.
 *
 * Both endpoints (turn point and alignment endpoint) have draggable handles that
 * snap to the nearest taxiway node on release.  The controller clicks
 * "Confirm Pushback" when satisfied; the aircraft then begins moving.
 */
export class PushbackDrawer {
  private map: L.Map;
  private taxiways: Taxiway[];
  private layerGroup: L.LayerGroup;

  private active    = false;
  private callsign  = '';
  private startPos: Position | null  = null;
  private waypoints: TaxiWaypoint[]  = [];   // [turnPoint] or [turnPoint, alignPoint]

  // Map drawables
  private seg1Line:        L.Polyline | null     = null;
  private seg2Line:        L.Polyline | null     = null;
  private startDot:        L.CircleMarker | null = null;
  private turnMarkerObj:   L.Marker | null       = null;
  private alignMarkerObj:  L.Marker | null       = null;

  // UI overlay
  private overlay: HTMLElement | null = null;

  /** Max distance (NM) within which a dragged handle snaps to a taxiway node */
  private static readonly MAX_SNAP_NM = 0.10;

  /** Called once the controller clicks "Confirm Pushback" */
  onConfirm?: (callsign: string, waypoints: TaxiWaypoint[]) => void;

  /** Called if the controller cancels */
  onCancel?: (callsign: string) => void;

  constructor(map: L.Map, taxiways: Taxiway[]) {
    this.map      = map;
    this.taxiways = taxiways;
    this.layerGroup = L.layerGroup().addTo(map);
  }

  /**
   * Activate the pushback path editor.
   * @param callsign  Aircraft callsign
   * @param startPos  Current aircraft centre position (nose end)
   * @param waypoints Pre-computed pushback waypoints from CommandHandler
   */
  start(callsign: string, startPos: Position, waypoints: TaxiWaypoint[]): void {
    if (this.active) this.cleanup();
    this.callsign  = callsign;
    this.startPos  = { ...startPos };
    this.waypoints = waypoints.map(w => ({ ...w }));
    this.active    = true;
    this.draw();
    this.showOverlay();
  }

  stop(): void { this.cleanup(); }

  isActive(): boolean         { return this.active; }
  activeCallsign(): string    { return this.callsign; }

  // ── Drawing ───────────────────────────────────────────────────────────────

  private draw(): void {
    this.layerGroup.clearLayers();

    if (!this.startPos || this.waypoints.length === 0) return;

    const start   = this.startPos;
    const turnWP  = this.waypoints[0];

    const startLL: L.LatLngExpression = [start.lat,   start.lon];
    const turnLL:  L.LatLngExpression = [turnWP.lat,  turnWP.lon];

    // ── Aircraft nose dot (fixed, not draggable)
    this.startDot = L.circleMarker(startLL, {
      radius:      7,
      color:       '#FFFFFF',
      fillColor:   '#FFFFFF',
      fillOpacity: 0.9,
      weight:      2,
    }).addTo(this.layerGroup)
      .bindTooltip(`${this.callsign} — nose (start)`, { permanent: false, direction: 'top' });

    // ── Segment 1: straight reverse — WHITE dashed
    this.seg1Line = L.polyline([startLL, turnLL], {
      color:     '#FFFFFF',
      weight:    3,
      dashArray: '10 6',
      opacity:   0.9,
    }).addTo(this.layerGroup);

    // ── Draggable turn-point marker (white)
    this.turnMarkerObj = L.marker(turnLL, {
      icon:      this.makeDragIcon('#FFFFFF'),
      draggable: true,
      title:     'Drag to adjust turn point (snaps to taxiway)',
    }).addTo(this.layerGroup)
      .bindTooltip('← Turn point — drag to adjust', { permanent: false, direction: 'right' });

    this.turnMarkerObj.on('drag', () => {
      const ll = this.turnMarkerObj!.getLatLng();
      this.seg1Line?.setLatLngs([startLL, ll]);
      if (this.seg2Line && this.waypoints.length >= 2) {
        const alignWP = this.waypoints[1];
        this.seg2Line.setLatLngs([ll, [alignWP.lat, alignWP.lon]]);
      }
    });

    this.turnMarkerObj.on('dragend', () => {
      const ll      = this.turnMarkerObj!.getLatLng();
      const snapped = this.snapToTaxiway({ lat: ll.lat, lon: ll.lng });
      this.waypoints[0] = snapped;
      this.turnMarkerObj!.setLatLng([snapped.lat, snapped.lon]);
      this.redrawLines();
    });

    // ── Segment 2 + alignment marker (if 2 waypoints)
    if (this.waypoints.length >= 2) {
      const alignWP = this.waypoints[1];
      const alignLL: L.LatLngExpression = [alignWP.lat, alignWP.lon];

      this.seg2Line = L.polyline([turnLL, alignLL], {
        color:     '#00FFFF',
        weight:    3,
        dashArray: '10 6',
        opacity:   0.9,
      }).addTo(this.layerGroup);

      this.alignMarkerObj = L.marker(alignLL, {
        icon:      this.makeDragIcon('#00FFFF'),
        draggable: true,
        title:     'Drag to adjust alignment endpoint (snaps to taxiway)',
      }).addTo(this.layerGroup)
        .bindTooltip('← Align point — drag to adjust', { permanent: false, direction: 'right' });

      this.alignMarkerObj.on('drag', () => {
        const ll      = this.alignMarkerObj!.getLatLng();
        const turnNow = this.turnMarkerObj!.getLatLng();
        this.seg2Line?.setLatLngs([turnNow, ll]);
      });

      this.alignMarkerObj.on('dragend', () => {
        const ll      = this.alignMarkerObj!.getLatLng();
        const snapped = this.snapToTaxiway({ lat: ll.lat, lon: ll.lng });
        this.waypoints[1] = snapped;
        this.alignMarkerObj!.setLatLng([snapped.lat, snapped.lon]);
        this.redrawLines();
      });
    }
  }

  /** Redraws the polylines after a drag operation. */
  private redrawLines(): void {
    if (!this.startPos) return;
    const startLL: L.LatLngExpression = [this.startPos.lat, this.startPos.lon];
    const turnWP  = this.waypoints[0];
    const turnLL: L.LatLngExpression  = [turnWP.lat, turnWP.lon];

    this.seg1Line?.setLatLngs([startLL, turnLL]);

    if (this.seg2Line && this.waypoints.length >= 2) {
      const alignWP = this.waypoints[1];
      this.seg2Line.setLatLngs([turnLL, [alignWP.lat, alignWP.lon]]);
    }
  }

  // ── Drag handle icon ──────────────────────────────────────────────────────

  private makeDragIcon(color: string): L.DivIcon {
    return L.divIcon({
      html: `<div style="
        width:16px;height:16px;border-radius:50%;
        background:${color};border:2px solid rgba(0,0,0,.75);
        box-shadow:0 0 8px rgba(0,0,0,.85);
        cursor:grab;
      "></div>`,
      iconSize:   [16, 16],
      iconAnchor: [8, 8],
      className:  'pushback-drag-handle',
    });
  }

  // ── Overlay UI ────────────────────────────────────────────────────────────

  private showOverlay(): void {
    this.removeOverlay();
    const div = document.createElement('div');
    div.id = 'pushback-drawer-overlay';
    div.innerHTML = `
      <div class="pb-header">
        <span class="pb-cs">${this.callsign}</span>
        <span class="pb-title">Pushback Path</span>
      </div>
      <div class="pb-legend">
        <div class="pb-leg-row">
          <span class="pb-swatch pb-swatch-white"></span>
          <span>Segment 1 — straight back</span>
        </div>
        <div class="pb-leg-row">
          <span class="pb-swatch pb-swatch-cyan"></span>
          <span>Segment 2 — alignment onto taxiway</span>
        </div>
      </div>
      <div class="pb-hint">Drag the ● handles to reposition each waypoint.<br>
        Handles snap to the nearest taxiway node on release.</div>
      <div class="pb-actions">
        <button id="pb-confirm" class="pb-confirm-btn">✓ Confirm Pushback</button>
        <button id="pb-cancel"  class="pb-cancel-btn">✕ Cancel</button>
      </div>`;
    document.body.appendChild(div);
    this.overlay = div;

    div.querySelector('#pb-confirm')?.addEventListener('click', () => this.commit());
    div.querySelector('#pb-cancel')?.addEventListener('click',  () => this.cancel());
  }

  private removeOverlay(): void {
    this.overlay?.remove();
    this.overlay = null;
    document.getElementById('pushback-drawer-overlay')?.remove();
  }

  // ── Actions ───────────────────────────────────────────────────────────────

  private commit(): void {
    const cs   = this.callsign;
    const wpts = this.waypoints.map(w => ({ ...w }));
    this.cleanup();
    this.onConfirm?.(cs, wpts);
  }

  private cancel(): void {
    const cs = this.callsign;
    this.cleanup();
    this.onCancel?.(cs);
  }

  private cleanup(): void {
    this.active          = false;
    this.callsign        = '';
    this.startPos        = null;
    this.waypoints       = [];
    this.seg1Line        = null;
    this.seg2Line        = null;
    this.startDot        = null;
    this.turnMarkerObj   = null;
    this.alignMarkerObj  = null;
    this.layerGroup.clearLayers();
    this.removeOverlay();
  }

  // ── Taxiway snap ──────────────────────────────────────────────────────────

  private snapToTaxiway(pos: Position): TaxiWaypoint {
    let bestDist = PushbackDrawer.MAX_SNAP_NM;
    let best: TaxiWaypoint = { lat: pos.lat, lon: pos.lon, nodeId: `manual_${Date.now()}` };

    for (const tw of this.taxiways) {
      for (let i = 0; i < tw.coordinates.length; i++) {
        const c = tw.coordinates[i];
        const d = this.nmDistance(pos, c);
        if (d < bestDist) {
          bestDist = d;
          best = { lat: c.lat, lon: c.lon, nodeId: `${tw.id}_${i}` };
        }
      }
    }
    return best;
  }

  private nmDistance(a: Position, b: Position): number {
    const R    = 3440.065;
    const dLat = (b.lat - a.lat) * Math.PI / 180;
    const dLon = (b.lon - a.lon) * Math.PI / 180;
    const aa   = Math.sin(dLat / 2) ** 2 +
                 Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) *
                 Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(aa), Math.sqrt(1 - aa));
  }
}
