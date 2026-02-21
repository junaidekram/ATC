import L from 'leaflet';
import type { Aircraft } from '../aircraft/Aircraft';
import type { SeparationSeverity } from '../atc/SeparationMonitor';
import {
  MIN_AIRCRAFT_PX,
  PLACEHOLDER_ICON,
  getAircraftDisplay,
  getImageUrl,
} from '../aircraft/AircraftConfig';

/**
 * AircraftLayer — Phase 2 (revised)
 *
 * Rendering strategy
 * ──────────────────
 * Aircraft images
 *   Scale with the map exactly like real-world objects: the rendered wingspan
 *   in pixels equals (wingspanMetres / metresPerPixel).  As you zoom in the
 *   plane gets bigger; as you zoom out it gets smaller.
 *
 * Yellow placeholder icon
 *   A fixed-size icon (does NOT scale with zoom) that replaces the aircraft
 *   image when the aircraft would render smaller than MIN_AIRCRAFT_PX wide.
 *   This gives approximate location cues at overview zoom levels.
 *
 * Tooltip vs. info panel
 *   • Hover  → Leaflet tooltip (disappears on mouseout).
 *   • Click  → dispatches 'aircraft-selected' → updates the right-panel info.
 */
export class AircraftLayer {
  private layerGroup: L.LayerGroup;
  private map: L.Map;
  private aircraftMarkers: Map<string, { marker: L.Marker; aircraft: Aircraft }> = new Map();

  /** Currently selected callsign — highlighted in blue */
  private selectedCallsign: string | null = null;
  /** Alert severity by callsign — drives icon colour */
  private alertBySig: Map<string, SeparationSeverity> = new Map();

  constructor(layerGroup: L.LayerGroup, map: L.Map) {
    this.layerGroup = layerGroup;
    this.map = map;

    // Rebuild every icon after each zoom step
    this.map.on('zoomend', () => this.refreshAllIcons());
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /** Highlight one aircraft with a pulsing blue glow. Null = deselect all. */
  setSelected(callsign: string | null): void {
    const prev = this.selectedCallsign;
    this.selectedCallsign = callsign;
    // Rebuild icon for old and new selection so CSS class updates immediately
    if (prev) this.rebuildIcon(prev);
    if (callsign) this.rebuildIcon(callsign);
  }

  /**
   * Push the latest separation alerts.
   * Each affected callsign gets a coloured glow (warning=amber, critical=red).
   */
  setAlerts(callsigns: Map<string, SeparationSeverity>): void {
    const prev = this.alertBySig;
    this.alertBySig = callsigns;
    // Rebuild icons for any callsign whose alert state changed
    const changed = new Set<string>([...prev.keys(), ...callsigns.keys()]);
    for (const cs of changed) {
      if (prev.get(cs) !== callsigns.get(cs)) this.rebuildIcon(cs);
    }
  }

  renderAircraft(aircraft: Aircraft): void {
    const callsign = aircraft.callsign;
    const pos      = aircraft.position;
    const existing = this.aircraftMarkers.get(callsign);

    if (!existing) {
      const marker = L.marker([pos.lat, pos.lon], {
        icon: this.buildIcon(aircraft),
        zIndexOffset: 1000,
      }).addTo(this.layerGroup);

      // Hover tooltip — auto-closes on mouseout
      marker.bindTooltip(this.buildTooltipContent(aircraft), {
        permanent:   false,
        direction:   'top',
        offset:      [0, -6],
        className:   'aircraft-tooltip',
        interactive: false,   // tooltip is non-interactive (no pointer events)
      });

      // Click → info panel only (tooltip stays hover-only)
      marker.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        this.dispatchSelection(aircraft);
      });

      this.aircraftMarkers.set(callsign, { marker, aircraft });
    } else {
      const { marker } = existing;
      existing.aircraft = aircraft;

      marker.setLatLng([pos.lat, pos.lon]);
      marker.setIcon(this.buildIcon(aircraft));
      marker.setTooltipContent(this.buildTooltipContent(aircraft));

      marker.off('click');
      marker.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        this.dispatchSelection(aircraft);
      });
    }
  }

  removeAircraft(callsign: string): void {
    const entry = this.aircraftMarkers.get(callsign);
    if (entry) {
      this.layerGroup.removeLayer(entry.marker);
      this.aircraftMarkers.delete(callsign);
    }
  }

  clearAll(): void {
    this.layerGroup.clearLayers();
    this.aircraftMarkers.clear();
  }

  /** Rebuild the icon for one callsign in-place (cheap — no DOM removal). */
  private rebuildIcon(callsign: string): void {
    const entry = this.aircraftMarkers.get(callsign);
    if (entry) entry.marker.setIcon(this.buildIcon(entry.aircraft));
  }

  // ── Icon building ─────────────────────────────────────────────────────────

  /**
   * Compute metres-per-pixel at the given latitude and current zoom level.
   * Formula: Mercator pixel scale = (circumference × cos lat) / 2^(zoom+8)
   */
  private metresPerPixel(lat: number): number {
    const zoom = this.map.getZoom();
    return (40_075_016.686 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom + 8);
  }

  private buildIcon(aircraft: Aircraft): L.DivIcon {
    const mpp      = this.metresPerPixel(aircraft.position.lat);
    const cfg      = getAircraftDisplay(aircraft.aircraftType);
    const scaledW  = cfg.wingspanMetres / mpp;
    const cs       = aircraft.callsign;

    // ── State class (drives CSS glow) ─────────────────────────────────────
    // Selected state takes visual priority over alert state
    let stateClass = '';
    if (cs === this.selectedCallsign) {
      stateClass = ' aircraft-icon--selected';
    } else {
      const sev = this.alertBySig.get(cs);
      if (sev === 'critical') stateClass = ' aircraft-icon--critical';
      else if (sev === 'warning') stateClass = ' aircraft-icon--warning';
    }

    if (scaledW < MIN_AIRCRAFT_PX) {
      // ── Placeholder icon (fixed size, does not scale) ─────────────────
      const sz  = PLACEHOLDER_ICON.size;
      const src = getImageUrl(PLACEHOLDER_ICON.imageFile);
      return L.divIcon({
        html: `<div class="ac-inner" style="
          width:${sz}px;height:${sz}px;
          transform:rotate(${aircraft.heading}deg);
          transform-origin:center;
          pointer-events:none;
        "><img src="${src}" width="${sz}" height="${sz}"
          style="display:block;" draggable="false"/></div>`,
        className:     `aircraft-icon aircraft-icon--placeholder${stateClass}`,
        iconSize:      [sz, sz],
        iconAnchor:    [sz / 2, sz / 2],
        tooltipAnchor: [0, -(sz / 2 + 4)],
      });
    }

    // ── Real aircraft image, scaled to map ───────────────────────────────
    const aspectRatio = cfg.iconHeight / cfg.iconWidth;
    const w   = Math.round(scaledW);
    const h   = Math.round(scaledW * aspectRatio);
    const src = getImageUrl(cfg.imageFile);

    return L.divIcon({
      html: `<div class="ac-inner" style="
        width:${w}px;height:${h}px;
        transform:rotate(${aircraft.heading}deg);
        transform-origin:center;
        pointer-events:none;
      "><img src="${src}" width="${w}" height="${h}"
        style="display:block;image-rendering:crisp-edges;"
        draggable="false"/></div>`,
      className:     `aircraft-icon${stateClass}`,
      iconSize:      [w, h],
      iconAnchor:    [w / 2, h / 2],
      tooltipAnchor: [0, -(h / 2 + 4)],
    });
  }

  // ── Tooltip content ───────────────────────────────────────────────────────

  private buildTooltipContent(aircraft: Aircraft): string {
    const s      = aircraft.getState();
    const altStr = s.altitude > 0 ? `${Math.round(s.altitude).toLocaleString()} ft` : 'GND';
    const spdStr = s.speed    > 0 ? `${Math.round(s.speed)} kts`                    : 'PARKED';
    const hdgStr = `${Math.round(s.heading).toString().padStart(3, '0')}°`;
    const label  = getAircraftDisplay(s.aircraftType).label;

    return `<div class="ac-tt">
      <strong>${s.callsign}</strong>
      <span class="ac-tt-type">${label}</span>
      <span class="ac-tt-data">${spdStr} · ${altStr} · ${hdgStr}</span>
      <span class="ac-tt-phase">${s.phase.replace(/_/g, ' ')}</span>
    </div>`;
  }

  // ── Zoom refresh ──────────────────────────────────────────────────────────

  private refreshAllIcons(): void {
    for (const { marker, aircraft } of this.aircraftMarkers.values()) {
      marker.setIcon(this.buildIcon(aircraft));
      // Rebuild tooltip to get updated speed/altitude
      marker.setTooltipContent(this.buildTooltipContent(aircraft));
    }
  }

  // ── Selection event ───────────────────────────────────────────────────────

  private dispatchSelection(aircraft: Aircraft): void {
    window.dispatchEvent(
      new CustomEvent('aircraft-selected', { detail: aircraft.getState() })
    );
  }

  // ── Visibility control ─────────────────────────────────────────────────────

  /**
   * Set visibility and interactivity of all aircraft.
   * Used when editor is active to hide aircraft so they don't block map clicks.
   */
  setVisible(visible: boolean): void {
    for (const { marker } of this.aircraftMarkers.values()) {
      const el = marker.getElement();
      if (el) {
        if (visible) {
          el.style.pointerEvents = 'auto';
          el.style.opacity = '1';
        } else {
          el.style.pointerEvents = 'none';
          el.style.opacity = '0.2';
        }
      }
    }
  }
}
