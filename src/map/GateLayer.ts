import L from 'leaflet';

export interface Gate {
  id: string;
  terminal: string;
  lat: number;
  lon: number;
  type: string;           // narrowbody | widebody | widebody_intl
  taxiway_exit: string;
  /** Precomputed bearing toward terminal (nose-in direction) */
  nose_heading?: number;
  /** Parking stand lat (offset 18 m outward from gate coord onto apron) */
  parking_lat?: number;
  /** Parking stand lon */
  parking_lon?: number;
}

/** Colour per terminal */
const TERMINAL_COLORS: Record<string, string> = {
  '1': '#44AAFF',   // blue  – United
  '2': '#FF8844',   // orange – American domestic
  '3': '#44CC66',   // green  – American T3
  '5': '#CC44FF',   // purple – international
  // KSLC concourses
  'A': '#00BFFF',   // deep sky blue – Concourse A
  'B': '#FF8C00',   // dark orange – Concourse B
};

function terminalColor(terminal: string): string {
  return TERMINAL_COLORS[terminal] ?? '#AAAAAA';
}

/** Extra padding (degrees) around a gate cluster to draw the concourse box */
const CONCOURSE_PAD_LAT = 0.00035;  // ~39 m
const CONCOURSE_PAD_LON = 0.0006;   // ~50 m

/**
 * GateLayer – renders concourse building outlines + gate markers with
 * terminal colouring.  Labels are shown at zoom ≥ 15 to avoid clutter.
 */
export class GateLayer {
  private layerGroup: L.LayerGroup;
  private gates: Gate[] = [];

  constructor(layerGroup: L.LayerGroup) {
    this.layerGroup = layerGroup;
  }

  renderGates(gates: Gate[]): void {
    this.gates = gates;
    this.layerGroup.clearLayers();

    // Draw concourse building outlines first (appear underneath gate dots)
    this.renderConcourseOutlines(gates);

    // Draw individual gate markers on top
    gates.forEach(g => this.renderGate(g));
  }

  /** Draw a filled rectangle + label for each unique terminal group */
  private renderConcourseOutlines(gates: Gate[]): void {
    // Group gates by terminal
    const byTerminal = new Map<string, Gate[]>();
    for (const g of gates) {
      const list = byTerminal.get(g.terminal) ?? [];
      list.push(g);
      byTerminal.set(g.terminal, list);
    }

    for (const [terminal, tGates] of byTerminal) {
      if (tGates.length === 0) continue;
      const color = terminalColor(terminal);

      const minLat = Math.min(...tGates.map(g => g.lat)) - CONCOURSE_PAD_LAT;
      const maxLat = Math.max(...tGates.map(g => g.lat)) + CONCOURSE_PAD_LAT;
      const minLon = Math.min(...tGates.map(g => g.lon)) - CONCOURSE_PAD_LON;
      const maxLon = Math.max(...tGates.map(g => g.lon)) + CONCOURSE_PAD_LON;

      // Filled building outline
      L.rectangle([[minLat, minLon], [maxLat, maxLon]], {
        color,
        weight: 1.5,
        opacity: 0.85,
        fillColor: color,
        fillOpacity: 0.12,
        interactive: false,
      }).addTo(this.layerGroup);

      // Spine line running east-west through center
      const midLat = (minLat + maxLat) / 2;
      L.polyline([[midLat, minLon], [midLat, maxLon]], {
        color,
        weight: 2.5,
        opacity: 0.6,
        interactive: false,
        dashArray: '6 4',
      }).addTo(this.layerGroup);

      // Concourse label near west end
      const label = L.divIcon({
        html: `<div style="
          color:${color};font-family:'Courier New',monospace;font-size:10px;
          font-weight:800;text-shadow:0 0 4px #000,0 0 4px #000;
          white-space:nowrap;pointer-events:none;
        ">CONCOURSE ${terminal}</div>`,
        className: '',
        iconSize: [120, 14],
        iconAnchor: [0, 7],
      });
      L.marker([midLat, minLon + 0.0002], { icon: label, interactive: false })
        .addTo(this.layerGroup);
    }
  }

  private renderGate(gate: Gate): void {
    const color = terminalColor(gate.terminal);
    const radius = gate.type === 'widebody_intl' ? 5 :
                   gate.type === 'widebody'      ? 4 : 3;

    const marker = L.circleMarker([gate.lat, gate.lon], {
      radius,
      color,
      weight: 1.5,
      fillColor: color,
      fillOpacity: 0.85,
    });

    const typeLabel = gate.type === 'widebody_intl' ? 'Intl widebody' :
                      gate.type === 'widebody'      ? 'Widebody' : 'Narrowbody';
    marker.bindTooltip(
      `<strong>Gate ${gate.id}</strong><br/>Concourse ${gate.terminal}<br/>${typeLabel}`,
      { direction: 'top', offset: [0, -4] }
    );

    // Inline letter label (visible at high zoom via CSS)
    const icon = L.divIcon({
      html: `<div class="gate-label" style="
        color:${color};
        font-family:'Courier New',monospace;
        font-size:9px;
        font-weight:700;
        text-shadow:0 0 3px #000,0 0 3px #000;
        white-space:nowrap;
        pointer-events:none;
        transform:translateX(-50%);
        margin-top:5px;
      ">${gate.id}</div>`,
      className: '',
      iconSize: [32, 12],
      iconAnchor: [16, 0],
    });

    const labelMarker = L.marker([gate.lat, gate.lon], {
      icon,
      interactive: false,
      zIndexOffset: -100,
    });

    marker.addTo(this.layerGroup);
    labelMarker.addTo(this.layerGroup);
  }

  clearAll(): void {
    this.layerGroup.clearLayers();
  }
}

