/**
 * Physics engine for aircraft movement
 * Handles speed, altitude, and heading changes based on aircraft performance specs
 */

export interface AircraftPerformance {
  v1_kts: number;
  vr_kts: number;
  v2_kts: number;
  vref_kts: number;
  cruise_speed_kts: number;
  max_speed_kts: number;
  initial_climb_speed_kts: number;
  approach_speed_kts: number;
  climb_rate_fpm: number;
  descent_rate_fpm: number;
  acceleration_kts_per_sec: number;
  deceleration_kts_per_sec: number;
  taxi_speed_kts: number;
  bank_rate_deg_per_sec: number;
}

export class Physics {
  /**
   * Calculate new speed based on target speed and acceleration
   */
  static updateSpeed(
    currentSpeed: number,
    targetSpeed: number,
    acceleration: number,
    deltaTime: number
  ): number {
    const speedDiff = targetSpeed - currentSpeed;
    const maxChange = acceleration * deltaTime;
    
    if (Math.abs(speedDiff) <= maxChange) {
      return targetSpeed;
    }
    
    return currentSpeed + Math.sign(speedDiff) * maxChange;
  }

  /**
   * Calculate new altitude based on target altitude and climb/descent rate
   */
  static updateAltitude(
    currentAltitude: number,
    targetAltitude: number,
    climbRate: number,
    deltaTime: number
  ): number {
    const altDiff = targetAltitude - currentAltitude;
    const maxChange = (climbRate / 60) * deltaTime; // Convert fpm to fps
    
    if (Math.abs(altDiff) <= maxChange) {
      return targetAltitude;
    }
    
    return currentAltitude + Math.sign(altDiff) * maxChange;
  }

  /**
   * Calculate new heading based on target heading and turn rate
   */
  static updateHeading(
    currentHeading: number,
    targetHeading: number,
    turnRate: number,
    deltaTime: number
  ): number {
    // Normalize headings to 0-360
    currentHeading = (currentHeading + 360) % 360;
    targetHeading = (targetHeading + 360) % 360;
    
    // Calculate shortest turn direction
    let diff = targetHeading - currentHeading;
    if (diff > 180) diff -= 360;
    if (diff < -180) diff += 360;
    
    const maxChange = turnRate * deltaTime;
    
    if (Math.abs(diff) <= maxChange) {
      return targetHeading;
    }
    
    return (currentHeading + Math.sign(diff) * maxChange + 360) % 360;
  }

  /**
   * Calculate new position based on current position, heading, and speed
   * @param lat Current latitude
   * @param lon Current longitude
   * @param heading Heading in degrees
   * @param speed Speed in knots
   * @param deltaTime Time step in seconds
   * @returns New position {lat, lon}
   */
  static updatePosition(
    lat: number,
    lon: number,
    heading: number,
    speed: number,
    deltaTime: number
  ): { lat: number; lon: number } {
    // Convert speed to nautical miles per second
    const distanceNM = (speed / 3600) * deltaTime;
    
    // Convert to radians
    const headingRad = (heading * Math.PI) / 180;
    const latRad = (lat * Math.PI) / 180;
    const lonRad = (lon * Math.PI) / 180;
    
    // Earth's radius in nautical miles
    const R = 3440.065;
    
    // Calculate new position
    const newLatRad = Math.asin(
      Math.sin(latRad) * Math.cos(distanceNM / R) +
      Math.cos(latRad) * Math.sin(distanceNM / R) * Math.cos(headingRad)
    );
    
    const newLonRad = lonRad + Math.atan2(
      Math.sin(headingRad) * Math.sin(distanceNM / R) * Math.cos(latRad),
      Math.cos(distanceNM / R) - Math.sin(latRad) * Math.sin(newLatRad)
    );
    
    return {
      lat: (newLatRad * 180) / Math.PI,
      lon: (newLonRad * 180) / Math.PI
    };
  }
}
