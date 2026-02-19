# Implementation Guide — Step-by-Step Developer Walkthrough

This guide walks a developer through building the ATC simulator from scratch, referencing all data files and documentation. Follow the phases in order. Do not skip phases.

---

## Prerequisites

Before writing code, read these documents completely:

1. `docs/REQUIREMENTS.md` — understand what must be built
2. `docs/MAP_SETUP_GUIDE.md` — understand the map coordinate system
3. `docs/RUNWAY_GUIDE.md` — understand the airport geometry
4. `docs/FLIGHT_DYNAMICS.md` — understand aircraft movement rules
5. `docs/ATC_COMMANDS_REFERENCE.md` — understand the command system

---

## Technology Stack Recommendation

| Layer | Recommended Technology | Alternative |
|---|---|---|
| Language | TypeScript | JavaScript (ES2022+) |
| Map rendering | Leaflet.js + Canvas overlay | Pure HTML5 Canvas |
| Build system | Vite | Webpack, Parcel |
| Testing | Vitest | Jest |
| Styling | CSS Modules | Tailwind CSS |
| Data format | JSON | — |

**No server required for v1.0.** Everything runs client-side in the browser.

---

## Phase 0 — Project Setup

### Step 0.1 — Initialize the Project

```bash
npm create vite@latest atc-sim -- --template vanilla-ts
cd atc-sim
npm install
npm install leaflet @types/leaflet
```

### Step 0.2 — Folder Structure

```
src/
├── main.ts              # entry point
├── map/
│   ├── MapController.ts # Leaflet map init & layers
│   ├── RunwayLayer.ts   # render runways
│   ├── TaxiwayLayer.ts  # render taxiways
│   └── AircraftLayer.ts # render aircraft icons
├── aircraft/
│   ├── Aircraft.ts      # aircraft state class
│   ├── FlightPhase.ts   # enum: PARKED, TAXI, TAKEOFF, etc.
│   └── Physics.ts       # speed/altitude/heading updates
├── atc/
│   ├── CommandParser.ts # parse player commands
│   ├── CommandHandler.ts# execute commands
│   └── CommsLog.ts      # log all radio communications
├── ai/
│   ├── AIController.ts  # spawn and manage AI aircraft
│   ├── StarRouter.ts    # STAR waypoint navigation
│   └── TaxiRouter.ts    # A* pathfinding on taxiway graph
├── data/
│   └── DataLoader.ts    # load and validate JSON data files
├── ui/
│   ├── ArrivalPanel.ts  # arrival queue UI
│   ├── DeparturePanel.ts# departure queue UI
│   ├── AircraftPanel.ts # selected aircraft detail panel
│   └── AtisPanel.ts     # ATIS broadcast
└── simulation/
    ├── SimLoop.ts        # main simulation tick loop
    ├── Separation.ts     # separation monitoring
    └── Scoring.ts        # score tracking
```

---

## Phase 1 — Map Rendering

### Step 1.1 — Initialize the Leaflet Map

```typescript
// src/map/MapController.ts
import L from 'leaflet';

export class MapController {
  private map: L.Map;
  
  constructor(containerId: string) {
    this.map = L.map(containerId, {
      center: [41.9802, -87.9090],  // ORD ARP
      zoom: 12,
      minZoom: 9,   // ~50 nm view
      maxZoom: 19,  // gate-level detail
    });
    
    // OSM tiles
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
    }).addTo(this.map);
  }
  
  getMap(): L.Map { return this.map; }
}
```

### Step 1.2 — Render Runways from JSON

```typescript
// src/map/RunwayLayer.ts
import L from 'leaflet';
import type { RunwayData } from '../data/DataLoader';

export function renderRunways(map: L.Map, runways: RunwayData[]) {
  const layer = L.layerGroup();
  
  runways.forEach(rwy => {
    const threshA: [number, number] = [rwy.threshold_a.lat, rwy.threshold_a.lon];
    const threshB: [number, number] = [rwy.threshold_b.lat, rwy.threshold_b.lon];
    
    // Runway centerline
    L.polyline([threshA, threshB], {
      color: '#222222',
      weight: 10,
      opacity: 1.0,
    }).addTo(layer);
    
    // Runway ID labels
    [
      { pos: threshA, label: rwy.id_a },
      { pos: threshB, label: rwy.id_b },
    ].forEach(({ pos, label }) => {
      L.marker(pos, {
        icon: L.divIcon({
          html: `<div class="rwy-num">${label}</div>`,
          iconSize: [30, 20],
          iconAnchor: [15, 10],
        }),
      }).addTo(layer);
    });
  });
  
  layer.addTo(map);
  return layer;
}
```

### Step 1.3 — Render Taxiways from JSON

```typescript
// src/map/TaxiwayLayer.ts
export function renderTaxiways(map: L.Map, taxiways: TaxiwayData[]) {
  const layer = L.layerGroup();
  
  taxiways.forEach(tw => {
    const points: [number, number][] = tw.nodes.map(n => [n.lat, n.lon]);
    
    L.polyline(points, {
      color: '#8B8B00',
      weight: 3,
      opacity: 0.9,
    }).addTo(layer);
    
    // Label at midpoint
    const mid = tw.nodes[Math.floor(tw.nodes.length / 2)];
    L.marker([mid.lat, mid.lon], {
      icon: L.divIcon({
        html: `<div class="tw-label">${tw.id}</div>`,
      }),
    }).addTo(layer);
  });
  
  layer.addTo(map);
  return layer;
}
```

---

## Phase 2 — Aircraft Class

### Step 2.1 — Aircraft State

```typescript
// src/aircraft/Aircraft.ts
import { FlightPhase } from './FlightPhase';
import type { AircraftSpec } from '../data/DataLoader';

export interface AircraftState {
  callsign: string;
  airline: string;
  flightNumber: string;
  type: string;
  origin: string;
  destination: string;
  lat: number;
  lon: number;
  altitude: number;      // ft MSL
  speed: number;         // kts
  heading: number;       // degrees magnetic
  targetHeading: number;
  targetAltitude: number;
  targetSpeed: number;
  phase: FlightPhase;
  assignedRunway: string | null;
  taxiRoute: string[];   // array of taxiway IDs
  waypoints: { lat: number; lon: number; name: string }[];
  spec: AircraftSpec;
}
```

### Step 2.2 — Physics Update

```typescript
// src/aircraft/Physics.ts
export function updateAircraft(ac: AircraftState, dt: number): void {
  // Update speed
  const speedRate = ac.speed < ac.targetSpeed
    ? ac.spec.accel_rate : ac.spec.decel_rate;
  ac.speed = approach(ac.speed, ac.targetSpeed, speedRate * dt);
  
  // Update altitude
  const altRate = ac.altitude < ac.targetAltitude
    ? ac.spec.climb_rate / 60 : ac.spec.descent_rate / 60;
  ac.altitude = approach(ac.altitude, ac.targetAltitude, altRate * dt);
  
  // Update heading (standard rate turn: 3°/sec)
  const turnRate = 3.0;
  const diff = ((ac.targetHeading - ac.heading + 540) % 360) - 180;
  const turn = Math.sign(diff) * Math.min(Math.abs(diff), turnRate * dt);
  ac.heading = (ac.heading + turn + 360) % 360;
  
  // Move position
  const distNm = ac.speed * dt / 3600;  // kts × sec → nm
  const [lat, lon] = movePosition(ac.lat, ac.lon, ac.heading, distNm);
  ac.lat = lat;
  ac.lon = lon;
}

function approach(current: number, target: number, rate: number): number {
  if (Math.abs(target - current) <= rate) return target;
  return current + Math.sign(target - current) * rate;
}

function movePosition(lat: number, lon: number, heading: number, distNm: number) {
  const R = 60; // degrees per nm (approximate)
  const headingRad = (heading * Math.PI) / 180;
  const newLat = lat + (distNm / R) * Math.cos(headingRad);
  const newLon = lon + (distNm / R) * Math.sin(headingRad) / Math.cos((lat * Math.PI) / 180);
  return [newLat, newLon];
}
```

---

## Phase 3 — Command Parser

### Step 3.1 — Parser Structure

```typescript
// src/atc/CommandParser.ts
export interface ParsedCommand {
  callsign: string;
  command: CommandType;
  params: Record<string, string | number>;
}

export enum CommandType {
  CLEARED_IFR = 'CLEARED_IFR',
  PUSH_BACK = 'PUSH_BACK',
  TAXI = 'TAXI',
  HOLD_SHORT = 'HOLD_SHORT',
  CROSS_RUNWAY = 'CROSS_RUNWAY',
  LINE_UP_AND_WAIT = 'LINE_UP_AND_WAIT',
  CLEARED_FOR_TAKEOFF = 'CLEARED_FOR_TAKEOFF',
  ILS_APPROACH_CLEARED = 'ILS_APPROACH_CLEARED',
  CLEARED_TO_LAND = 'CLEARED_TO_LAND',
  GO_AROUND = 'GO_AROUND',
  DESCEND_AND_MAINTAIN = 'DESCEND_AND_MAINTAIN',
  CLIMB_AND_MAINTAIN = 'CLIMB_AND_MAINTAIN',
  FLY_HEADING = 'FLY_HEADING',
  REDUCE_SPEED = 'REDUCE_SPEED',
  HOLD = 'HOLD',
  FREQUENCY_CHANGE = 'FREQUENCY_CHANGE',
}

export function parseCommand(input: string, aircraft: AircraftState[]): ParsedCommand | null {
  const tokens = input.trim().toUpperCase().split(/\s+/);
  const callsign = tokens[0];
  
  // Find aircraft
  const ac = aircraft.find(a => a.callsign === callsign);
  if (!ac) return null;
  
  const rest = tokens.slice(1).join(' ');
  
  // Pattern matching for each command type
  if (rest.startsWith('TAXI')) {
    const match = rest.match(/TAXI (\w+) VIA (.+)/);
    if (match) {
      return {
        callsign,
        command: CommandType.TAXI,
        params: { runway: match[1], route: match[2] }
      };
    }
  }
  
  // ... additional patterns for each command type
  
  return null;
}
```

---

## Phase 4 — Taxiway Pathfinding

### Step 4.1 — Graph Setup

```typescript
// src/ai/TaxiRouter.ts
interface TaxiwayNode {
  id: string;
  lat: number;
  lon: number;
  type: 'junction' | 'runway_entry' | 'gate' | 'hold_short';
}

interface TaxiwayEdge {
  nodeA: string;
  nodeB: string;
  taxiwayId: string;
  distance: number;  // nm
}

class TaxiwayGraph {
  nodes: Map<string, TaxiwayNode> = new Map();
  edges: Map<string, TaxiwayEdge[]> = new Map();
  
  addNode(node: TaxiwayNode) {
    this.nodes.set(node.id, node);
  }
  
  addEdge(edge: TaxiwayEdge) {
    if (!this.edges.has(edge.nodeA)) this.edges.set(edge.nodeA, []);
    if (!this.edges.has(edge.nodeB)) this.edges.set(edge.nodeB, []);
    this.edges.get(edge.nodeA)!.push(edge);
    this.edges.get(edge.nodeB)!.push(edge);
  }
}

// A* pathfinding
function findTaxiRoute(graph: TaxiwayGraph, startId: string, endId: string): string[] {
  // Standard A* implementation
  // Returns array of node IDs representing the path
  // ...
}
```

---

## Phase 5 — Simulation Loop

### Step 5.1 — Main Loop

```typescript
// src/simulation/SimLoop.ts
export class SimLoop {
  private lastTime = 0;
  private simSpeed = 1;
  private running = false;
  
  start() {
    this.running = true;
    requestAnimationFrame(this.tick.bind(this));
  }
  
  private tick(timestamp: number) {
    if (!this.running) return;
    
    const realDt = (timestamp - this.lastTime) / 1000;  // seconds
    const simDt = realDt * this.simSpeed;
    this.lastTime = timestamp;
    
    // Update all aircraft
    aircraft.forEach(ac => updateAircraft(ac, simDt));
    
    // Update AI
    aiController.update(simDt);
    
    // Check separation
    separationMonitor.check(aircraft);
    
    // Update UI
    uiController.update(aircraft);
    
    // Re-render map aircraft layer
    aircraftLayer.render(aircraft);
    
    requestAnimationFrame(this.tick.bind(this));
  }
}
```

---

## Phase 6 — Data Loading

### Step 6.1 — Load All JSON Data

```typescript
// src/data/DataLoader.ts
export async function loadAllData() {
  const [runways, taxiways, waypoints, aircraftSpecs, flights, airlines] = 
    await Promise.all([
      fetch('/data/ord_runways.json').then(r => r.json()),
      fetch('/data/ord_taxiways.json').then(r => r.json()),
      fetch('/data/ord_waypoints.json').then(r => r.json()),
      fetch('/data/aircraft_specs.json').then(r => r.json()),
      fetch('/data/sample_flights.json').then(r => r.json()),
      fetch('/data/airlines.json').then(r => r.json()),
    ]);
  
  // Validate schemas
  validateRunways(runways);
  validateTaxiways(taxiways);
  // ...
  
  return { runways, taxiways, waypoints, aircraftSpecs, flights, airlines };
}
```

---

## Phase 7 — Aircraft Rendering

### Step 7.1 — Aircraft Icon

```typescript
// src/map/AircraftLayer.ts
function createAircraftIcon(ac: AircraftState): L.DivIcon {
  const color = ac.phase === FlightPhase.APPROACH ? '#00ff00'
               : ac.phase === FlightPhase.TAKEOFF ? '#ffff00'
               : '#ffffff';
  
  return L.divIcon({
    html: `
      <div class="aircraft-icon" style="transform: rotate(${ac.heading}deg)">
        <svg viewBox="0 0 20 20" width="20" height="20">
          <!-- Simple aircraft silhouette SVG pointing up (north) -->
          <path d="M10 1 L13 8 L10 7 L7 8 Z" fill="${color}"/>
          <path d="M7 8 L2 12 L4 12 L10 10 L16 12 L18 12 L13 8 Z" fill="${color}"/>
          <path d="M8 14 L6 17 L7 17 L10 15 L13 17 L14 17 L12 14 Z" fill="${color}"/>
        </svg>
      </div>
    `,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
    className: '',
  });
}
```

---

## Phase 8 — Testing Checklist

Before each milestone, run the following manual tests:

### Map Tests
- [ ] All 7 runway pairs render with correct headings (compare to Google Maps satellite)
- [ ] Runway 28R appears as the northernmost E-W runway
- [ ] Diagonal runway (22L/04R) appears in SW corner
- [ ] Taxiway labels appear at correct positions

### Aircraft Movement Tests
- [ ] Aircraft at 150 kts taxi speed? NO — should be 15 kts. Verify physics.
- [ ] Aircraft on approach follows 3° glide slope (altitude = distance × 300)
- [ ] Aircraft from Dallas approaches from south bearing
- [ ] Aircraft from Newark approaches from east bearing

### Command Tests
- [ ] `UAL123 TAXI 28R VIA ALPHA BRAVO` draws route on map
- [ ] `UAL123 CLEARED FOR TAKEOFF 28R` with occupied runway produces error
- [ ] `UAL123 GO AROUND` at 2 nm final causes immediate climb

### Separation Tests
- [ ] Two aircraft on same taxiway produce amber alert
- [ ] Aircraft on runway blocks takeoff clearance for second aircraft
- [ ] Two approach aircraft < 3 nm separation produce warning

---

## Common Mistakes to Avoid

| Mistake | Correct Approach |
|---|---|
| Using kts as m/s in physics | Convert: 1 kt = 0.514 m/s = 1 nm/hr |
| Using screen pixels for distance | Always use lat/lon and nm for all distance calculations |
| Heading as clockwise from north in radians | Use degrees 0–360 clockwise from magnetic north in all state; convert to radians only for trig |
| Spawning aircraft from wrong direction | Always invert the bearing from ORD to origin to get spawn point |
| Runway 10L/28R as same coordinate | Thresholds are ~2+ nm apart; use the threshold endpoints, not center |
| Pathfinding cutting through runway | Taxiway graph edges must never cross active runways without a crossing node |
