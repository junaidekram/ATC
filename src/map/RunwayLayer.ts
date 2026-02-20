import L from 'leaflet';

export interface ILSData {
  freq_mhz: number;
  identifier: string;
  glide_slope_deg: number;
  category: string;
  dh_ft: number;
}

export interface Runway {
  id: string;
  /** Combined e.g. "10L/28R" */
  name: string;
  id_a: string;   // e.g. "10L"
  id_b: string;   // e.g. "28R"
  heading: number;    // heading_a_true
  heading_b: number;  // heading_b_true
  length_ft: number;
  width_ft: number;
  /** Four corners in order: [ta+perp, tb+perp, tb-perp, ta-perp] */
  coordinates: { lat: number; lon: number }[];
  /** Actual threshold positions */
  threshold_a: { lat: number; lon: number };
  threshold_b: { lat: number; lon: number };
  ils_a?: ILSData;   // ILS for runway end id_a
  ils_b?: ILSData;   // ILS for runway end id_b
}

// ── Coordinate helpers ─────────────────────────────────────────────────────

/** Feet per degree of latitude (constant for ORD) */
const FT_PER_DEG_LAT = 364_620;
/** Feet per degree of longitude at ORD (~42 °N) */
const FT_PER_DEG_LON = 364_620 * Math.cos(41.98 * Math.PI / 180); // ≈ 270 900

/**
 * Compute the CSS `rotate()` angle so that text drawn at the given runway
 * heading is rendered along the axis (never upside-down).
 * Returns a value in [-90, 90].
 */
function runwayCssRotation(headingDeg: number): number {
  let rot = (headingDeg % 180) - 90;
  if (rot > 90)  rot -= 180;
  if (rot < -90) rot += 180;
  return rot;
}

/**
 * Offset a WGS-84 point by `distFt` feet in direction `bearingDeg`
 * (clockwise from north, true bearing).
 */
function offsetPoint(
  lat: number, lon: number,
  distFt: number, bearingDeg: number
): [number, number] {
  const rad = bearingDeg * Math.PI / 180;
  const dLat = Math.cos(rad) * distFt / FT_PER_DEG_LAT;
  const dLon = Math.sin(rad) * distFt / FT_PER_DEG_LON;
  return [lat + dLat, lon + dLon];
}

// ── RunwayLayer ────────────────────────────────────────────────────────────

/**
 * RunwayLayer
 * Renders ORD runways as filled polygons, labels each threshold correctly,
 * and draws ILS approach cones on a separate layer.
 */
export class RunwayLayer {
  private layerGroup: L.LayerGroup;
  private ilsLayerGroup: L.LayerGroup;

  constructor(layerGroup: L.LayerGroup, ilsLayerGroup?: L.LayerGroup) {
    this.layerGroup = layerGroup;
    this.ilsLayerGroup = ilsLayerGroup ?? layerGroup;
  }

  renderRunways(runways: Runway[]): void {
    runways.forEach(rw => this.renderRunway(rw));
  }

  private renderRunway(rw: Runway): void {
    // ── Filled polygon ───────────────────────────────────────────────────
    const latlngs: L.LatLngExpression[] = rw.coordinates.map(c => [c.lat, c.lon]);

    L.polygon(latlngs, {
      color: '#111',
      weight: 1,
      fillColor: '#D4C87A',
      fillOpacity: 0.95
    })
      .bindTooltip(this.buildTooltip(rw), { direction: 'top', sticky: true })
      .addTo(this.layerGroup);

    // ── Centerline dashes ────────────────────────────────────────────────
    L.polyline(
      [[rw.threshold_a.lat, rw.threshold_a.lon],
       [rw.threshold_b.lat, rw.threshold_b.lon]],
      { color: '#fff', weight: 1, opacity: 0.5, dashArray: '8 8' }
    ).addTo(this.layerGroup);

    // ── Threshold labels ─────────────────────────────────────────────────
    //  Label A: placed 350 ft inward along heading_b (from A toward centre)
    this.addThresholdLabel(
      rw.threshold_a, rw.id_a,
      /*inward=*/ rw.heading_b,
      rw.heading
    );
    //  Label B: placed 350 ft inward along heading_a (from B toward centre)
    this.addThresholdLabel(
      rw.threshold_b, rw.id_b,
      /*inward=*/ rw.heading,
      rw.heading
    );

    // ── ILS approach cones ───────────────────────────────────────────────
    //  Cone for id_a: aircraft lands heading_a, arrives from heading_b side
    if (rw.ils_a) {
      this.addILSCone(
        rw.threshold_a.lat, rw.threshold_a.lon,
        rw.heading_b,  // outward = away from runway, into approach airspace
        rw.id_a, rw.ils_a
      );
    }
    //  Cone for id_b: aircraft lands heading_b, arrives from heading_a side
    if (rw.ils_b) {
      this.addILSCone(
        rw.threshold_b.lat, rw.threshold_b.lon,
        rw.heading,    // outward
        rw.id_b, rw.ils_b
      );
    }
  }

  /**
   * Threshold label — rendered inside the runway, rotated along the axis.
   *
   * @param pos        Threshold lat/lon
   * @param label      Designator e.g. "28R"
   * @param inwardHdg  Bearing pointing INWARD from this threshold toward centre
   * @param runwayHdg  heading_a, used for CSS text rotation
   */
  private addThresholdLabel(
    pos: { lat: number; lon: number },
    label: string,
    inwardHdg: number,
    runwayHdg: number
  ): void {
    const [lat, lon] = offsetPoint(pos.lat, pos.lon, 350, inwardHdg);
    const cssRot = runwayCssRotation(runwayHdg);

    const icon = L.divIcon({
      html: `<div style="
        color:#FFE86A;
        font-family:'Courier New',monospace;
        font-weight:900;
        font-size:12px;
        letter-spacing:0.5px;
        text-shadow:0 0 4px #000,0 0 4px #000,0 0 2px #000;
        white-space:nowrap;
        transform:rotate(${cssRot}deg);
        transform-origin:center center;
        line-height:1;
      ">${label}</div>`,
      className: '',
      iconSize: [40, 14],
      iconAnchor: [20, 7]
    });

    L.marker([lat, lon], { icon, interactive: false }).addTo(this.layerGroup);
  }

  /**
   * ILS localizer cone — a thin blue triangle extending outward ≈10 nm.
   */
  private addILSCone(
    lat: number, lon: number,
    outwardHdg: number,
    endId: string,
    ils: ILSData
  ): void {
    const CONE_NM     = 10;
    const HALF_BEAM   = 1.5;    // ±1.5° localizer beam
    const NM_TO_FT    = 6076;
    const distFt      = CONE_NM * NM_TO_FT;

    const [tipLat, tipLon]     = offsetPoint(lat, lon, 50, outwardHdg);
    const [leftLat, leftLon]   = offsetPoint(lat, lon, distFt, outwardHdg - HALF_BEAM);
    const [rightLat, rightLon] = offsetPoint(lat, lon, distFt, outwardHdg + HALF_BEAM);
    const [clLat, clLon]       = offsetPoint(lat, lon, distFt, outwardHdg);

    L.polygon(
      [[tipLat, tipLon], [leftLat, leftLon], [rightLat, rightLon]],
      {
        color: '#2288FF',
        weight: 1,
        opacity: 0.6,
        fillColor: '#4499FF',
        fillOpacity: 0.08
      }
    )
      .bindTooltip(
        `<strong>ILS ${endId}</strong> — ${ils.identifier}<br/>` +
        `${ils.freq_mhz} MHz &nbsp;|&nbsp; CAT ${ils.category}<br/>` +
        `G/S ${ils.glide_slope_deg}° &nbsp;|&nbsp; DH ${ils.dh_ft} ft`,
        { direction: 'top', sticky: true }
      )
      .addTo(this.ilsLayerGroup);

    // Centreline
    L.polyline([[tipLat, tipLon], [clLat, clLon]], {
      color: '#2288FF', weight: 1, opacity: 0.5, dashArray: '10 8'
    }).addTo(this.ilsLayerGroup);
  }

  private buildTooltip(rw: Runway): string {
    let t = `<strong>${rw.id_a} / ${rw.id_b}</strong><br/>`;
    t += `Hdg ${rw.heading}° / ${rw.heading_b}°<br/>`;
    t += `${rw.length_ft.toLocaleString()} ft &times; ${rw.width_ft} ft`;
    if (rw.ils_b) {
      t += `<br/>ILS ${rw.id_b}: ${rw.ils_b.freq_mhz} MHz (${rw.ils_b.identifier})`;
    }
    if (rw.ils_a) {
      t += `<br/>ILS ${rw.id_a}: ${rw.ils_a.freq_mhz} MHz (${rw.ils_a.identifier})`;
    }
    return t;
  }

  clearAll(): void {
    this.layerGroup.clearLayers();
  }
}
