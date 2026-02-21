import { FlightPhase, type AircraftState, type Position, type TaxiWaypoint } from './FlightPhase';
import { Physics } from './Physics';

// SLC field elevation (ft MSL)
const ORD_ELEVATION = 4227;
// Glide slope angle (degrees)
const GLIDE_SLOPE_DEG = 3;
// Distance threshold to treat a waypoint as "reached" (NM)
const WAYPOINT_THRESHOLD_NM = 0.005; // ~30 ft — tight so planes don't cut corners
// Default pushback distance (NM) ~250 ft
const DEFAULT_PUSHBACK_NM = 0.042;
// Ground separation — planes must never get closer than 25 ft (centre-to-centre)
const SAFE_DIST_NM  = 0.00413; // ~25 ft  — hard stop
const SLOW_DIST_NM  = 0.0165;  // ~100 ft — begin deceleration

/**
 * Aircraft — Stage 3
 *
 * Implements full ATC-directed behaviour:
 *  • Node-by-node taxi following along a pre-computed waypoint list.
 *  • Correct pushback with face-heading logic.
 *  • Takeoff roll using VR from aircraft specs with assigned departure heading.
 *  • ILS approach with glide-slope descent, auto-land, and runway roll-out.
 *  • Assigned target altitude / speed / heading for climb, descent, and vectors.
 *  • HOLD SHORT — aircraft stops and waits.
 *  • LINE UP — aircraft taxis onto runway and waits for takeoff clearance.
 */
export class Aircraft {
  private state: AircraftState;

  // ── Performance defaults (overridden by CommandHandler from aircraft_specs) ──
  vrKts        = 145;
  v2Kts        = 150;
  vrefKts      = 140;
  accelKtps    = 1.2;  // take-off / cruise acceleration (kts per sim-second)
  decelKtps    = 2.5;  // landing deceleration
  /** Normal / maximum taxi speed (kts) — must stay in 17-28 range */
  taxiKts      = 22;
  readonly MIN_TAXI_KTS = 17;
  readonly MAX_TAXI_KTS = 28;
  climbFpm     = 2500;
  descentFpm   = 1800;
  /** Ground turning rate (deg/sim-second). 12°/s lets a plane complete a
   *  90° turn in 7.5 s while crawling at 5 kts (~63 ft turn radius). */
  bankRateDps  = 12.0;
  airBankDps   = 3.0;  // heading change rate in air

  constructor(initialState: AircraftState) {
    this.state = { ...initialState };
  }

  // ── Getters ───────────────────────────────────────────────────────────────

  get callsign(): string     { return this.state.callsign; }
  get position(): Position   { return { ...this.state.position }; }
  get altitude(): number     { return this.state.altitude; }
  get speed(): number        { return this.state.speed; }
  get heading(): number      { return this.state.heading; }
  get phase(): FlightPhase   { return this.state.phase; }
  get aircraftType(): string { return this.state.aircraftType; }
  get assignedRunway(): string | null { return this.state.assignedRunway; }

  getState(): Readonly<AircraftState> { return { ...this.state }; }

  // ── Setters ───────────────────────────────────────────────────────────────

  setPosition(lat: number, lon: number): void { this.state.position = { lat, lon }; }
  setAltitude(alt: number): void              { this.state.altitude = alt; }
  setSpeed(spd: number): void                 { this.state.speed = spd; }
  setHeading(hdg: number): void               { this.state.heading = (hdg + 360) % 360; }
  setPhase(phase: FlightPhase): void          { this.state.phase = phase; }
  setAssignedRunway(rwy: string | null): void { this.state.assignedRunway = rwy; }
  setAssignedTaxiRoute(route: string[] | null): void { this.state.assignedTaxiRoute = route; }

  /** Replace the full taxi waypoint list and reset the index to 0 */
  setTaxiWaypoints(wpts: TaxiWaypoint[]): void {
    this.state.taxiWaypoints      = wpts;
    this.state.taxiWaypointIndex  = 0;
  }

  /** Update the pushback waypoint path (used when the controller adjusts it in the map UI) */
  updatePushbackPath(wpts: TaxiWaypoint[]): void {
    this.state.pushbackWaypoints     = wpts;
    this.state.pushbackWaypointIndex = 0;
  }

  setTargetAltitude(alt: number | null): void { this.state.targetAltitude = alt; }
  setTargetSpeed(spd: number | null): void    { this.state.targetSpeed = spd; }
  setTargetHeading(hdg: number | null, dir: 'left' | 'right' | 'auto' = 'auto'): void {
    this.state.targetHeading  = hdg;
    this.state.turnDirection  = dir;
  }

  setTakeoffClearance(hdg: number | null, climbAlt: number): void {
    this.state.takeoffClearance = true;
    this.state.takeoffHeading   = hdg;
    this.state.initialClimbAlt  = climbAlt;
  }

  cancelTakeoffClearance(): void {
    this.state.takeoffClearance = false;
  }

  setApproachRunway(rwy: string): void   { this.state.approachRunway = rwy; }
  setLandingClearance(v: boolean): void  { this.state.landingClearance = v; }
  setOnILS(v: boolean): void             { this.state.onILS = v; }
  setIfrCleared(v: boolean): void        { this.state.ifrCleared = v; }

  /** Crew requests departure — shows in the ground-control requests panel */
  requestDeparture(): void { this.state.departureRequest = true; }
  get departureRequest(): boolean { return this.state.departureRequest; }
  clearDepartureRequest(): void   { this.state.departureRequest = false; }

  /** Set which runway the aircraft is automatically holding short of (for crossing) */
  setPendingRunwayCrossing(rwy: string | null): void { this.state.pendingRunwayCrossing = rwy; }
  get pendingRunwayCrossing(): string | null { return this.state.pendingRunwayCrossing; }

  setPushback(
    faceHeading: number | null,
    targetDistNM?: number,
    waypoints?: import('./FlightPhase').TaxiWaypoint[],
  ): void {
    this.state.pushbackFaceHeading       = faceHeading;
    this.state.pushbackDistanceTraveled  = 0;
    this.state.pushbackTargetDistance    = targetDistNM ?? DEFAULT_PUSHBACK_NM;
    this.state.pushbackWaypoints         = waypoints?.length ? waypoints : null;
    this.state.pushbackWaypointIndex     = 0;
    // Stay pending until the controller confirms the path on the map.
    this.state.phase = FlightPhase.PUSHBACK_PENDING;
  }

  /** Controller confirmed the pushback path on the map — begin moving. */
  confirmPushback(): void {
    if (this.state.phase === FlightPhase.PUSHBACK_PENDING) {
      this.state.phase = FlightPhase.PUSHBACK;
    }
  }

  /** Controller cancelled the pushback path — revert to parked. */
  cancelPushback(): void {
    this.state.pushbackWaypoints     = null;
    this.state.pushbackWaypointIndex = 0;
    this.state.pushbackDistanceTraveled = 0;
    this.state.phase = FlightPhase.PARKED;
  }

  /**
   * Enter a holding pattern orbiting the aircraft's current position.
   * The aircraft will maintain current altitude and circle until `resumeNav()`.
   */
  enterHolding(): void {
    const p = this.state;
    p.holdingFix      = { lat: p.position.lat, lon: p.position.lon };
    p.holdingAngleDeg = 0;   // start at North of the fix
    p.holdingRadiusNM = 1.5;
    p.phase           = FlightPhase.HOLDING;
  }

  /**
   * Exit the holding pattern and resume the previous flight phase.
   * After this call the player should re-issue a heading/altitude command.
   */
  resumeNav(): void {
    const p = this.state;
    if (p.phase !== FlightPhase.HOLDING) return;
    p.holdingFix = null;
    // Return to cruise/descend depending on flight context
    p.phase = FlightPhase.DESCENDING;
    p.targetAltitude = null;  // player must issue DESCEND command next
  }

  // ── Main update ───────────────────────────────────────────────────────────

  /**
   * Update aircraft state for one simulation tick.
   * @param deltaTime Simulation seconds this tick.
   * @param allAircraft All aircraft in the sim (used for collision detection on ground).
   */
  update(deltaTime: number, allAircraft?: Aircraft[]): void {
    this._allAircraft = allAircraft;
    this._update(deltaTime);
  }

  private _allAircraft?: Aircraft[];

  private _update(deltaTime: number): void {
    const p = this.state;

    switch (p.phase) {

      // ── PARKED ────────────────────────────────────────────────────────────
      case FlightPhase.PARKED:
        p.speed    = 0;
        p.altitude = ORD_ELEVATION;
        break;
      // ── PUSHBACK_PENDING ────────────────────────────────────────
      // Path has been computed and sent to the map UI for the controller to
      // review and adjust.  The aircraft stays stationary until confirmed.
      case FlightPhase.PUSHBACK_PENDING:
        p.speed    = 0;
        p.altitude = ORD_ELEVATION;
        break;
      // ── PUSHBACK ──────────────────────────────────────────────────────────
      case FlightPhase.PUSHBACK: {
        const pushSpeed = 4; // kts
        const TURN_LOOKAHEAD_NM = 0.012; // ~72 ft — start turning this close to turn point
        p.altitude = ORD_ELEVATION;

        if (p.pushbackWaypoints && p.pushbackWaypoints.length > 0) {
          // ── Waypoint-following pushback with smooth curve transitions ──
          const wpIdx = p.pushbackWaypointIndex;
          const target = p.pushbackWaypoints[wpIdx];
          const distToTarget = this.nmDistanceTo(p.position, { lat: target.lat, lon: target.lon });

          // ── Compute desired nose heading ──
          // Tail faces toward current target; nose points away.
          const bearingToTarget = this.bearingTo(p.position, { lat: target.lat, lon: target.lon });
          let desiredNoseHdg = (bearingToTarget + 180) % 360;

          // ── Smooth turn blending (curved transition to next segment) ──
          // If we have a next waypoint and are close to the turn point,
          // gradually blend toward the bearing of the NEXT segment.
          if (wpIdx < p.pushbackWaypoints.length - 1 && distToTarget < TURN_LOOKAHEAD_NM) {
            const nextWp = p.pushbackWaypoints[wpIdx + 1];
            const bearingToNext = this.bearingTo(p.position, { lat: nextWp.lat, lon: nextWp.lon });
            const desiredNoseHdgNext = (bearingToNext + 180) % 360;

            // Blend amount: 0 at lookahead distance, 1 at actual waypoint
            const blendFactor = 1.0 - (distToTarget / TURN_LOOKAHEAD_NM);
            desiredNoseHdg = this.interpolateHeading(desiredNoseHdg, desiredNoseHdgNext, blendFactor);
          }

          // ── Apply cross-track correction ──
          if (wpIdx > 0) {
            const prevWp = p.pushbackWaypoints[wpIdx - 1];
            const xte = this.crossTrackError(
              { lat: prevWp.lat, lon: prevWp.lon },
              p.position,
              { lat: target.lat, lon: target.lon },
            );
            const corrDeg = Math.atan2(xte, Math.max(distToTarget, WAYPOINT_THRESHOLD_NM)) * (180 / Math.PI);
            desiredNoseHdg = (desiredNoseHdg + Math.max(-45, Math.min(45, corrDeg * 2.5)) + 360) % 360;
          }

          // ── Smoothly turn the nose and move ──
          p.heading = this.turnToward(p.heading, desiredNoseHdg, this.bankRateDps, deltaTime, 'auto');
          p.position = Physics.updatePosition(
            p.position.lat, p.position.lon,
            (p.heading + 180) % 360, pushSpeed, deltaTime,
          );
          p.speed = pushSpeed;

          // ── Check if reached current waypoint ──
          if (distToTarget < WAYPOINT_THRESHOLD_NM) {
            p.pushbackWaypointIndex++;

            // ── Check if all waypoints reached ──
            if (p.pushbackWaypointIndex >= p.pushbackWaypoints.length) {
              // Pushback complete — align nose and stop.
              if (p.pushbackFaceHeading !== null) p.heading = p.pushbackFaceHeading;
              p.speed = 0;
              p.phase = FlightPhase.TAXI_OUT;
            }
          }
        } else {
          // ── Fallback: legacy straight-line reverse ───────────────────────
          const reverseHdg = (p.heading + 180) % 360;
          p.position = Physics.updatePosition(p.position.lat, p.position.lon, reverseHdg, pushSpeed, deltaTime);
          p.speed = pushSpeed;
          p.pushbackDistanceTraveled += (pushSpeed / 3600) * deltaTime;
          if (p.pushbackDistanceTraveled >= p.pushbackTargetDistance) {
            if (p.pushbackFaceHeading !== null) p.heading = p.pushbackFaceHeading;
            p.speed = 0;
            p.phase = FlightPhase.TAXI_OUT;
          }
        }
        break;
      }

      // ── TAXI_OUT / TAXI_IN ────────────────────────────────────────────────
      case FlightPhase.TAXI_OUT:
      case FlightPhase.TAXI_IN:
        this.updateTaxi(deltaTime);
        break;

      // ── HOLDING_SHORT ─────────────────────────────────────────────────────
      case FlightPhase.HOLDING_SHORT:
        p.speed    = 0;
        p.altitude = ORD_ELEVATION;
        break;

      // ── LINEUP ────────────────────────────────────────────────────────────
      case FlightPhase.LINEUP:
        // Taxi onto runway end, then stop and wait for takeoff clearance.
        this.updateTaxi(deltaTime);
        if (p.speed === 0 && p.taxiWaypointIndex >= (p.taxiWaypoints?.length ?? 0)) {
          // Already at lineup position — nothing more to do until TAKEOFF clearance
          if (p.takeoffClearance) {
            p.phase = FlightPhase.TAKEOFF;
          }
        }
        break;

      // ── TAKEOFF ───────────────────────────────────────────────────────────
      case FlightPhase.TAKEOFF: {
        // Accelerate along runway heading
        p.speed = Physics.updateSpeed(p.speed, 200, this.accelKtps, deltaTime);
        p.position = Physics.updatePosition(p.position.lat, p.position.lon, p.heading, p.speed, deltaTime);

        // Rotate at VR
        if (p.speed >= this.vrKts) {
          const climbTarget = (p.initialClimbAlt > 0 ? p.initialClimbAlt : 5000) + ORD_ELEVATION;
          p.altitude = Physics.updateAltitude(p.altitude, climbTarget, this.climbFpm, deltaTime);

          if (p.altitude > ORD_ELEVATION + 200) {
            p.phase = FlightPhase.CLIMBING;
            if (p.takeoffHeading !== null) {
              p.targetHeading = p.takeoffHeading;
              p.turnDirection = 'auto';
            }
            p.targetAltitude = climbTarget;
          }
        }
        break;
      }

      // ── CLIMBING ──────────────────────────────────────────────────────────
      case FlightPhase.CLIMBING: {
        const ceiling     = p.targetAltitude ?? 35000;
        p.altitude        = Physics.updateAltitude(p.altitude, ceiling, this.climbFpm, deltaTime);
        const climbSpd    = p.altitude < 10_000 ? Math.min(250, p.targetSpeed ?? 250) : (p.targetSpeed ?? 290);
        p.speed           = Physics.updateSpeed(p.speed, climbSpd, this.accelKtps, deltaTime);

        if (p.targetHeading !== null) {
          p.heading = this.turnToward(p.heading, p.targetHeading, this.airBankDps, deltaTime, p.turnDirection);
        }
        p.position = Physics.updatePosition(p.position.lat, p.position.lon, p.heading, p.speed, deltaTime);

        if (Math.abs(p.altitude - ceiling) < 50) p.phase = FlightPhase.CRUISE;
        break;
      }

      // ── CRUISE ────────────────────────────────────────────────────────────
      case FlightPhase.CRUISE: {
        if (p.targetHeading !== null) {
          p.heading = this.turnToward(p.heading, p.targetHeading, this.airBankDps, deltaTime, p.turnDirection);
        }
        if (p.targetSpeed !== null) {
          p.speed = Physics.updateSpeed(p.speed, p.targetSpeed, this.accelKtps, deltaTime);
        }
        if (p.targetAltitude !== null) {
          const diff = p.targetAltitude - p.altitude;
          if (diff < -200)      p.phase = FlightPhase.DESCENDING;
          else if (diff > 200)  p.phase = FlightPhase.CLIMBING;
        }
        p.position = Physics.updatePosition(p.position.lat, p.position.lon, p.heading, p.speed, deltaTime);
        break;
      }

      // ── DESCENDING ────────────────────────────────────────────────────────
      case FlightPhase.DESCENDING: {
        const floor      = p.targetAltitude ?? ORD_ELEVATION;
        p.altitude       = Physics.updateAltitude(p.altitude, floor, this.descentFpm, deltaTime);
        const descentSpd = p.altitude < 10_000 ? Math.min(250, p.targetSpeed ?? 250) : (p.targetSpeed ?? 290);
        p.speed          = Physics.updateSpeed(p.speed, descentSpd, 1.5, deltaTime);

        if (p.targetHeading !== null) {
          p.heading = this.turnToward(p.heading, p.targetHeading, this.airBankDps, deltaTime, p.turnDirection);
        }
        p.position = Physics.updatePosition(p.position.lat, p.position.lon, p.heading, p.speed, deltaTime);

        if (Math.abs(p.altitude - floor) < 50) p.phase = FlightPhase.CRUISE;
        break;
      }

      // ── APPROACH ─────────────────────────────────────────────────────────
      case FlightPhase.APPROACH: {
        const appSpd = this.vrefKts + 10;
        p.speed      = Physics.updateSpeed(p.speed, appSpd, 1.5, deltaTime);

        if (p.onILS) {
          // Glide slope: ~300 ft per NM → convert to ft/s at current speed
          const gsVsFtS = (p.speed / 3600) * 6076.12 * Math.tan(GLIDE_SLOPE_DEG * Math.PI / 180);
          p.altitude    = Math.max(ORD_ELEVATION, p.altitude - gsVsFtS * deltaTime);
          if (p.altitude < ORD_ELEVATION + 3000) p.phase = FlightPhase.FINAL;
        } else {
          p.altitude = Physics.updateAltitude(p.altitude, ORD_ELEVATION + 2500, this.descentFpm, deltaTime);
        }

        if (p.targetHeading !== null) {
          p.heading = this.turnToward(p.heading, p.targetHeading, this.airBankDps, deltaTime, p.turnDirection);
        }
        p.position = Physics.updatePosition(p.position.lat, p.position.lon, p.heading, p.speed, deltaTime);
        break;
      }

      // ── FINAL ─────────────────────────────────────────────────────────────
      case FlightPhase.FINAL: {
        const finalSpd  = this.vrefKts + 5;
        p.speed         = Physics.updateSpeed(p.speed, finalSpd, 1.5, deltaTime);

        // Glide slope vertical speed (ft/s)
        const gsVsFtS = (p.speed / 3600) * 6076.12 * Math.tan(GLIDE_SLOPE_DEG * Math.PI / 180);
        p.altitude    = Math.max(ORD_ELEVATION, p.altitude - gsVsFtS * deltaTime);

        if (p.targetHeading !== null) {
          p.heading = this.turnToward(p.heading, p.targetHeading, this.airBankDps, deltaTime, p.turnDirection);
        }
        p.position = Physics.updatePosition(p.position.lat, p.position.lon, p.heading, p.speed, deltaTime);

        if (p.altitude <= ORD_ELEVATION + 5) {
          p.altitude = ORD_ELEVATION;
          p.phase    = FlightPhase.LANDING;
        }
        break;
      }

      // ── LANDING (roll-out) ───────────────────────────────────────────────
      case FlightPhase.LANDING: {
        p.altitude = ORD_ELEVATION;
        p.speed    = Physics.updateSpeed(p.speed, 0, this.decelKtps, deltaTime);
        p.position = Physics.updatePosition(p.position.lat, p.position.lon, p.heading, p.speed, deltaTime);

        if (p.speed <= this.MIN_TAXI_KTS) {
          p.speed = this.MIN_TAXI_KTS;
          p.phase = FlightPhase.TAXI_IN;
          // Player issues EXIT command, which sets taxiWaypoints.
        }
        break;
      }

      // ── ARRIVED ───────────────────────────────────────────────────────────
      case FlightPhase.ARRIVED:
        p.speed    = 0;
        p.altitude = ORD_ELEVATION;
        break;

      // ── HOLDING PATTERN ───────────────────────────────────────────────────
      case FlightPhase.HOLDING: {
        if (!p.holdingFix) break;   // safety guard — should never happen
        // Reduce to standard holding speed (210 kts) if faster
        const HOLD_SPEED = 210;
        p.speed = Physics.updateSpeed(p.speed, HOLD_SPEED, this.decelKtps / 2, deltaTime);
        // Angular rate (deg/s) for a right-hand circular orbit
        const angRateDeg = p.speed / (20 * Math.PI * p.holdingRadiusNM);
        p.holdingAngleDeg = (p.holdingAngleDeg + angRateDeg * deltaTime) % 360;
        const angleRad  = p.holdingAngleDeg * Math.PI / 180;
        const cosLat    = Math.cos(p.holdingFix.lat * Math.PI / 180);
        p.position = {
          lat: p.holdingFix.lat + (Math.cos(angleRad) * p.holdingRadiusNM) / 60,
          lon: p.holdingFix.lon + (Math.sin(angleRad) * p.holdingRadiusNM) / (60 * (cosLat || 0.001)),
        };
        // Heading = tangent direction (clockwise → +90°)
        p.heading = (p.holdingAngleDeg + 90) % 360;
        break;
      }
    }
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  /**
   * Advance along assigned taxi waypoints.
   * Speed range: MIN_TAXI_KTS–MAX_TAXI_KTS (17–28 kts).
   * Slows for turns and proximity to waypoints.
   * Stops behind any ground-traffic aircraft ahead (collision avoidance).
   */
  private updateTaxi(deltaTime: number): void {
    const p = this.state;

    if (!p.taxiWaypoints || p.taxiWaypoints.length === 0) {
      p.speed = 0;
      return;
    }

    if (p.taxiWaypointIndex >= p.taxiWaypoints.length) {
      p.speed = 0;
      if (p.phase === FlightPhase.TAXI_OUT || p.phase === FlightPhase.LINEUP) {
        if (p.takeoffClearance && p.phase === FlightPhase.LINEUP) {
          p.phase = FlightPhase.TAKEOFF;
        } else {
          p.phase = FlightPhase.HOLDING_SHORT;
        }
      } else if (p.phase === FlightPhase.TAXI_IN) {
        p.phase = FlightPhase.ARRIVED;
      }
      return;
    }

    const target  = p.taxiWaypoints[p.taxiWaypointIndex];
    const bearing = this.bearingTo(p.position, target);
    const dist    = this.nmDistanceTo(p.position, target);

    // ── Collision avoidance ────────────────────────────────────
    // SAFE_DIST_NM / SLOW_DIST_NM are declared as module-level constants (25 ft / 100 ft).
    const CONE_HALF_DEG = 40;     // angular half-width of the look-ahead cone
    let trafficFactor = 1.0;
    if (this._allAircraft) {
      for (const other of this._allAircraft) {
        if (other === this) continue;
        const otherPhase = other.phase;
        // Only check ground-traffic
        const groundPhases: FlightPhase[] = [
          FlightPhase.PARKED, FlightPhase.PUSHBACK_PENDING, FlightPhase.PUSHBACK,
          FlightPhase.TAXI_OUT, FlightPhase.TAXI_IN,
          FlightPhase.HOLDING_SHORT, FlightPhase.LINEUP,
        ];
        if (!groundPhases.includes(otherPhase)) continue;

        const d = this.nmDistanceTo(p.position, other.position);
        if (d > SLOW_DIST_NM) continue;

        // Check if other aircraft is within look-ahead cone.
        // Use the bearing to the current waypoint (route direction) rather than
        // p.heading so the cone is aligned with where we are actually going,
        // not the stale heading the aircraft still has from pushback.
        const bearingToOther = this.bearingTo(p.position, other.position);
        let angDiff = Math.abs(bearingToOther - bearing);
        if (angDiff > 180) angDiff = 360 - angDiff;
        if (angDiff > CONE_HALF_DEG) continue;

        if (d <= SAFE_DIST_NM) {
          // Full stop
          trafficFactor = 0;
          break;
        } else {
          // Smooth slow-down
          const ratio = (d - SAFE_DIST_NM) / (SLOW_DIST_NM - SAFE_DIST_NM);
          trafficFactor = Math.min(trafficFactor, ratio);
        }
      }
    }

    if (trafficFactor <= 0) {
      p.speed = Physics.updateSpeed(p.speed, 0, 8.0, deltaTime);
      p.altitude = ORD_ELEVATION;
      return;
    }

    // ── Lateral (cross-track) correction — keeps the plane on its assigned line ──
    // When we have a previous waypoint, compute the signed perpendicular distance
    // from the segment [prevWp → target] and blend a correction into the bearing.
    let correctedBearing = bearing;
    if (p.taxiWaypointIndex > 0 && p.taxiWaypoints && p.taxiWaypointIndex > 0) {
      const prevWp = p.taxiWaypoints[p.taxiWaypointIndex - 1];
      const xte = this.crossTrackError(
        { lat: prevWp.lat, lon: prevWp.lon },
        p.position,
        { lat: target.lat, lon: target.lon },
      );
      // Positive XTE = right of track → subtract from bearing to steer left.
      // Use atan2 so correction is naturally bounded at ±90° and proportional to
      // lateral error vs. remaining distance ahead.
      const corrDeg = Math.atan2(xte, Math.max(dist, WAYPOINT_THRESHOLD_NM * 0.5)) * (180 / Math.PI);
      correctedBearing = (bearing - Math.max(-45, Math.min(45, corrDeg * 2.0)) + 360) % 360;
    }

    // ── Heading & speed ────────────────────────────────────────
    p.heading = this.turnToward(p.heading, correctedBearing, this.bankRateDps, deltaTime, 'auto');

    // Heading error (measured against the corrected bearing so speed adapts correctly)
    let hErr = Math.abs(correctedBearing - p.heading);
    if (hErr > 180) hErr = 360 - hErr;

    // ── Look-ahead turn speed reduction (F-GND-02) ─────────────────────
    // Detect upcoming turns and pre-emptively slow down so the aircraft
    // follows the centerline around bends without cutting corners.
    let lookAheadFactor = 1.0;
    if (p.taxiWaypoints && p.taxiWaypointIndex + 1 < p.taxiWaypoints.length) {
      const nextWp = p.taxiWaypoints[p.taxiWaypointIndex + 1];
      // Bearing continuing through the CURRENT target to the NEXT one
      const continueBearing = this.bearingTo(
        { lat: target.lat, lon: target.lon },
        { lat: nextWp.lat, lon: nextWp.lon },
      );
      let turnDeg = Math.abs(continueBearing - bearing);
      if (turnDeg > 180) turnDeg = 360 - turnDeg;

      if (turnDeg > 90) {
        // Sharp turn >90° — slow to ~5 kts within 150 ft of the turn point
        const slowZoneNM = 0.025; // ~150 ft
        if (dist < slowZoneNM) {
          lookAheadFactor = Math.max(5 / this.taxiKts, dist / slowZoneNM * 0.5);
        }
      } else if (turnDeg > 45) {
        // Moderate turn 45–90° — reduce to ~60% approaching the turn
        const slowZoneNM = 0.015; // ~90 ft
        if (dist < slowZoneNM) lookAheadFactor = 0.55;
      }
    }

    // Speed factors
    const turnFactor  = hErr > 45 ? 0.55 : (hErr > 20 ? 0.75 : 1.0);
    const proxFactor  = dist < 0.008 ? Math.max(0.3, dist / 0.008) : 1.0;

    // Clamp final target to the valid range [MIN_TAXI_KTS, MAX_TAXI_KTS]
    const raw = this.taxiKts * turnFactor * proxFactor * trafficFactor * lookAheadFactor;
    const targetSpeed = Math.max(this.MIN_TAXI_KTS * Math.min(turnFactor, lookAheadFactor), Math.min(this.MAX_TAXI_KTS, raw));

    p.speed    = Physics.updateSpeed(p.speed, targetSpeed, 5.0, deltaTime);
    p.altitude = ORD_ELEVATION;
    p.position = Physics.updatePosition(p.position.lat, p.position.lon, p.heading, p.speed, deltaTime);

    if (dist < WAYPOINT_THRESHOLD_NM) {
      p.taxiWaypointIndex++;
    }
  }

  /**
   * Turn current heading toward target, respecting a forced direction.
   */
  private turnToward(
    current: number,
    target: number,
    rate: number,
    dt: number,
    dir: 'left' | 'right' | 'auto',
  ): number {
    current = (current + 360) % 360;
    target  = (target  + 360) % 360;

    let diff = target - current;
    if (diff >  180) diff -= 360;
    if (diff < -180) diff += 360;

    if (dir === 'left')  diff = diff > 0 ? diff - 360 : diff;
    if (dir === 'right') diff = diff < 0 ? diff + 360 : diff;

    const maxChange = rate * dt;
    if (Math.abs(diff) <= maxChange) return target;
    return (current + Math.sign(diff) * maxChange + 360) % 360;
  }

  // ── Geometry ──────────────────────────────────────────────────────────────

  /**
   * Signed cross-track error in nautical miles.
   * Positive = aircraft is to the RIGHT of the track from `trackStart` to `trackEnd`.
   * Negative = aircraft is to the LEFT.
   */
  private crossTrackError(trackStart: Position, current: Position, trackEnd: Position): number {
    const bearingSE = this.bearingTo(trackStart, trackEnd);
    const bearingSC = this.bearingTo(trackStart, current);
    const distSC    = this.nmDistanceTo(trackStart, current);
    const angleRad  = (bearingSC - bearingSE) * Math.PI / 180;
    return distSC * Math.sin(angleRad);
  }

  /**
   * Smoothly interpolate between two headings using the shortest path.
   * @param from Starting heading (degrees)
   * @param to Target heading (degrees)
   * @param t Blend factor [0, 1] — 0 = from, 1 = to
   */
  private interpolateHeading(from: number, to: number, t: number): number {
    from = (from + 360) % 360;
    to   = (to + 360) % 360;

    let diff = to - from;
    if (diff >  180) diff -= 360;
    if (diff < -180) diff += 360;

    return (from + diff * t + 360) % 360;
  }

  private bearingTo(from: Position, to: Position): number {
    const lat1 = from.lat * Math.PI / 180;
    const lat2 = to.lat   * Math.PI / 180;
    const dLon = (to.lon - from.lon) * Math.PI / 180;
    const y = Math.sin(dLon)  * Math.cos(lat2);
    const x = Math.cos(lat1)  * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  }

  private nmDistanceTo(from: Position, to: Position): number {
    const R    = 3440.065;
    const dLat = (to.lat - from.lat) * Math.PI / 180;
    const dLon = (to.lon - from.lon) * Math.PI / 180;
    const a    = Math.sin(dLat / 2) ** 2 +
                 Math.cos(from.lat * Math.PI / 180) * Math.cos(to.lat * Math.PI / 180) *
                 Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  distanceTo(target: Position): number {
    return this.nmDistanceTo(this.state.position, target);
  }
}

