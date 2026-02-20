import { FlightPhase, type AircraftState } from '../aircraft/FlightPhase';

/** Returns a complete AircraftState with sensible defaults for testing */
export function makeTestState(overrides: Partial<AircraftState> = {}): AircraftState {
  return {
    callsign:        'UAL123',
    flightNumber:    'UA123',
    airlineIcao:     'UAL',
    aircraftType:    'B737-800',
    originIcao:      'KORD',
    originCity:      'Chicago, IL',
    destinationIcao: 'KLAX',
    destinationCity: 'Los Angeles, CA',
    position:        { lat: 41.9802, lon: -87.9090 },
    altitude:        668,
    speed:           0,
    heading:         270,
    phase:           FlightPhase.PARKED,
    assignedRunway:  null,
    assignedTaxiRoute: null,
    squawk:          1234,

    targetAltitude:  null,
    targetSpeed:     null,
    targetHeading:   null,
    turnDirection:   'auto',

    taxiWaypoints:              null,
    taxiWaypointIndex:          0,
    pushbackFaceHeading:        null,
    pushbackDistanceTraveled:   0,
    pushbackTargetDistance:     0,
    pushbackWaypoints:          null,
    pushbackWaypointIndex:      0,

    ifrCleared:        false,
    takeoffClearance:  false,
    takeoffHeading:    null,
    initialClimbAlt:   5000,

    approachRunway:    null,
    landingClearance:  false,
    onILS:             false,
    climbTargetAlt:    null,

    departureRequest:  false,
    gateId:            null,
    pendingRunwayCrossing: null,

    holdingFix:        null,
    holdingAngleDeg:   0,
    holdingRadiusNM:   1.5,

    ...overrides,
  };
}
