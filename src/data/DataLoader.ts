import type { Runway, ILSData } from '../map/RunwayLayer';
import type { Taxiway } from '../map/TaxiwayLayer';
import type { Gate } from '../map/GateLayer';

/**
 * Aircraft specification from aircraft_specs.json
 */
export interface AircraftSpec {
  type: string;
  icao_code: string;
  manufacturer: string;
  category: string;
  wake_category: string;
  wingspan_ft: number;
  length_ft: number;
  mtow_lbs: number;
  mlw_lbs: number;
  engines: number;
  performance: {
    v1_kts: number;
    vr_kts: number;
    v2_kts: number;
    vref_kts: number;
    cruise_speed_kts: number;
    max_speed_kts: number;
    initial_climb_speed_kts: number;
    approach_speed_kts: number;
    /** ft/min */
    climb_rate_fpm: number;
    descent_rate_fpm: number;
    /** kts/s — JSON field name from aircraft_specs.json */
    accel_rate_ktps?: number;
    decel_rate_ktps?: number;
    /** Older alias kept for backwards compat */
    acceleration_kts_per_sec?: number;
    deceleration_kts_per_sec?: number;
    /** kts */
    normal_taxi_speed_kts?: number;
    max_taxi_speed_kts?: number;
    taxi_speed_kts?: number;
    bank_rate_deg_per_sec?: number;
    takeoff_run_ft?: number;
    landing_roll_ft?: number;
    min_runway_length_ft?: number;
  };
}

/**
 * Flight data from sample_flights.json
 */
export interface FlightData {
  callsign: string;
  flight_number: string;
  airline_icao: string;
  aircraft_type: string;
  origin_icao: string;
  origin_city?: string;
  destination_icao: string;
  destination_city?: string;
  approach_bearing_from_slc?: number;
  star?: string;
  /** Arriving / airborne / active aircraft have this field */
  initial_position?: { lat: number; lon: number };
  /** Taxi / pushback aircraft use this field instead of initial_position */
  current_position?: { lat: number; lon: number };
  /** Parked aircraft with no explicit position — look up from gate data */
  gate?: string;
  /** MSL altitude in feet; defaults to field elevation (4227 ft) for ground aircraft */
  initial_altitude_ft?: number;
  /** Speed in knots; defaults to 0 for parked/taxi aircraft */
  initial_speed_kts?: number;
  /** Heading in degrees; defaults to 360 for ground aircraft */
  initial_heading?: number;
  /** Altitude when using current_position (in-flight or active taxi) */
  current_altitude_ft?: number;
  /** Speed when using current_position */
  current_speed_kts?: number;
  /** Heading when using current_position */
  current_heading?: number;
  assigned_runway: string | null;
  phase: string;
  squawk: number;
  /** Marker for aircraft_in_flight section — not a departure, never requests pushback */
  in_flight?: boolean;
}

/**
 * Airline data from airlines.json
 */
export interface Airline {
  icao: string;
  name: string;
  callsign: string;
  country: string;
}

/**
 * Waypoint data from slc_waypoints.json
 */
export interface Waypoint {
  name: string;
  lat: number;
  lon: number;
  type?: string;
  altitude_ft?: number;
  speed_kt?: number;
  runway?: string;
}

// ─── Raw JSON shapes (as stored in files) ────────────────────────────────────

interface RawThreshold {
  runway_end: string;
  lat: number;
  lon: number;
  elevation_ft: number;
}

interface RawILS {
  localizer_freq_mhz: number;
  localizer_identifier?: string;   // optional — some ends lack it
  glide_slope_deg?: number;
  category?: string;
  dh_ft?: number;
}

interface RawRunway {
  id: string;
  id_a: string;
  id_b: string;
  heading_a_true: number;
  heading_b_true: number;
  length_ft: number;
  width_ft: number;
  threshold_a: RawThreshold;
  threshold_b: RawThreshold;
  ils?: Record<string, RawILS | null>;
}

interface RawTaxiwayNode {
  id: string;
  lat: number;
  lon: number;
}

interface RawTaxiway {
  id: string;
  name: string;
  width_ft?: number;
  /** 'taxiway' for main taxiways, 'taxilane' for apron lanes serving gates */
  subtype?: string;
  nodes: RawTaxiwayNode[];
}

interface RawGate {
  id: string;
  terminal: string;
  lat: number;
  lon: number;
  type: string;
  taxiway_exit: string;
  nose_heading?: number;
  parking_lat?: number;
  parking_lon?: number;
}

interface RawGraphEdge {
  from: string;
  to: string;
  dist_ft: number;
}

export interface TaxiwayGraphData {
  /** All taxiway nodes keyed by their node ID (e.g. "G31") */
  nodeMap: Map<string, { lat: number; lon: number }>;
  /** Adjacency list for Dijkstra: nodeId → [{to, distFt}] */
  adjacency: Map<string, { to: string; distFt: number }[]>;
  /** Which taxiways each node belongs to (by taxiway id, upper-cased) */
  nodeToTaxiways: Map<string, string[]>;
}

interface WaypointsFile {
  approach_fixes?: Record<string, { lat: number; lon: number; type: string; runway?: string; altitude_ft?: number }>;
  stars?: Record<string, { waypoints: Array<{ name: string; lat: number; lon: number; altitude_ft?: number; speed_kt?: number }> }>;
  sids?: Record<string, { waypoints: Array<{ name: string; lat: number; lon: number; altitude_ft?: number; speed_kt?: number }> }>;
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * DataLoader class
 * Loads and validates all JSON data files
 */
export class DataLoader {
  private static instance: DataLoader;
  
  private aircraftSpecs: Map<string, AircraftSpec> = new Map();
  private airlines: Map<string, Airline> = new Map();
  private runways: Runway[] = [];
  private taxiways: Taxiway[] = [];
  private gates: Gate[] = [];
  private waypoints: Map<string, Waypoint> = new Map();
  private sampleFlights: FlightData[] = [];
  
  private loaded = false;
  private taxiwayGraph: TaxiwayGraphData = {
    nodeMap: new Map(),
    adjacency: new Map(),
    nodeToTaxiways: new Map(),
  };
  /**
   * Gate backup paths keyed by gate id.
   * Each entry is an ordered list of lat/lon waypoints from gate outward (for pushback).
   */
  private gateBackupPaths: Map<string, { lat: number; lon: number; nodeId: string }[]> = new Map();

  private constructor() {}

  static getInstance(): DataLoader {
    if (!DataLoader.instance) {
      DataLoader.instance = new DataLoader();
    }
    return DataLoader.instance;
  }

  /**
   * Load all data files
   */
  async loadAll(): Promise<void> {
    if (this.loaded) {
      console.log('Data already loaded');
      return;
    }

    try {
      console.log('Loading data files...');

      type TaxiwayFileShape = { taxiways: RawTaxiway[]; gates?: RawGate[]; graph_edges?: RawGraphEdge[] };

      // Load everything except taxiway-lines in parallel;
      // we resolve taxiway-lines separately so we can try custom_taxiways.json first.
      const [
        aircraftSpecsData,
        airlinesData,
        runwaysData,
        airportTaxiwayData,   // always loaded — provides gates
        waypointsData,
        sampleFlightsData
      ] = await Promise.all([
        this.fetchJSON<{ aircraft: AircraftSpec[] }>('/data/aircraft_specs.json'),
        this.fetchJSON<{ airlines: Airline[] }>('/data/airlines.json'),
        this.fetchJSON<{ runways: RawRunway[] }>('/data/slc_runways.json'),
        this.fetchJSON<TaxiwayFileShape>('/data/slc_taxiways.json'),
        this.fetchJSON<WaypointsFile>('/data/slc_waypoints.json'),
        this.fetchJSON<{ initial_arrivals: FlightData[]; initial_departures: FlightData[]; aircraft_in_flight?: FlightData[] }>('/data/sample_flights.json')
      ]);

      // ── Custom taxiway network override ──────────────────────────────────
      // If data/custom_taxiways.json exists (written by the editor), use it
      // for taxiway LINES and routing edges.  Gates always come from the
      // airport base file so gate positions / ids are never lost.
      let taxiwaysData: TaxiwayFileShape = airportTaxiwayData;
      try {
        const customResp = await fetch(this.dataUrl('/data/custom_taxiways.json'));
        if (customResp.ok) {
          const custom = await customResp.json() as TaxiwayFileShape;
          if (Array.isArray(custom.taxiways)) {
            taxiwaysData = custom;
            console.log('📐 Loaded custom taxiway network (custom_taxiways.json) —',
              custom.taxiways.length, 'taxiways,',
              (custom.graph_edges ?? []).length, 'edges');
          }
        }
      } catch { /* no custom file or parse error — silently fall back */ }

      // Process aircraft specs
      aircraftSpecsData.aircraft.forEach(spec => {
        this.aircraftSpecs.set(spec.type, spec);
      });

      // Process airlines
      airlinesData.airlines.forEach(airline => {
        this.airlines.set(airline.icao, airline);
      });

      // Process runways — convert raw threshold format to renderable polygons
      this.runways = runwaysData.runways.map(rw => this.normalizeRunway(rw));

      // Process taxiways — nodes[] → coordinates[]
      this.taxiways = taxiwaysData.taxiways.map(tw => ({
        id: tw.id,
        name: tw.name,
        subtype: tw.subtype ?? 'taxiway',
        type: tw.id,
        width_ft: tw.width_ft ?? 75,
        coordinates: tw.nodes.map(n => ({ lat: n.lat, lon: n.lon }))
      }));

      // Extract gate backup paths — taxiways with subtype 'gate_backup'
      // whose first or last node id is 'GATE_{gateId}'
      this.gateBackupPaths.clear();
      for (const tw of taxiwaysData.taxiways) {
        if (tw.subtype !== 'gate_backup' || tw.nodes.length < 2) continue;
        const first = tw.nodes[0];
        const last  = tw.nodes[tw.nodes.length - 1];
        // Check if first node is the gate end
        const firstGateMatch = first.id.match(/^GATE_(.+)$/);
        const lastGateMatch  = last.id.match(/^GATE_(.+)$/);
        if (firstGateMatch) {
          const gateId = firstGateMatch[1];
          // Waypoints go from first (gate) outward: [0, 1, 2, ...]
          this.gateBackupPaths.set(gateId, tw.nodes.map(n => ({ lat: n.lat, lon: n.lon, nodeId: n.id })));
        } else if (lastGateMatch) {
          const gateId = lastGateMatch[1];
          // Reverse so waypoints go from gate outward
          const reversed = [...tw.nodes].reverse();
          this.gateBackupPaths.set(gateId, reversed.map(n => ({ lat: n.lat, lon: n.lon, nodeId: n.id })));
        }
      }

      // Gates ALWAYS come from the airport base file — never from the custom
      // taxiway network (which only contains taxiway centerlines).
      this.gates = (airportTaxiwayData.gates ?? []).map(g => ({
        id: g.id,
        terminal: g.terminal,
        lat: g.lat,
        lon: g.lon,
        type: g.type,
        taxiway_exit: g.taxiway_exit,
        nose_heading: g.nose_heading,
        parking_lat:  g.parking_lat,
        parking_lon:  g.parking_lon,
      }));

      // Build taxiway graph for Dijkstra-based routing
      const nodeMap: TaxiwayGraphData['nodeMap'] = new Map();
      const nodeToTaxiways: TaxiwayGraphData['nodeToTaxiways'] = new Map();
      for (const tw of taxiwaysData.taxiways) {
        const twId = tw.id.toUpperCase();
        for (const node of tw.nodes) {
          nodeMap.set(node.id, { lat: node.lat, lon: node.lon });
          const existing = nodeToTaxiways.get(node.id) ?? [];
          if (!existing.includes(twId)) existing.push(twId);
          nodeToTaxiways.set(node.id, existing);
        }
      }
      const adjacency: TaxiwayGraphData['adjacency'] = new Map();
      for (const edge of (taxiwaysData.graph_edges ?? [])) {
        const fwd = adjacency.get(edge.from) ?? [];
        fwd.push({ to: edge.to, distFt: edge.dist_ft });
        adjacency.set(edge.from, fwd);
        const bwd = adjacency.get(edge.to) ?? [];
        bwd.push({ to: edge.from, distFt: edge.dist_ft });
        adjacency.set(edge.to, bwd);
      }

      // ── Gate stand nodes ──────────────────────────────────────────────────
      // Each gate becomes a first-class graph node so Dijkstra can route
      // directly to/from every gate stand.  Gates always come from the airport
      // base file.  If a custom taxiway network is in use, the taxiway_exit
      // IDs may not match — fall back to nearest-node snapping in that case.
      const gateData = airportTaxiwayData.gates ?? [];
      for (const gate of gateData) {
        const standLat = gate.parking_lat ?? gate.lat;
        const standLon = gate.parking_lon ?? gate.lon;
        const gateNodeId = `GATE_${gate.id}`;

        // Register the stand position as a graph node
        nodeMap.set(gateNodeId, { lat: standLat, lon: standLon });
        const existing = nodeToTaxiways.get(gateNodeId) ?? [];
        if (!existing.includes('GATE')) existing.push('GATE');
        nodeToTaxiways.set(gateNodeId, existing);

        // Determine which taxiway node to connect this gate to.
        // Prefer the declared taxiway_exit if it exists in the current graph;
        // otherwise snap to the nearest node (needed for custom networks).
        let exitNodeId: string | null = null;
        if (gate.taxiway_exit && nodeMap.has(gate.taxiway_exit) &&
            gate.taxiway_exit !== gateNodeId) {
          exitNodeId = gate.taxiway_exit;
        } else if (nodeMap.size > 0) {
          // Find nearest non-gate node in the graph
          let bestDist = Infinity;
          for (const [nid, npos] of nodeMap) {
            if (nid === gateNodeId || nid.startsWith('GATE_')) continue;
            const d = DataLoader.haversineFt(standLat, standLon, npos.lat, npos.lon);
            if (d < bestDist) { bestDist = d; exitNodeId = nid; }
          }
        }

        if (exitNodeId) {
          const already = (adjacency.get(gateNodeId) ?? []).some(e => e.to === exitNodeId);
          if (!already) {
            const exitNode = nodeMap.get(exitNodeId)!;
            const d = DataLoader.haversineFt(standLat, standLon, exitNode.lat, exitNode.lon);
            const fwd = adjacency.get(gateNodeId) ?? [];
            fwd.push({ to: exitNodeId, distFt: d });
            adjacency.set(gateNodeId, fwd);
            const bwd = adjacency.get(exitNodeId) ?? [];
            bwd.push({ to: gateNodeId, distFt: d });
            adjacency.set(exitNodeId, bwd);
          }
        }
      }

      this.taxiwayGraph = { nodeMap, adjacency, nodeToTaxiways };

      // Process waypoints from approach_fixes and STAR waypoints
      const approachFixes = waypointsData.approach_fixes ?? {};
      Object.entries(approachFixes).forEach(([name, fix]) => {
        this.waypoints.set(name, { name, ...(fix as object) } as Waypoint);
      });
      const stars = waypointsData.stars ?? {};
      Object.values(stars).forEach((star: unknown) => {
        const s = star as { waypoints: Array<Waypoint> };
        (s.waypoints ?? []).forEach(wp => {
          if (!this.waypoints.has(wp.name)) this.waypoints.set(wp.name, wp);
        });
      });

      // Process sample flights — tag in-flight aircraft so main.ts never requests pushback
      const inFlight = (sampleFlightsData.aircraft_in_flight ?? []).map(fd => ({ ...fd, in_flight: true }));
      this.sampleFlights = [
        ...(sampleFlightsData.initial_arrivals ?? []),
        ...(sampleFlightsData.initial_departures ?? []),
        ...inFlight,
      ];

      this.loaded = true;

      console.log('✅ All data loaded successfully');
      console.log(`  - Aircraft types: ${this.aircraftSpecs.size}`);
      console.log(`  - Airlines: ${this.airlines.size}`);
      console.log(`  - Runways: ${this.runways.length}`);
      console.log(`  - Taxiways: ${this.taxiways.length}`);
      console.log(`  - Gates: ${this.gates.length}`);
      console.log(`  - Waypoints: ${this.waypoints.size}`);
      console.log(`  - Sample flights: ${this.sampleFlights.length}`);

    } catch (error) {
      console.error('❌ Error loading data files:', error);
      throw error;
    }
  }

  /** Resolve a data file path relative to the app's base URL. */
  private dataUrl(path: string): string {
    return (import.meta.env.BASE_URL ?? '/') + path.replace(/^\//, '');
  }

  /**
   * Fetch and parse JSON file
   */
  private async fetchJSON<T>(url: string): Promise<T> {
    const response = await fetch(this.dataUrl(url));
    if (!response.ok) {
      throw new Error(`Failed to fetch ${url}: ${response.statusText}`);
    }
    return response.json();
  }

  /** Haversine distance in feet between two lat/lon points. */
  static haversineFt(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 3440.065 * 6076.115; // Earth radius in feet
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.asin(Math.sqrt(a));
  }

  /**
   * True bearing from point A to point B, range 0–360°.
   * Derived from actual coordinates — never relies on stored heading fields.
   */
  private static bearingBetween(
    lat1: number, lon1: number,
    lat2: number, lon2: number
  ): number {
    const toRad = (d: number) => d * Math.PI / 180;
    const dLon  = toRad(lon2 - lon1);
    const lat1r = toRad(lat1), lat2r = toRad(lat2);
    const y = Math.sin(dLon) * Math.cos(lat2r);
    const x = Math.cos(lat1r) * Math.sin(lat2r)
             - Math.sin(lat1r) * Math.cos(lat2r) * Math.cos(dLon);
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  }

  /**
   * Convert a raw runway (threshold_a/threshold_b) into a renderable Runway with
   * four polygon corners offset perpendicular to the runway heading.
   *
   * Heading values are ALWAYS derived from the actual threshold coordinates so
   * the ILS cone and polygon perpendicular are never skewed by stale JSON values.
   */
  private normalizeRunway(rw: RawRunway): Runway {
    const { threshold_a: ta, threshold_b: tb, width_ft, length_ft, id_a, id_b } = rw;

    // Derive headings from actual threshold lat/lon — single source of truth.
    // heading_a: direction aircraft FLY when using runway id_a
    //            = bearing FROM threshold_b TOWARD threshold_a
    const heading_a_true = DataLoader.bearingBetween(tb.lat, tb.lon, ta.lat, ta.lon);
    const heading_b_true = DataLoader.bearingBetween(ta.lat, ta.lon, tb.lat, tb.lon);

    // Metres-per-degree approximations at ORD (~42°N)
    const midLat = (ta.lat + tb.lat) / 2;
    const ftPerDegLat = 364_620;
    const ftPerDegLon = 364_620 * Math.cos(midLat * Math.PI / 180);

    // Perpendicular bearing (90° clockwise from runway heading_a)
    const perpDeg = (heading_a_true + 90) % 360;
    const perpRad = perpDeg * (Math.PI / 180);

    // Offset for half the runway width
    const halfW = width_ft / 2;
    const dLat = Math.cos(perpRad) * (halfW / ftPerDegLat);
    const dLon = Math.sin(perpRad) * (halfW / ftPerDegLon);

    // ILS for both ends
    const rawIlsA = rw.ils?.[id_a];
    const rawIlsB = rw.ils?.[id_b];
    // null or missing → no ILS for that end
    const toIls = (r?: RawILS | null, endId = ''): ILSData | undefined =>
      r ? {
        freq_mhz:        r.localizer_freq_mhz,
        identifier:      r.localizer_identifier ?? `I-${endId}`,
        glide_slope_deg: r.glide_slope_deg ?? 3.0,
        category:        r.category ?? 'I',
        dh_ft:           r.dh_ft ?? 200,
      } : undefined;

    return {
      id: rw.id,
      name: `${id_a}/${id_b}`,
      id_a,
      id_b,
      heading:   heading_a_true,
      heading_b: heading_b_true,
      length_ft,
      width_ft,
      threshold_a: { lat: ta.lat, lon: ta.lon },
      threshold_b: { lat: tb.lat, lon: tb.lon },
      // Four corners: side A left/right, side B right/left (clockwise)
      coordinates: [
        { lat: ta.lat + dLat, lon: ta.lon + dLon },
        { lat: tb.lat + dLat, lon: tb.lon + dLon },
        { lat: tb.lat - dLat, lon: tb.lon - dLon },
        { lat: ta.lat - dLat, lon: ta.lon - dLon },
      ],
      ils_a: toIls(rawIlsA, id_a),
      ils_b: toIls(rawIlsB, id_b),
    };
  }

  // Getters
  getAircraftSpec(type: string): AircraftSpec | undefined {
    return this.aircraftSpecs.get(type);
  }

  getAllAircraftSpecs(): AircraftSpec[] {
    return Array.from(this.aircraftSpecs.values());
  }

  getAirline(icao: string): Airline | undefined {
    return this.airlines.get(icao);
  }

  getAllAirlines(): Airline[] {
    return Array.from(this.airlines.values());
  }

  getRunways(): Runway[] {
    return this.runways;
  }

  getTaxiways(): Taxiway[] {
    return this.taxiways;
  }

  getTaxiwayGraph(): TaxiwayGraphData {
    return this.taxiwayGraph;
  }

  /**
   * Returns the gate backup pushback path for the given gate id, or null if none.
   * Waypoints are ordered from the gate outward (pushback direction).
   * The first waypoint is at the gate; subsequent waypoints trace the path.
   */
  getGateBackupPath(gateId: string): { lat: number; lon: number; nodeId: string }[] | null {
    return this.gateBackupPaths.get(gateId) ?? null;
  }

  getGates(): Gate[] {
    return this.gates;
  }

  getWaypoint(name: string): Waypoint | undefined {
    return this.waypoints.get(name);
  }

  getAllWaypoints(): Waypoint[] {
    return Array.from(this.waypoints.values());
  }

  getSampleFlights(): FlightData[] {
    return this.sampleFlights;
  }

  isLoaded(): boolean {
    return this.loaded;
  }
}
