import { describe, it, expect } from 'vitest';
import { Physics } from '../aircraft/Physics';

describe('Physics', () => {
  describe('updateSpeed', () => {
    it('should accelerate towards target speed', () => {
      const newSpeed = Physics.updateSpeed(100, 200, 5, 1);
      expect(newSpeed).toBe(105);
    });

    it('should decelerate towards target speed', () => {
      const newSpeed = Physics.updateSpeed(200, 100, 5, 1);
      expect(newSpeed).toBe(195);
    });

    it('should not overshoot target speed', () => {
      const newSpeed = Physics.updateSpeed(195, 200, 10, 1);
      expect(newSpeed).toBe(200);
    });
  });

  describe('updateAltitude', () => {
    it('should climb towards target altitude', () => {
      const newAltitude = Physics.updateAltitude(1000, 5000, 2000, 60);
      expect(newAltitude).toBe(3000); // 2000 fpm for 60 seconds = 2000 ft
    });

    it('should descend towards target altitude', () => {
      const newAltitude = Physics.updateAltitude(5000, 1000, 1500, 60);
      expect(newAltitude).toBe(3500); // 1500 fpm descent for 60 seconds
    });

    it('should not overshoot target altitude', () => {
      const newAltitude = Physics.updateAltitude(4900, 5000, 2000, 60);
      expect(newAltitude).toBe(5000);
    });
  });

  describe('updateHeading', () => {
    it('should turn towards target heading', () => {
      const newHeading = Physics.updateHeading(0, 90, 3, 10);
      expect(newHeading).toBe(30); // 3 deg/s * 10s = 30 degrees
    });

    it('should take shortest path when crossing 0/360', () => {
      const newHeading = Physics.updateHeading(10, 350, 3, 10);
      expect(newHeading).toBe(350); // Should turn left 20 degrees, not right 340
    });

    it('should normalize heading to 0-360', () => {
      const newHeading = Physics.updateHeading(350, 10, 3, 10);
      expect(newHeading).toBeGreaterThanOrEqual(0);
      expect(newHeading).toBeLessThan(360);
    });
  });

  describe('updatePosition', () => {
    it('should update position based on heading and speed', () => {
      const startPos = { lat: 41.9802, lon: -87.9090 }; // ORD
      const newPos = Physics.updatePosition(
        startPos.lat,
        startPos.lon,
        270, // Heading west
        360, // 360 kts = 6 nm/min
        60   // 60 seconds = 1 minute
      );

      // Should move approximately 6 nm (0.1 degrees) west
      expect(newPos.lat).toBeCloseTo(startPos.lat, 2);
      expect(newPos.lon).toBeLessThan(startPos.lon);
    });
  });
});
