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
};

function terminalColor(terminal: string): string {
  return TERMINAL_COLORS[terminal] ?? '#AAAAAA';
}

/**
 * GateLayer – renders gate markers with terminal colouring.
 * Labels are only shown at zoom ≥ 15 to avoid clutter.
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
    gates.forEach(g => this.renderGate(g));
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
      fillOpacity: 0.7,
    });

    const typeLabel = gate.type === 'widebody_intl' ? 'Intl widebody' :
                      gate.type === 'widebody'      ? 'Widebody' : 'Narrowbody';
    marker.bindTooltip(
      `<strong>Gate ${gate.id}</strong><br/>Terminal ${gate.terminal}<br/>${typeLabel}`,
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
