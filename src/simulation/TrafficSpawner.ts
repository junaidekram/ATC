import type { Aircraft } from '../aircraft/Aircraft';
import { Aircraft as AircraftClass } from '../aircraft/Aircraft';
import { FlightPhase } from '../aircraft/FlightPhase';
import type { DataLoader } from '../data/DataLoader';
import type { SimLoop } from '../simulation/SimLoop';

/**
 * TrafficSpawner — Phase 5
 *
 * Periodically spawns new inbound and outbound aircraft to keep the
 * simulation busy.  New arrivals appear at the 50 NM boundary on one
 * of six predefined STAR entry bearings; new departures are placed at
 * any available gate.
 *
 * onSpawn callback is called with the new Aircraft so the caller
 * (ATCSimulator) can add it to the map and log a comms message.
 */

// SLC centre
const ORD_LAT = 40.7884;
const ORD_LON = -111.9779;
// Earth radius in NM
const R_NM = 3440.065;

/** Degrees to radians */
const d2r = (d: number) => d * Math.PI / 180;

/** Point at distance NM from ORD on bearing deg */
function pointOnBearing(bearingDeg: number, distNM: number): { lat: number; lon: number } {
  const angDist = distNM / R_NM;
  const lat1 = d2r(ORD_LAT);
  const lon1 = d2r(ORD_LON);
  const brng  = d2r(bearingDeg);
  const lat2  = Math.asin(Math.sin(lat1) * Math.cos(angDist) +
                          Math.cos(lat1) * Math.sin(angDist) * Math.cos(brng));
  const lon2  = lon1 + Math.atan2(
    Math.sin(brng) * Math.sin(angDist) * Math.cos(lat1),
    Math.cos(angDist) - Math.sin(lat1) * Math.sin(lat2));
  return { lat: lat2 * 180 / Math.PI, lon: lon2 * 180 / Math.PI };
}

// The six STAR entry bearings (from SLC outward = where aircraft come FROM)
const ENTRY_BEARINGS = [80, 105, 190, 220, 285, 340];

// Airlines and aircraft for random spawning
const SPAWN_POOL = [
  { airline: 'DAL', type: 'A320', destIcao: 'KSLC', origCity: 'Denver, CO',      origIcao: 'KDEN'  },
  { airline: 'UAL', type: 'B737', destIcao: 'KSLC', origCity: 'Chicago, IL',     origIcao: 'KORD'  },
  { airline: 'SWA', type: 'B737', destIcao: 'KSLC', origCity: 'Las Vegas, NV',   origIcao: 'KLAS'  },
  { airline: 'ASA', type: 'B737', destIcao: 'KSLC', origCity: 'Seattle, WA',     origIcao: 'KSEA'  },
  { airline: 'DAL', type: 'B757', destIcao: 'KSLC', origCity: 'Los Angeles, CA', origIcao: 'KLAX'  },
  { airline: 'SWA', type: 'B737', destIcao: 'KSLC', origCity: 'Phoenix, AZ',     origIcao: 'KPHX'  },
  { airline: 'UAL', type: 'B787', destIcao: 'KSLC', origCity: 'San Francisco',   origIcao: 'KSFO'  },
  { airline: 'DAL', type: 'B737', destIcao: 'KSLC', origCity: 'Atlanta, GA',     origIcao: 'KATL'  },
];

// Known ORD gates to use for departures — use real gate data from DataLoader
// (resolved at spawn time via this.dataLoader.getGates())

const DEPARTURE_AIRLINES = [
  { airline: 'DAL', type: 'A320', origIcao: 'KSLC', origCity: 'Salt Lake City, UT', destIcao: 'KDEN', destCity: 'Denver, CO'       },
  { airline: 'SWA', type: 'B737', origIcao: 'KSLC', origCity: 'Salt Lake City, UT', destIcao: 'KLAS', destCity: 'Las Vegas, NV'    },
  { airline: 'ASA', type: 'B737', origIcao: 'KSLC', origCity: 'Salt Lake City, UT', destIcao: 'KSEA', destCity: 'Seattle, WA'      },
  { airline: 'DAL', type: 'B757', origIcao: 'KSLC', origCity: 'Salt Lake City, UT', destIcao: 'KLAX', destCity: 'Los Angeles, CA'  },
  { airline: 'UAL', type: 'B787', origIcao: 'KSLC', origCity: 'Salt Lake City, UT', destIcao: 'KEWR', destCity: 'Newark, NJ'        },
  { airline: 'SWA', type: 'B737', origIcao: 'KSLC', origCity: 'Salt Lake City, UT', destIcao: 'KPHX', destCity: 'Phoenix, AZ'      },
];

// Squawk counter — incrementing from 4600
let squawkCounter = 4600;
// Flight number suffix — incrementing
let flightSuffix = 2000;

export class TrafficSpawner {
  private dataLoader: DataLoader;
  private simLoop: SimLoop;
  private onSpawn: (ac: Aircraft) => void;
  /** Sim-tick counter */
  private tick_ = 0;

  /** How many real-ticks between arrival spawns */
  private readonly ARRIVAL_INTERVAL = 1200;   // ~120 real-sec at 10× = every 2 real-min
  /** How many real-ticks between departure spawns */
  private readonly DEPARTURE_INTERVAL = 1800; // ~3 real-min
  /** Maximum simultaneous aircraft to allow before pausing spawns */
  private readonly MAX_AIRCRAFT = 30;
  /** Minimum aircraft before forcing a spawn */
  private readonly MIN_AIRCRAFT = 8;

  private entryBearingIdx = 0;  // rotates through ENTRY_BEARINGS

  constructor(dataLoader: DataLoader, simLoop: SimLoop, onSpawn: (ac: Aircraft) => void) {
    this.dataLoader = dataLoader;
    this.simLoop    = simLoop;
    this.onSpawn    = onSpawn;
  }

  /** Called on every sim update tick from ATCSimulator */
  tick(aircraft: Aircraft[]): void {
    this.tick_++;
    const count = aircraft.length;

    const needsArrival  = count < this.MIN_AIRCRAFT || this.tick_ % this.ARRIVAL_INTERVAL === 0;
    const needsDeparture = this.tick_ % this.DEPARTURE_INTERVAL === 0;

    if (count >= this.MAX_AIRCRAFT) return;

    if (needsArrival) this.spawnArrival();

    if (needsDeparture && count < this.MAX_AIRCRAFT - 2) {
      this.spawnDeparture(aircraft);
    }
  }

  private spawnArrival(): void {
    // Pick entry bearing in round-robin order
    const bearing = ENTRY_BEARINGS[this.entryBearingIdx % ENTRY_BEARINGS.length];
    this.entryBearingIdx++;

    const entry = pointOnBearing(bearing, 48); // 48 NM from ORD
    const slot  = SPAWN_POOL[this.tick_ % SPAWN_POOL.length];
    // Inbound heading = bearing from entry point toward ORD = bearing + 180
    const inboundHdg = (bearing + 180) % 360;

    const callsign = `${slot.airline}${flightSuffix++}`;
    const squawk   = squawkCounter++;

    const ac = new AircraftClass({
      callsign,
      flightNumber:    callsign,
      airlineIcao:     slot.airline,
      aircraftType:    slot.type,
      originIcao:      slot.origIcao,
      originCity:      slot.origCity,
      destinationIcao: slot.destIcao,
      destinationCity: 'Chicago, IL',
      position:        entry,
      altitude:        12000,
      speed:           240,
      heading:         inboundHdg,
      phase:           FlightPhase.APPROACH,
      assignedRunway:  null,
      assignedTaxiRoute: null,
      squawk,

      targetAltitude:  12000,
      targetSpeed:     240,
      targetHeading:   inboundHdg,
      turnDirection:   'auto',

      taxiWaypoints:           null,
      taxiWaypointIndex:       0,
      pushbackFaceHeading:     null,
      pushbackDistanceTraveled:0,
      pushbackTargetDistance:  0,
      pushbackWaypoints:       null,
      pushbackWaypointIndex:   0,

      ifrCleared:       false,
      takeoffClearance: false,
      takeoffHeading:   null,
      initialClimbAlt:  5000,

      approachRunway:   null,
      landingClearance: false,
      onILS:            false,
      climbTargetAlt:   null,

      departureRequest: false,
      gateId:           null,
      pendingRunwayCrossing: null,

      holdingFix:        null,
      holdingAngleDeg:   0,
      holdingRadiusNM:   1.5,
    });

    this.simLoop.addAircraft(ac);
    this.onSpawn(ac);
  }

  private spawnDeparture(existing: Aircraft[]): void {
    // Get real gate data from DataLoader
    const allGates = this.dataLoader.getGates();

    // Filter to a spawnable subset: gates with parking coordinates, spread across terminals
    // Pick roughly every-3rd gate per terminal to keep good spatial spread
    const spawnableGates = allGates.filter((g, idx) => idx % 3 === 0 && (g.parking_lat ?? g.lat) !== 0);

    // Find a gate that's not currently occupied
    const occupiedGates = new Set(existing.map(a => a.getState().gateId).filter(Boolean));
    const freeGate = spawnableGates.find(g => !occupiedGates.has(g.id));
    if (!freeGate) return;

    const slot    = DEPARTURE_AIRLINES[this.tick_ % DEPARTURE_AIRLINES.length];
    const callsign = `${slot.airline}${flightSuffix++}`;
    const squawk   = squawkCounter++;

    const spawnLat = freeGate.parking_lat ?? freeGate.lat;
    const spawnLon = freeGate.parking_lon ?? freeGate.lon;
    const noseHdg  = freeGate.nose_heading ?? 90;

    const ac = new AircraftClass({
      callsign,
      flightNumber:    callsign,
      airlineIcao:     slot.airline,
      aircraftType:    slot.type,
      originIcao:      slot.origIcao,
      originCity:      slot.origCity,
      destinationIcao: slot.destIcao,
      destinationCity: slot.destCity,
      position:        { lat: spawnLat, lon: spawnLon },
      altitude:        668,
      speed:           0,
      heading:         noseHdg,
      phase:           FlightPhase.PARKED,
      assignedRunway:  null,
      assignedTaxiRoute: null,
      squawk,

      targetAltitude:  null,
      targetSpeed:     null,
      targetHeading:   null,
      turnDirection:   'auto',

      taxiWaypoints:           null,
      taxiWaypointIndex:       0,
      pushbackFaceHeading:     null,
      pushbackDistanceTraveled:0,
      pushbackTargetDistance:  0,
      pushbackWaypoints:       null,
      pushbackWaypointIndex:   0,

      ifrCleared:       false,
      takeoffClearance: false,
      takeoffHeading:   null,
      initialClimbAlt:  5000,

      approachRunway:   null,
      landingClearance: false,
      onILS:            false,
      climbTargetAlt:   null,

      departureRequest: false,
      gateId:           freeGate.id,
      pendingRunwayCrossing: null,

      holdingFix:        null,
      holdingAngleDeg:   0,
      holdingRadiusNM:   1.5,
    });

    this.simLoop.addAircraft(ac);
    this.onSpawn(ac);

    // Schedule pushback request after a short delay
    setTimeout(() => {
      const still = this.simLoop.findAircraft(callsign);
      if (still && still.phase === FlightPhase.PARKED) {
        still.requestDeparture();
        // Comms message handled by onSpawn callers via the existing mechanism
      }
    }, 8_000 + (this.tick_ % 10) * 1_000);
  }
}
