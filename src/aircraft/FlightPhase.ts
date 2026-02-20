/**
 * Flight phase enumeration
 * Represents all possible states of an aircraft in the simulation
 */
export enum FlightPhase {
  PARKED = 'PARKED',
  /** Path computed, waiting for controller to confirm on the map before moving */
  PUSHBACK_PENDING = 'PUSHBACK_PENDING',
  PUSHBACK = 'PUSHBACK',
  TAXI_OUT = 'TAXI_OUT',
  HOLDING_SHORT = 'HOLDING_SHORT',
  LINEUP = 'LINEUP',
  TAKEOFF = 'TAKEOFF',
  CLIMBING = 'CLIMBING',
  CRUISE = 'CRUISE',
  DESCENDING = 'DESCENDING',
  APPROACH = 'APPROACH',
  FINAL = 'FINAL',
  LANDING = 'LANDING',
  TAXI_IN = 'TAXI_IN',
  ARRIVED = 'ARRIVED',
  /** Holding pattern — aircraft orbits a fix waiting for further clearance */
  HOLDING = 'HOLDING',
}

export type Position = {
  lat: number;
  lon: number;
};

/** A single waypoint along a taxi route */
export type TaxiWaypoint = {
  lat: number;
  lon: number;
  nodeId: string;
};

export type AircraftState = {
  // ── Identity ──────────────────────────────────────────────────────────────
  callsign: string;
  flightNumber: string;
  airlineIcao: string;
  aircraftType: string;
  originIcao: string;
  originCity: string;
  destinationIcao: string;
  destinationCity: string;

  // ── Kinematics ────────────────────────────────────────────────────────────
  position: Position;
  altitude: number;        // feet MSL
  speed: number;           // knots
  heading: number;         // degrees true

  // ── Targets (set by ATC commands) ─────────────────────────────────────────
  targetAltitude: number | null;   // feet — assigned by CLIMB/DESCEND cmd
  targetSpeed: number | null;      // knots — assigned by speed cmd
  targetHeading: number | null;    // degrees — assigned by heading cmd
  turnDirection: 'left' | 'right' | 'auto'; // forced turn direction or shortest

  // ── Ground operations ─────────────────────────────────────────────────────
  taxiWaypoints: TaxiWaypoint[] | null;    // ordered node list for current taxi route
  taxiWaypointIndex: number;               // index of the next waypoint to head for
  pushbackFaceHeading: number | null;      // heading to face after pushback complete
  pushbackDistanceTraveled: number;        // nautical miles traveled during pushback
  pushbackTargetDistance: number;          // total NM to push back before stopping
  /** Ordered waypoints the aircraft backs through (tail-first, 2-segment path from gate) */
  pushbackWaypoints: TaxiWaypoint[] | null;
  /** Index of the next pushback waypoint the tail is heading toward */
  pushbackWaypointIndex: number;

  // ── Clearances ────────────────────────────────────────────────────────────
  ifrCleared: boolean;
  takeoffClearance: boolean;
  takeoffHeading: number | null;     // assigned departure heading (null = SID/runway hdg)
  initialClimbAlt: number;           // feet — initial SID altitude (default 5000 ft)

  approachRunway: string | null;     // runway assigned for approach
  landingClearance: boolean;
  onILS: boolean;                    // aircraft has intercepted the ILS localizer

  // ── Airborne performance state ────────────────────────────────────────────
  climbTargetAlt: number | null;     // intermediate climb ceiling (FL restriction)

  // ── Meta ──────────────────────────────────────────────────────────────────
  phase: FlightPhase;
  assignedRunway: string | null;
  assignedTaxiRoute: string[] | null;  // human-readable taxiway list (e.g. ["A","B"])

  /** True when the crew have pressed "Request Departure" from the gate */
  departureRequest: boolean;
  squawk: number;

  /** Gate ID this aircraft was parked at (e.g. "B12") */
  gateId: string | null;

  // ── Holding pattern ───────────────────────────────────────────────────────
  /** Centre fix of the holding pattern (set when HOLD command issued) */
  holdingFix: Position | null;
  /** Current angular position in the orbit (degrees, 0 = North) */
  holdingAngleDeg: number;
  /** Orbit radius in NM (default 1.5) */
  holdingRadiusNM: number;

  /**
   * If the aircraft auto-stopped at a runway hold-short line during taxi,
   * this stored the runway it needs crossing/lineup clearance for.
   * Remains set until the player issues CROSS_RUNWAY or LINE_UP_AND_WAIT.
   */
  pendingRunwayCrossing: string | null;
};
