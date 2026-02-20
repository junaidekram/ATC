import { describe, it, expect } from 'vitest';
import { Aircraft } from '../aircraft/Aircraft';
import { FlightPhase } from '../aircraft/FlightPhase';
import { makeTestState } from './testHelpers';

describe('Aircraft', () => {
  it('should create an aircraft with initial state', () => {
    const aircraft = new Aircraft(makeTestState({
      callsign: 'UAL123',
      aircraftType: 'B737-800',
      phase: FlightPhase.PARKED,
    }));

    expect(aircraft.callsign).toBe('UAL123');
    expect(aircraft.aircraftType).toBe('B737-800');
    expect(aircraft.phase).toBe(FlightPhase.PARKED);
  });

  it('should calculate distance between two positions', () => {
    const aircraft = new Aircraft(makeTestState({
      position: { lat: 41.9802, lon: -87.9090 },
    }));

    // Distance to LAX (approximately 1500 nm)
    const distance = aircraft.distanceTo({ lat: 33.9425, lon: -118.4081 });
    expect(distance).toBeGreaterThan(1400);
    expect(distance).toBeLessThan(1600);
  });

  it('should update altitude', () => {
    const aircraft = new Aircraft(makeTestState({
      altitude: 1000,
      speed: 250,
      heading: 270,
      phase: FlightPhase.CLIMBING,
    }));

    aircraft.setAltitude(5000);
    expect(aircraft.altitude).toBe(5000);
  });

  it('should normalize heading to 0-360', () => {
    const aircraft = new Aircraft(makeTestState({ heading: 0 }));

    aircraft.setHeading(370);
    expect(aircraft.heading).toBe(10);

    aircraft.setHeading(-10);
    expect(aircraft.heading).toBe(350);
  });
});
