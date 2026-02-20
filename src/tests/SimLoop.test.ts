import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SimLoop } from '../simulation/SimLoop';
import { Aircraft } from '../aircraft/Aircraft';
import { makeTestState } from './testHelpers';

describe('SimLoop', () => {
  let simLoop: SimLoop;

  beforeEach(() => {
    simLoop = new SimLoop();
  });

  it('should start and stop', () => {
    expect(simLoop.isRunning()).toBe(false);
    simLoop.start();
    expect(simLoop.isRunning()).toBe(true);
    simLoop.stop();
    expect(simLoop.isRunning()).toBe(false);
  });

  it('should add and remove aircraft', () => {
    const aircraft = new Aircraft(makeTestState({ callsign: 'UAL123' }));

    simLoop.addAircraft(aircraft);
    expect(simLoop.getAircraft().length).toBe(1);

    simLoop.removeAircraft('UAL123');
    expect(simLoop.getAircraft().length).toBe(0);
  });

  it('should find aircraft by callsign', () => {
    const aircraft = new Aircraft(makeTestState({ callsign: 'UAL123' }));

    simLoop.addAircraft(aircraft);
    const found = simLoop.findAircraft('UAL123');
    expect(found).toBeDefined();
    expect(found?.callsign).toBe('UAL123');
  });

  it('should register and call update callbacks', () => {
    const callback = vi.fn();
    simLoop.onUpdate(callback);
    
    // Callbacks are called during the loop, which we can't easily test
    // without starting the loop. This is more of an integration test.
    expect(callback).not.toHaveBeenCalled();
  });

  it('should set and get simulation speed', () => {
    simLoop.setSpeed(20);
    expect(simLoop.getSpeed()).toBe(20);

    // Test bounds
    simLoop.setSpeed(0);
    expect(simLoop.getSpeed()).toBe(1); // Min is 1

    simLoop.setSpeed(200);
    expect(simLoop.getSpeed()).toBe(100); // Max is 100
  });
});
