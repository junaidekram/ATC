import L from 'leaflet';
import { catmullRom } from './curveUtils';

export interface Taxiway {
  id: string;
  name: string;       // e.g. "Alpha"
  type: string;       // same as id, used as key
  width_ft: number;
  /** 'taxiway' for main taxiways, 'taxilane' for apron lanes serving gates */
  subtype?: string;
  coordinates: {
    lat: number;
    lon: number;
  }[];
}

/** Colour palette for taxiway lines */
const TAXIWAY_COLOR       = '#7AADFF';   // blue — main taxiways
const TAXILANE_COLOR      = '#5090CC';   // slightly darker — apron taxilanes
const TAXIWAY_LABEL_COLOR = '#B0D4FF';

/**
 * TaxiwayLayer
 * Renders taxiways as blue polylines with letter labels at their midpoints.
 */
export class TaxiwayLayer {
  private layerGroup: L.LayerGroup;
  private labelLayerGroup: L.LayerGroup;
  private taxiwayPolylines: Map<string, L.Polyline> = new Map();

  constructor(layerGroup: L.LayerGroup, labelLayerGroup?: L.LayerGroup) {
    this.layerGroup = layerGroup;
    this.labelLayerGroup = labelLayerGroup ?? layerGroup;
  }

  renderTaxiways(taxiways: Taxiway[]): void {
    taxiways.forEach(tw => this.renderTaxiway(tw));
  }

  private renderTaxiway(tw: Taxiway): void {
    if (tw.coordinates.length < 2) return;

    const isLane = (tw.subtype ?? 'taxiway') === 'taxilane';
    const color  = isLane ? TAXILANE_COLOR : TAXIWAY_COLOR;
    // Width: taxilanes are narrower; main taxiways scale with declared width
    const weight = isLane
      ? Math.max(1, Math.round((tw.width_ft ?? 35) / 25))
      : Math.max(2, Math.round((tw.width_ft ?? 75) / 28));

    // Apply Catmull-Rom smoothing — more passes for main taxiways that have
    // fewer OSM survey nodes (taxilanes are already dense enough).
    const smoothed = isLane
      ? catmullRom(tw.coordinates, 3)
      : catmullRom(tw.coordinates, 5);

    const latLngs: L.LatLngExpression[] = smoothed.map(c => [c.lat, c.lon]);

    const polyline = L.polyline(latLngs, { color, weight, opacity: 0.80 })
      .bindTooltip(`${isLane ? 'Lane' : 'Taxiway'} ${tw.id}`, {
        permanent: false,
        direction: 'center',
      })
      .addTo(this.layerGroup);

    this.taxiwayPolylines.set(tw.id, polyline);

    // ── Letter/name label at geometric midpoint ──────────────────────────
    // For taxilanes only add a label if the segment is long enough to avoid clutter
    const rawLen = tw.coordinates.length;
    if (isLane && rawLen < 3) return;

    const mid = this.midpoint(tw.coordinates);
    if (mid) this.addLabel(mid.lat, mid.lon, tw.id);

    // Additional labels at 1/3 and 2/3 for long main taxiways
    if (!isLane && rawLen >= 6) {
      const third    = Math.floor(rawLen / 3);
      const twoThird = Math.floor((2 * rawLen) / 3);
      this.addLabel(tw.coordinates[third].lat,    tw.coordinates[third].lon,    tw.id);
      this.addLabel(tw.coordinates[twoThird].lat, tw.coordinates[twoThird].lon, tw.id);
    }
  }

  private addLabel(lat: number, lon: number, letter: string): void {
    const icon = L.divIcon({
      html: `<div style="
        background: rgba(0,20,60,0.80);
        border: 1px solid ${TAXIWAY_LABEL_COLOR};
        border-radius: 3px;
        color: ${TAXIWAY_LABEL_COLOR};
        font-family: 'Courier New', monospace;
        font-weight: 700;
        font-size: 10px;
        width: 16px;
        height: 16px;
        display: flex;
        align-items: center;
        justify-content: center;
        line-height: 1;
        pointer-events: none;
      ">${letter}</div>`,
      className: '',
      iconSize: [16, 16],
      iconAnchor: [8, 8]
    });

    L.marker([lat, lon], { icon, interactive: false }).addTo(this.labelLayerGroup);
  }

  /** Return the coordinate at the geometric midpoint of the path */
  private midpoint(coords: { lat: number; lon: number }[]): { lat: number; lon: number } | null {
    if (coords.length === 0) return null;
    if (coords.length === 1) return coords[0];

    // Find the middle-indexed point
    const mid = Math.floor(coords.length / 2);
    const a = coords[mid - 1];
    const b = coords[mid];
    return { lat: (a.lat + b.lat) / 2, lon: (a.lon + b.lon) / 2 };
  }

  clearAll(): void {
    this.layerGroup.clearLayers();
    this.labelLayerGroup.clearLayers();
    this.taxiwayPolylines.clear();
  }
}

