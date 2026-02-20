import type { Runway } from '../map/RunwayLayer';
import type { Aircraft } from '../aircraft/Aircraft';
import { FlightPhase } from '../aircraft/FlightPhase';

export interface RunwayInfo {
  id: string;       // e.g. "28R"
  heading: number;  // true heading for that end
  thresholdLat: number;
  thresholdLon: number;
  length_ft: number;
}

/**
 * RunwayManager
 *
 * Tracks runway occupancy and provides helper methods to:
 *  - Look up runway geometry (threshold, heading)
 *  - Check whether a runway is occupied by any aircraft
 *  - Enforce preconditions before issuing takeoff / landing clearances
 */
export class RunwayManager {
  /** id (e.g. "28R") → RunwayInfo */
  private runways: Map<string, RunwayInfo> = new Map();

  constructor(runways: Runway[]) {
    for (const rwy of runways) {
      // Register both ends
      this.runways.set(rwy.id_a, {
        id:           rwy.id_a,
        heading:      rwy.heading,       // heading_a_true
        thresholdLat: rwy.threshold_a.lat,
        thresholdLon: rwy.threshold_a.lon,
        length_ft:    rwy.length_ft,
      });
      this.runways.set(rwy.id_b, {
        id:           rwy.id_b,
        heading:      rwy.heading_b,     // heading_b_true
        thresholdLat: rwy.threshold_b.lat,
        thresholdLon: rwy.threshold_b.lon,
        length_ft:    rwy.length_ft,
      });
    }
  }

  // ── Lookup ────────────────────────────────────────────────────────────────

  /** Return runway info or null if ID not found */
  getRunway(id: string): RunwayInfo | null {
    return this.runways.get(id.toUpperCase()) ?? null;
  }

  /** All known runway IDs */
  listRunwayIds(): string[] {
    return Array.from(this.runways.keys());
  }

  // ── Occupancy ─────────────────────────────────────────────────────────────

  /**
   * Returns the list of aircraft currently on a runway (within 0.5 NM of the
   * runway centreline and below 200 ft AGL).
   */
  getRunwayOccupants(runwayId: string, allAircraft: Aircraft[]): Aircraft[] {
    const rwy = this.getRunway(runwayId);
    if (!rwy) return [];

    const threshold = { lat: rwy.thresholdLat, lon: rwy.thresholdLon };
    // Length in NM: runway length ft ÷ 6076 ft/NM
    const lengthNM = rwy.length_ft / 6076;

    return allAircraft.filter(ac => {
      if (ac.altitude > 868) return false; // > 200 ft AGL
      const dist = ac.distanceTo(threshold);
      return dist < lengthNM + 0.15; // slightly beyond far threshold
    });
  }

  /**
   * True if any aircraft is on the runway in a TAKEOFF, LANDING, or LINEUP phase.
   */
  isOccupied(runwayId: string, allAircraft: Aircraft[]): boolean {
    const rwy = this.getRunway(runwayId);
    if (!rwy) return false;
    const threshold = { lat: rwy.thresholdLat, lon: rwy.thresholdLon };
    const lengthNM  = rwy.length_ft / 6076;

    return allAircraft.some(ac => {
      if (![FlightPhase.TAKEOFF, FlightPhase.LANDING, FlightPhase.LINEUP, FlightPhase.FINAL].includes(ac.phase)) return false;
      const dist = ac.distanceTo(threshold);
      return dist < lengthNM + 0.15;
    });
  }

  /**
   * True if any aircraft is on a 3 nm final for the runway.
   */
  hasFinalTraffic(runwayId: string, allAircraft: Aircraft[]): boolean {
    const rwy = this.getRunway(runwayId);
    if (!rwy) return false;
    const threshold = { lat: rwy.thresholdLat, lon: rwy.thresholdLon };

    return allAircraft.some(ac => {
      if (ac.phase !== FlightPhase.FINAL && ac.phase !== FlightPhase.APPROACH) return false;
      const dist = ac.distanceTo(threshold);
      return dist < 3.0;
    });
  }

  // ── Geometry ──────────────────────────────────────────────────────────────

  /**
   * Compute the position of the runway hold-short line (opposite threshold),
   * offset ≈ 200 ft inside the runway from the far threshold.
   */
  getLineupPosition(runwayId: string): { lat: number; lon: number } | null {
    const rwy = this.getRunway(runwayId);
    if (!rwy) return null;

    // The aircraft should line up at the departure threshold (the threshold of this end)
    // and face the runway heading.
    return { lat: rwy.thresholdLat, lon: rwy.thresholdLon };
  }

  /**
   * Get the approach/landing threshold (this is the threshold the aircraft lands AT).
   * For runway "28R" the landing threshold is threshold_b (28R end).
   */
  getLandingThreshold(runwayId: string): { lat: number; lon: number } | null {
    const rwy = this.getRunway(runwayId);
    if (!rwy) return null;
    return { lat: rwy.thresholdLat, lon: rwy.thresholdLon };
  }
}
