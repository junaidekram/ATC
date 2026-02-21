import type { Aircraft } from '../aircraft/Aircraft';
import { FlightPhase } from '../aircraft/FlightPhase';
import type { Runway } from '../map/RunwayLayer';

// ─────────────────────────────────────────────────────────────────────────────

export type SeparationSeverity = 'warning' | 'critical';

export interface SeparationAlert {
  id: string;              // unique key: sorted callsigns joined
  type: 'ground' | 'approach' | 'vertical' | 'runway_incursion' | 'wake_turbulence';
  severity: SeparationSeverity;
  callsigns: [string, string];
  distanceNM: number;
  message: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

/** Ground conflict distance thresholds (NM) */
const GND_CRITICAL_NM  = 0.025;  // ~150 ft
const GND_WARNING_NM   = 0.060;  // ~360 ft

/** Standard approach separation (NM) */
const APP_WARN_NM      = 3.0;
const APP_CRITICAL_NM  = 1.5;

/** Vertical separation (ft) */
const VERT_SEP_LOW  = 1_000;   // below FL100
const VERT_SEP_HIGH = 2_000;   // at/above FL100
const FL100_FT      = 14_227;  // 10,000 ft AGL (SLC elev ~4,227 ft MSL)

/** Lateral band within which vertical sep is checked (NM) */
const LATERAL_VERT_NM = 5.0;

/** Runway incursion threshold — how close a taxiing aircraft must be
 *  to a runway threshold before we auto-hold it */
export const RUNWAY_HOLD_NM = 0.030;  // ~180 ft

/** KSLC airport reference position */
const ORD_LAT = 40.7884;
const ORD_LON = -111.9779;

// ── Wake turbulence categories ────────────────────────────────────────────────

type WakeCategory = 'SUPER' | 'HEAVY' | 'MEDIUM' | 'SMALL';

/** Map of ICAO aircraft type to wake category */
const WAKE_MAP: Record<string, WakeCategory> = {
  A380: 'SUPER',
  B747: 'HEAVY',
  B777: 'HEAVY',
  B787: 'HEAVY',
  B767: 'HEAVY',
  A350: 'HEAVY',
  A330: 'HEAVY',
  B757: 'MEDIUM',  // FAA specifies B757 special wake
  A320: 'MEDIUM',
  B737: 'MEDIUM',
  B720: 'MEDIUM',
  E175: 'SMALL',
  E145: 'SMALL',
  CRJ7: 'SMALL',
};

/**
 * Returns the required separation in NM for the follower aircraft behind
 * the leader, based on wake turbulence categories (ICAO Doc 4444 / FAA).
 */
function wakeSepNM(leader: WakeCategory, follower: WakeCategory): number {
  if (leader === 'SUPER') {
    if (follower === 'SUPER')  return 6.0;
    if (follower === 'HEAVY')  return 7.0;
    return 8.0;  // MEDIUM / SMALL
  }
  if (leader === 'HEAVY') {
    if (follower === 'HEAVY')  return 4.0;
    return 5.0;   // MEDIUM / SMALL
  }
  return 3.0;     // standard separation (no enhanced wake requirement)
}

function getWakeCategory(aircraftType: string): WakeCategory {
  return WAKE_MAP[aircraftType] ?? 'MEDIUM';
}

// ─────────────────────────────────────────────────────────────────────────────

const GROUND_PHASES = new Set<FlightPhase>([
  FlightPhase.PARKED,
  FlightPhase.PUSHBACK,
  FlightPhase.TAXI_OUT,
  FlightPhase.TAXI_IN,
  FlightPhase.HOLDING_SHORT,
  FlightPhase.LINEUP,
]);

const AIRBORNE_PHASES = new Set<FlightPhase>([
  FlightPhase.TAKEOFF,
  FlightPhase.CLIMBING,
  FlightPhase.CRUISE,
  FlightPhase.DESCENDING,
  FlightPhase.APPROACH,
  FlightPhase.FINAL,
]);

const APPROACH_PHASES = new Set<FlightPhase>([
  FlightPhase.APPROACH,
  FlightPhase.FINAL,
]);

// ─────────────────────────────────────────────────────────────────────────────

export class SeparationMonitor {
  private runways: Runway[];

  constructor(runways: Runway[]) {
    this.runways = runways;
  }

  // ── Main check ─────────────────────────────────────────────────────────────

  /**
   * Evaluate all current aircraft and return active separation alerts.
   * Call on every sim tick. Caller compares to previous results for scoring.
   */
  check(aircraft: Aircraft[]): SeparationAlert[] {
    const alerts: SeparationAlert[] = [];

    for (let i = 0; i < aircraft.length; i++) {
      for (let j = i + 1; j < aircraft.length; j++) {
        const a = aircraft[i];
        const b = aircraft[j];

        const dist = nmBetween(a.position, b.position);

        // ── Ground proximity ──────────────────────────────────────────────
        if (GROUND_PHASES.has(a.phase) && GROUND_PHASES.has(b.phase)) {
          // Parked aircraft at adjacent gates are expected to be close — skip
          if (a.phase === FlightPhase.PARKED && b.phase === FlightPhase.PARKED) continue;
          if (dist < GND_CRITICAL_NM) {
            alerts.push({
              id:         alertId(a, b),
              type:       'ground',
              severity:   'critical',
              callsigns:  [a.callsign, b.callsign],
              distanceNM: dist,
              message:    `GROUND CONFLICT: ${a.callsign} & ${b.callsign} — ${ftFromNm(dist)} ft`,
            });
          } else if (dist < GND_WARNING_NM) {
            alerts.push({
              id:         alertId(a, b),
              type:       'ground',
              severity:   'warning',
              callsigns:  [a.callsign, b.callsign],
              distanceNM: dist,
              message:    `TRAFFIC: ${a.callsign} & ${b.callsign} — ${ftFromNm(dist)} ft apart on ground`,
            });
          }
          continue; // no need to check vertical/approach for ground
        }

        // ── Approach & wake turbulence separation ─────────────────────────
        if (APPROACH_PHASES.has(a.phase) || APPROACH_PHASES.has(b.phase)) {
          if (APPROACH_PHASES.has(a.phase) && APPROACH_PHASES.has(b.phase)) {
            const aRwy = a.getState().approachRunway ?? a.getState().assignedRunway;
            const bRwy = b.getState().approachRunway ?? b.getState().assignedRunway;

            // Determine which is the leading aircraft (closer to threshold = lower dist)
            const aDist = nmBetween(a.position, { lat: ORD_LAT, lon: ORD_LON });
            const bDist = nmBetween(b.position, { lat: ORD_LAT, lon: ORD_LON });
            const [leader, follower] = aDist < bDist ? [a, b] : [b, a];

            const leaderWake   = getWakeCategory(leader.aircraftType);
            const followerWake = getWakeCategory(follower.aircraftType);
            const reqSepNM     = wakeSepNM(leaderWake, followerWake);
            const isWakeReq    = reqSepNM > APP_WARN_NM;

            if (dist < APP_CRITICAL_NM) {
              alerts.push({
                id:         alertId(a, b),
                type:       'approach',
                severity:   'critical',
                callsigns:  [a.callsign, b.callsign],
                distanceNM: dist,
                message:    `SEPARATION: ${a.callsign} & ${b.callsign} — ${dist.toFixed(1)} NM on final (need ${reqSepNM.toFixed(0)} NM)` + (aRwy && bRwy ? ` [${aRwy}/${bRwy}]` : ''),
              });
            } else if (dist < reqSepNM) {
              const isWakeTurb = isWakeReq && dist < reqSepNM;
              alerts.push({
                id:         alertId(a, b),
                type:       isWakeTurb ? 'wake_turbulence' : 'approach',
                severity:   'warning',
                callsigns:  [a.callsign, b.callsign],
                distanceNM: dist,
                message:    isWakeTurb
                  ? `WAKE TURB: ${follower.callsign} behind ${leader.callsign} (${leaderWake}) — ${dist.toFixed(1)} NM (need ${reqSepNM.toFixed(0)} NM)`
                  : `CONVERGING: ${a.callsign} & ${b.callsign} — ${dist.toFixed(1)} NM (${reqSepNM.toFixed(0)} NM req'd)` + (aRwy && bRwy ? ` [${aRwy}/${bRwy}]` : ''),
              });
            }
          }
          continue;
        }

        // ── Vertical separation (airborne) ────────────────────────────────
        if (AIRBORNE_PHASES.has(a.phase) && AIRBORNE_PHASES.has(b.phase)) {
          if (dist > LATERAL_VERT_NM) continue;
          const altDiff    = Math.abs(a.altitude - b.altitude);
          const avgAlt     = (a.altitude + b.altitude) / 2;
          const required   = avgAlt >= FL100_FT ? VERT_SEP_HIGH : VERT_SEP_LOW;
          if (altDiff < required) {
            const sev: SeparationSeverity = altDiff < required * 0.5 ? 'critical' : 'warning';
            alerts.push({
              id:         alertId(a, b),
              type:       'vertical',
              severity:   sev,
              callsigns:  [a.callsign, b.callsign],
              distanceNM: dist,
              message:    `VERT SEP: ${a.callsign} & ${b.callsign} — ${Math.round(altDiff)} ft vertical / ${dist.toFixed(1)} NM lateral`,
            });
          }
        }
      }
    }

    return alerts;
  }

  // ── Runway incursion detection ─────────────────────────────────────────────

  /**
   * Returns callsigns of TAXI_OUT aircraft that have entered a runway's
   * protected zone without clearance (i.e. their assignedRunway ≠ this runway).
   *
   * Caller should transition these to HOLDING_SHORT and set assignedRunway.
   */
  findRunwayIncursions(aircraft: Aircraft[]): Array<{
    callsign: string;
    runwayId: string;
    ac: Aircraft;
  }> {
    const results: Array<{ callsign: string; runwayId: string; ac: Aircraft }> = [];

    for (const ac of aircraft) {
      if (ac.phase !== FlightPhase.TAXI_OUT) continue;
      const wpts = ac.getState().taxiWaypoints;
      if (!wpts || wpts.length === 0) continue; // no route → already stopped

      for (const rwy of this.runways) {
        // Check each end of the runway
        const ends: Array<{ lat: number; lon: number; id: string }> = [
          { lat: rwy.threshold_a.lat, lon: rwy.threshold_a.lon, id: rwy.id_a },
          { lat: rwy.threshold_b.lat, lon: rwy.threshold_b.lon, id: rwy.id_b },
        ];

        for (const end of ends) {
          const dist = nmBetween(ac.position, end);
          if (dist < RUNWAY_HOLD_NM) {
            const assigned = ac.assignedRunway?.toUpperCase();
            // If the aircraft's departure runway matches either end of this runway pair, skip
            if (assigned === rwy.id_a.toUpperCase() || assigned === rwy.id_b.toUpperCase()) {
              continue; // this IS the departure runway — don't stop
            }
            // Check pendingRunwayCrossing to avoid re-triggering after clearance
            const pending = ac.getState().pendingRunwayCrossing;
            if (pending === end.id) continue; // already pending, waiting for clearance
            results.push({ callsign: ac.callsign, runwayId: end.id, ac });
          }
        }
      }
    }

    return results;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function nmBetween(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R    = 3440.065;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLon = (b.lon - a.lon) * Math.PI / 180;
  const sa   = Math.sin(dLat / 2) ** 2 +
               Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) *
               Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(sa), Math.sqrt(1 - sa));
}

function ftFromNm(nm: number): number {
  return Math.round(nm * 6076.12);
}

function alertId(a: Aircraft, b: Aircraft): string {
  return [a.callsign, b.callsign].sort().join('|');
}
