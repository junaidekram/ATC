import type { Aircraft } from '../aircraft/Aircraft';
import type { ParsedCommand } from './CommandParser';
import type { SimLoop } from '../simulation/SimLoop';
import { FlightPhase, type TaxiWaypoint } from '../aircraft/FlightPhase';
import { TaxiRouter } from './TaxiRouter';
import { RunwayManager } from './RunwayManager';
import type { DataLoader } from '../data/DataLoader';

// ────────────────────────────────────────────────────────────────────────────

/** Numeric words used in read-backs (ones) */
const NUM_WORDS: Record<number, string> = {
  0:'zero',1:'one',2:'two',3:'three',4:'four',
  5:'five',6:'six',7:'seven',8:'eight',9:'nine',
  10:'ten',11:'eleven',12:'twelve',13:'thirteen',14:'fourteen',15:'fifteen',
  16:'sixteen',17:'seventeen',18:'eighteen',19:'nineteen',20:'twenty',
  30:'thirty',40:'forty',50:'fifty',60:'sixty',70:'seventy',
  80:'eighty',90:'ninety',100:'one hundred',
};

function spellDigits(n: number): string {
  return String(n).split('').map(d => NUM_WORDS[parseInt(d)] ?? d).join('-');
}

function spellHeading(hdg: number): string {
  return spellDigits(hdg).replace(/-/g, ' ');
}

function spellAltitude(alt: number): string {
  if (alt % 1000 === 0) return `${NUM_WORDS[alt / 1000] ?? alt / 1000} thousand`;
  const thou = Math.floor(alt / 1000);
  const hund = Math.floor((alt % 1000) / 100);
  const parts = [];
  if (thou > 0)   parts.push(`${NUM_WORDS[thou] ?? thou} thousand`);
  if (hund > 0)   parts.push(`${NUM_WORDS[hund * 100] ?? hund * 100}`);
  return parts.join(' ');
}

function spellSpeed(spd: number): string {
  // e.g. 180 → "one eight zero"
  const hundreds = Math.floor(spd / 100);
  const rem      = spd % 100;
  const tens     = Math.floor(rem / 10);
  const ones     = rem % 10;
  const parts: string[] = [];
  if (hundreds > 0) parts.push(NUM_WORDS[hundreds]);
  parts.push(NUM_WORDS[tens * 10] ?? String(tens));
  if (ones > 0)     parts.push(NUM_WORDS[ones]);
  return parts.join(' ');
}

function spellRunway(rwy: string): string {
  const number = rwy.replace(/[LRC]/g, '');
  const suffix = rwy.replace(/[0-9]/g, '');
  const suffMap: Record<string, string> = { L: 'Left', R: 'Right', C: 'Center' };
  const spelledNum = number.split('').map(d => NUM_WORDS[parseInt(d)] ?? d).join(' ');
  return suffix ? `${spelledNum} ${suffMap[suffix] ?? suffix}` : spelledNum;
}

// ────────────────────────────────────────────────────────────────────────────

function nmDist(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R    = 3440.065;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLon = (b.lon - a.lon) * Math.PI / 180;
  const h    = Math.sin(dLat / 2) ** 2 +
               Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) *
               Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

// ────────────────────────────────────────────────────────────────────────────

export interface CommandResult {
  readback: string;
  error?: string;
}

/**
 * CommandHandler
 *
 * Applies a parsed ATC command to the target aircraft, enforces pre-conditions
 * (runway occupancy, separation, aircraft phase), and returns a pilot read-back
 * string (or an error message for display in the comms log).
 */
export class CommandHandler {
  private taxiRouter: TaxiRouter;
  private runwayManager: RunwayManager;
  private dataLoader: DataLoader;
  private simLoop: SimLoop;

  constructor(dataLoader: DataLoader, simLoop: SimLoop) {
    this.dataLoader     = dataLoader;
    this.simLoop        = simLoop;
    this.taxiRouter     = new TaxiRouter(dataLoader.getTaxiwayGraph());
    this.runwayManager  = new RunwayManager(dataLoader.getRunways());
  }

  // ── Public entry point ────────────────────────────────────────────────────

  execute(cmd: ParsedCommand): CommandResult {
    // Resolve aircraft
    const ac = this.findAircraft(cmd.callsign);
    if (!ac) {
      return { readback: '', error: `AIRCRAFT NOT ON FREQUENCY — ${cmd.callsign}` };
    }

    switch (cmd.type) {
      case 'CLEARED_IFR':      return this.handleClearedIFR(ac, cmd);
      case 'PUSH_BACK':        return this.handlePushBack(ac, cmd);
      case 'TAXI':             return this.handleTaxi(ac, cmd);
      case 'CROSS_RUNWAY':     return this.handleCrossRunway(ac, cmd);
      case 'HOLD_SHORT':       return this.handleHoldShort(ac, cmd);
      case 'HOLD_POSITION':    return this.handleHoldPosition(ac);
      case 'LINE_UP_AND_WAIT': return this.handleLineUp(ac, cmd);
      case 'CLEARED_TAKEOFF':  return this.handleClearedTakeoff(ac, cmd);
      case 'CANCEL_TAKEOFF':   return this.handleCancelTakeoff(ac, cmd);
      case 'EXPECT_ILS':       return this.handleExpectILS(ac, cmd);
      case 'ILS_CLEARED':      return this.handleILSCleared(ac, cmd);
      case 'VISUAL_CLEARED':   return this.handleVisualCleared(ac, cmd);
      case 'CLEARED_LAND':     return this.handleClearedLand(ac, cmd);
      case 'REDUCE_SPEED':
      case 'INCREASE_SPEED':
      case 'MAINTAIN_SPEED':   return this.handleSpeed(ac, cmd);
      case 'DESCEND_MAINTAIN': return this.handleDescend(ac, cmd);
      case 'CLIMB_MAINTAIN':   return this.handleClimb(ac, cmd);
      case 'FLY_HEADING':      return this.handleHeading(ac, cmd);
      case 'GO_AROUND':        return this.handleGoAround(ac, cmd);
      case 'EXIT_RUNWAY':      return this.handleExitRunway(ac, cmd);
      case 'CONTACT_GROUND':   return this.handleContactGround(ac, cmd);
      case 'FREQUENCY_CHANGE': return this.handleFrequencyChange(ac, cmd);
      case 'HOLD_PATTERN':     return this.handleHoldPattern(ac, cmd);
      case 'PROCEED_DIRECT':   return this.handleProceedDirect(ac, cmd);
      case 'RESUME_NAV':       return this.handleResumeNav(ac);
      default:
        return { readback: '', error: 'Command not implemented yet' };
    }
  }

  // ── Handlers ──────────────────────────────────────────────────────────────

  private handleClearedIFR(ac: Aircraft, cmd: Extract<ParsedCommand, { type: 'CLEARED_IFR' }>): CommandResult {
    if (ac.phase !== FlightPhase.PARKED) {
      return { readback: '', error: `${ac.callsign} is not parked — IFR clearance invalid` };
    }
    ac.setIfrCleared(true);
    const sqText = cmd.squawk ? `, squawk ${spellDigits(cmd.squawk)}` : '';
    const sidText = cmd.sid ? `, ${cmd.sid} departure` : '';
    return {
      readback: `Cleared to ${cmd.destination}${sidText}${sqText}, ${ac.callsign}`,
    };
  }

  private handlePushBack(ac: Aircraft, cmd: Extract<ParsedCommand, { type: 'PUSH_BACK' }>): CommandResult {
    if (ac.phase !== FlightPhase.PARKED) {
      return { readback: '', error: `${ac.callsign} is not parked` };
    }
    const faceHdg = cmd.faceHeading ?? null;

    // Calculate pushback distance and 2-segment path
    let pushbackDistNM = 0.042; // default ~250 ft
    let pushbackWaypoints: TaxiWaypoint[] | undefined;

    const gateId = ac.getState().gateId;
    if (gateId) {
      const gate = this.dataLoader.getGates().find(g => g.id === gateId);
      if (gate?.taxiway_exit) {
        const graph = this.dataLoader.getTaxiwayGraph();
        const exitNode = graph.nodeMap.get(gate.taxiway_exit);
        if (exitNode) {
          const startPos = {
            lat: gate.parking_lat ?? gate.lat,
            lon: gate.parking_lon ?? gate.lon,
          };
          const d = nmDist(startPos, exitNode);
          if (d > 0.005) pushbackDistNM = Math.min(d * 1.15, 0.25);

          // ── Segment 1: straight back to the taxiway exit node
          const wps: TaxiWaypoint[] = [
            { lat: exitNode.lat, lon: exitNode.lon, nodeId: gate.taxiway_exit },
          ];

          // ── Segment 2: continue onto the taxiway so the nose aligns for taxi.
          // Find the adjacent node of the exit node that is most perpendicular to
          // the pushback direction (roughly 90° from gate→exit bearing).
          // This is the node the plane should end up facing toward.
          const adjacency = graph.adjacency.get(gate.taxiway_exit) ?? [];
          const pushBearing = this.bearingTo(startPos, exitNode);
          let bestAdj: string | null = null;
          let bestScore = -Infinity;
          for (const adj of adjacency) {
            const adjPos = graph.nodeMap.get(adj.to);
            if (!adjPos) continue;
            const adjBearing = this.bearingTo(exitNode, adjPos);
            // Angular difference from the pushback direction (180° = directly ahead of push)
            let angDiff = Math.abs(((adjBearing - pushBearing + 360) % 360) - 180);
            if (angDiff > 180) angDiff = 360 - angDiff;
            // Score: closest to 90° perpendicular wins (plane turns cleanly onto taxiway)
            const score = -Math.abs(angDiff - 90);
            if (score > bestScore) {
              bestScore = score;
              bestAdj = adj.to;
            }
          }
          if (bestAdj) {
            const adjPos = graph.nodeMap.get(bestAdj)!;
            wps.push({ lat: adjPos.lat, lon: adjPos.lon, nodeId: bestAdj });
            // Derive faceHeading from the alignment node direction so the nose
            // points the right way after pushback.
            const alignHdg = this.bearingTo(exitNode, adjPos);
            const resolvedFaceHdg = faceHdg ?? alignHdg;
            pushbackWaypoints = wps;
            ac.setPushback(resolvedFaceHdg, pushbackDistNM, wps);
            ac.clearDepartureRequest();
            this.applyAircraftSpecs(ac);
            const dirText2 = cmd.faceDirection
              ? `, facing ${cmd.faceDirection.toLowerCase()}`
              : `, facing heading ${Math.round(resolvedFaceHdg)}`;
            return { readback: `Push back approved${dirText2}, ${ac.callsign}` };
          } else {
            pushbackWaypoints = wps;
          }
        }
      }
    }
    // Fallback: no gate data or no exit node — use legacy straight-line reverse.
    ac.setPushback(faceHdg, pushbackDistNM, pushbackWaypoints);
    ac.clearDepartureRequest();   // ← clear the request so it leaves the requests panel
    this.applyAircraftSpecs(ac);

    const dirText = cmd.faceDirection
      ? `, facing ${cmd.faceDirection.toLowerCase()}`
      : (cmd.faceHeading !== undefined ? `, facing heading ${cmd.faceHeading}` : '');
    return {
      readback: `Push back approved${dirText}, ${ac.callsign}`,
    };
  }

  private handleTaxi(ac: Aircraft, cmd: Extract<ParsedCommand, { type: 'TAXI' }>): CommandResult {
    const allowedPhases = [
      FlightPhase.PARKED, FlightPhase.TAXI_OUT, FlightPhase.TAXI_IN,
      FlightPhase.HOLDING_SHORT, FlightPhase.PUSHBACK,
    ];
    if (!allowedPhases.includes(ac.phase)) {
      return { readback: '', error: `${ac.callsign} is not on the ground or not eligible for taxi` };
    }

    const runway = cmd.runway.toUpperCase();
    const twIds  = this.taxiRouter.parseRoute(cmd.via);

    // Resolve destination: runway holding point threshold
    const rwyInfo = this.runwayManager.getRunway(runway);
    if (!rwyInfo) {
      return { readback: '', error: `Runway ${runway} not found` };
    }

    const destinationPos = { lat: rwyInfo.thresholdLat, lon: rwyInfo.thresholdLon };

    // Snap aircraft to the nearest taxiway graph node before building the route.
    // After pushback the aircraft may be a short distance off the graph; snapping
    // ensures the route starts at the aircraft's position so it doesn't take an
    // off-taxiway shortcut to reach the first waypoint.
    const snapNode = this.taxiRouter.nearestNode(ac.position);
    if (snapNode) {
      const snapDistNM = nmDist(ac.position, { lat: snapNode.lat, lon: snapNode.lon });
      if (snapDistNM <= 0.05) {          // within ~300 ft — safe to snap
        ac.setPosition(snapNode.lat, snapNode.lon);
      }
    }

    try {
      const waypoints = this.taxiRouter.buildRoute(ac.position, twIds, destinationPos);
      ac.setTaxiWaypoints(waypoints);
      ac.setAssignedRunway(runway);
      ac.setAssignedTaxiRoute(twIds);
      if (ac.phase === FlightPhase.PARKED || ac.phase === FlightPhase.HOLDING_SHORT) {
        ac.setPhase(FlightPhase.TAXI_OUT);
      }
      this.applyAircraftSpecs(ac);

      const viaText = cmd.via.length > 0
        ? `, via ${cmd.via.map(t => t.charAt(0) + t.slice(1).toLowerCase()).join(', ')}`
        : '';
      return {
        readback: `Taxi runway ${spellRunway(runway)}${viaText}, ${ac.callsign}`,
      };
    } catch (e) {
      return { readback: '', error: (e as Error).message };
    }
  }

  private handleCrossRunway(ac: Aircraft, cmd: Extract<ParsedCommand, { type: 'CROSS_RUNWAY' }>): CommandResult {
    const runway = cmd.runway.toUpperCase();
    if (this.runwayManager.isOccupied(runway, this.simLoop.getAircraft())) {
      return { readback: '', error: `RUNWAY OCCUPIED — runway ${runway} clearance denied` };
    }
    // Clear the pending crossing and resume taxi
    ac.setPendingRunwayCrossing(null);
    if (ac.phase === FlightPhase.HOLDING_SHORT) {
      ac.setPhase(FlightPhase.TAXI_OUT);
    }
    return { readback: `Cross runway ${spellRunway(runway)}, ${ac.callsign}` };
  }

  private handleHoldShort(ac: Aircraft, cmd: Extract<ParsedCommand, { type: 'HOLD_SHORT' }>): CommandResult {
    ac.setPhase(FlightPhase.HOLDING_SHORT);
    const pointText = cmd.pointType === 'runway'
      ? `runway ${spellRunway(cmd.pointId)}`
      : `taxiway ${cmd.pointId}`;
    return { readback: `Hold short ${pointText}, ${ac.callsign}` };
  }

  private handleHoldPosition(ac: Aircraft): CommandResult {
    if (ac.phase === FlightPhase.TAXI_OUT || ac.phase === FlightPhase.TAXI_IN) {
      // Stop but keep waypoints — issuing TAXI again will resume the route
      ac.setPhase(FlightPhase.HOLDING_SHORT);
      return { readback: `Holding position, ${ac.callsign}` };
    }
    return { readback: '', error: `${ac.callsign} is not taxiing` };
  }

  private handleLineUp(ac: Aircraft, cmd: Extract<ParsedCommand, { type: 'LINE_UP_AND_WAIT' }>): CommandResult {
    const runway  = cmd.runway.toUpperCase();
    const rwyInfo = this.runwayManager.getRunway(runway);
    if (!rwyInfo) {
      return { readback: '', error: `Runway ${runway} not found` };
    }

    if (this.runwayManager.isOccupied(runway, this.simLoop.getAircraft())) {
      return { readback: '', error: `RUNWAY OCCUPIED — cannot line up on ${runway}` };
    }

    // Place aircraft at the holding threshold with the runway heading
    const lineupPos = this.runwayManager.getLineupPosition(runway)!;
    ac.setPhase(FlightPhase.LINEUP);
    ac.setAssignedRunway(runway);
    ac.setHeading(rwyInfo.heading);

    // Set single waypoint: the threshold
    ac.setTaxiWaypoints([{
      lat: lineupPos.lat,
      lon: lineupPos.lon,
      nodeId: `lineup_${runway}`,
    }]);
    this.applyAircraftSpecs(ac);

    return { readback: `Line up and wait, runway ${spellRunway(runway)}, ${ac.callsign}` };
  }

  private handleClearedTakeoff(ac: Aircraft, cmd: Extract<ParsedCommand, { type: 'CLEARED_TAKEOFF' }>): CommandResult {
    const runway = cmd.runway.toUpperCase();

    // Pre-condition checks
    if (this.runwayManager.isOccupied(runway, this.simLoop.getAircraft().filter(a => a !== ac))) {
      return { readback: '', error: `RUNWAY OCCUPIED — takeoff clearance denied on ${runway}` };
    }
    if (this.runwayManager.hasFinalTraffic(runway, this.simLoop.getAircraft())) {
      return { readback: '', error: `SEPARATION — aircraft on 3-mile final, takeoff denied` };
    }
    if (ac.phase !== FlightPhase.HOLDING_SHORT && ac.phase !== FlightPhase.LINEUP && ac.phase !== FlightPhase.TAXI_OUT) {
      return { readback: '', error: `${ac.callsign} is not at the runway` };
    }

    const rwyInfo = this.runwayManager.getRunway(runway);
    if (rwyInfo) ac.setHeading(rwyInfo.heading);

    const flyHdg = cmd.flyHeading;
    ac.setTakeoffClearance(flyHdg ?? null, 5000);
    ac.setAssignedRunway(runway);
    ac.setPhase(FlightPhase.TAKEOFF);
    ac.setTaxiWaypoints([]);
    this.applyAircraftSpecs(ac);

    const hdgText = flyHdg !== undefined ? `, fly heading ${spellHeading(flyHdg)}` : '';
    return { readback: `Cleared for takeoff, runway ${spellRunway(runway)}${hdgText}, ${ac.callsign}` };
  }

  private handleCancelTakeoff(ac: Aircraft, _cmd: Extract<ParsedCommand, { type: 'CANCEL_TAKEOFF' }>): CommandResult {
    if (ac.phase === FlightPhase.CLIMBING || ac.phase === FlightPhase.CRUISE) {
      return { readback: '', error: `${ac.callsign} is airborne — cannot cancel takeoff` };
    }
    ac.cancelTakeoffClearance();
    ac.setPhase(FlightPhase.HOLDING_SHORT);
    return { readback: `Wilco, stopping, ${ac.callsign}` };
  }

  private handleExpectILS(ac: Aircraft, cmd: Extract<ParsedCommand, { type: 'EXPECT_ILS' }>): CommandResult {
    const runway = cmd.runway.toUpperCase();
    ac.setApproachRunway(runway);
    ac.setAssignedRunway(runway);
    return { readback: `Expect ILS approach runway ${spellRunway(runway)}, ${ac.callsign}` };
  }

  private handleILSCleared(ac: Aircraft, cmd: Extract<ParsedCommand, { type: 'ILS_CLEARED' }>): CommandResult {
    const runway  = cmd.runway.toUpperCase();
    const rwyInfo = this.runwayManager.getRunway(runway);
    if (!rwyInfo) {
      return { readback: '', error: `Runway ${runway} not found` };
    }
    if (this.runwayManager.isOccupied(runway, this.simLoop.getAircraft().filter(a => a !== ac))) {
      return { readback: '', error: `RUNWAY OCCUPIED — ILS clearance denied on ${runway}` };
    }

    ac.setApproachRunway(runway);
    ac.setAssignedRunway(runway);
    ac.setOnILS(true);
    // Turn aircraft to intercept the inbound course (reciprocal of runway heading = landing heading)
    ac.setTargetHeading(rwyInfo.heading, 'auto');
    if (ac.phase === FlightPhase.CRUISE || ac.phase === FlightPhase.DESCENDING) {
      ac.setPhase(FlightPhase.APPROACH);
    }
    this.applyAircraftSpecs(ac);

    return { readback: `ILS approach cleared, runway ${spellRunway(runway)}, ${ac.callsign}` };
  }

  private handleVisualCleared(ac: Aircraft, cmd: Extract<ParsedCommand, { type: 'VISUAL_CLEARED' }>): CommandResult {
    const runway  = cmd.runway.toUpperCase();
    const rwyInfo = this.runwayManager.getRunway(runway);
    if (!rwyInfo) {
      return { readback: '', error: `Runway ${runway} not found` };
    }
    if (this.runwayManager.isOccupied(runway, this.simLoop.getAircraft().filter(a => a !== ac))) {
      return { readback: '', error: `RUNWAY OCCUPIED — visual approach clearance denied on ${runway}` };
    }

    ac.setApproachRunway(runway);
    ac.setAssignedRunway(runway);
    ac.setOnILS(false);
    ac.setTargetHeading(rwyInfo.heading, 'auto');
    if (ac.phase === FlightPhase.CRUISE || ac.phase === FlightPhase.DESCENDING) {
      ac.setPhase(FlightPhase.APPROACH);
    }
    this.applyAircraftSpecs(ac);

    return { readback: `Visual approach cleared, runway ${spellRunway(runway)}, ${ac.callsign}` };
  }

  private handleClearedLand(ac: Aircraft, cmd: Extract<ParsedCommand, { type: 'CLEARED_LAND' }>): CommandResult {
    const runway  = cmd.runway.toUpperCase();
    const rwyInfo = this.runwayManager.getRunway(runway);
    if (!rwyInfo) {
      return { readback: '', error: `Runway ${runway} not found` };
    }
    if (this.runwayManager.isOccupied(runway, this.simLoop.getAircraft().filter(a => a !== ac))) {
      return { readback: '', error: `RUNWAY OCCUPIED — landing clearance denied on ${runway}` };
    }

    ac.setApproachRunway(runway);
    ac.setAssignedRunway(runway);
    ac.setLandingClearance(true);
    ac.setOnILS(true);
    ac.setTargetHeading(rwyInfo.heading, 'auto');
    if (ac.phase === FlightPhase.APPROACH || ac.phase === FlightPhase.DESCENDING || ac.phase === FlightPhase.CRUISE) {
      ac.setPhase(FlightPhase.FINAL);
    }
    this.applyAircraftSpecs(ac);

    return { readback: `Cleared to land, runway ${spellRunway(runway)}, ${ac.callsign}` };
  }

  private handleSpeed(ac: Aircraft, cmd: Extract<ParsedCommand, { type: 'REDUCE_SPEED' | 'INCREASE_SPEED' | 'MAINTAIN_SPEED' }>): CommandResult {
    const spd = cmd.speed;
    if (ac.altitude < 10_000 && spd > 250) {
      return { readback: '', error: `AIRSPEED LIMIT — cannot exceed 250 kts below FL100` };
    }
    ac.setTargetSpeed(spd);
    const verbMap = { REDUCE_SPEED: 'Reducing', INCREASE_SPEED: 'Increasing', MAINTAIN_SPEED: 'Maintaining' };
    return { readback: `${verbMap[cmd.type]} to ${spellSpeed(spd)} knots, ${ac.callsign}` };
  }

  private handleDescend(ac: Aircraft, cmd: Extract<ParsedCommand, { type: 'DESCEND_MAINTAIN' }>): CommandResult {
    const alt = cmd.altitude;
    ac.setTargetAltitude(alt);
    if (ac.phase === FlightPhase.CRUISE || ac.phase === FlightPhase.CLIMBING) {
      ac.setPhase(FlightPhase.DESCENDING);
    }
    return { readback: `Descending to ${spellAltitude(alt)}, ${ac.callsign}` };
  }

  private handleClimb(ac: Aircraft, cmd: Extract<ParsedCommand, { type: 'CLIMB_MAINTAIN' }>): CommandResult {
    const alt = cmd.altitude;
    ac.setTargetAltitude(alt);
    if (ac.phase === FlightPhase.CRUISE || ac.phase === FlightPhase.DESCENDING) {
      ac.setPhase(FlightPhase.CLIMBING);
    }
    return { readback: `Climbing to ${spellAltitude(alt)}, ${ac.callsign}` };
  }

  private handleHeading(ac: Aircraft, cmd: Extract<ParsedCommand, { type: 'FLY_HEADING' }>): CommandResult {
    const hdg = cmd.heading;
    const dir = cmd.direction ?? 'auto';
    ac.setTargetHeading(hdg, dir);
    const prefix = dir === 'left' ? 'Turn left' : (dir === 'right' ? 'Turn right' : 'Fly');
    return { readback: `${prefix} heading ${spellHeading(hdg)}, ${ac.callsign}` };
  }

  private handleGoAround(ac: Aircraft, cmd: Extract<ParsedCommand, { type: 'GO_AROUND' }>): CommandResult {
    ac.setPhase(FlightPhase.CLIMBING);
    ac.setTargetAltitude((cmd.climbTo ?? 3000) + 668);
    if (cmd.flyHeading !== undefined) {
      ac.setTargetHeading(cmd.flyHeading, 'auto');
    }
    ac.setLandingClearance(false);
    ac.setOnILS(false);
    this.applyAircraftSpecs(ac);

    const hdgText  = cmd.flyHeading ? `, runway heading ${spellHeading(cmd.flyHeading)}` : '';
    const altText  = cmd.climbTo   ? `, climbing to ${spellAltitude(cmd.climbTo)}` : '';
    return { readback: `Going around${hdgText}${altText}, ${ac.callsign}` };
  }

  private handleExitRunway(ac: Aircraft, cmd: Extract<ParsedCommand, { type: 'EXIT_RUNWAY' }>): CommandResult {
    if (ac.phase !== FlightPhase.LANDING && ac.phase !== FlightPhase.TAXI_IN) {
      return { readback: '', error: `${ac.callsign} is not on the runway` };
    }

    if (cmd.taxiway) {
      // Route toward the specified taxiway
      try {
        const twIds      = this.taxiRouter.parseRoute([cmd.taxiway]);
        const destination = ac.position; // stay local — just get off runway
        const waypoints  = this.taxiRouter.buildRoute(ac.position, twIds, destination);
        ac.setTaxiWaypoints(waypoints);
      } catch {
        // Non-fatal — aircraft will still proceed
      }
    }
    ac.setPhase(FlightPhase.TAXI_IN);

    const dirText = cmd.direction ? ` ${cmd.direction}` : '';
    const twText  = cmd.taxiway   ? ` on ${cmd.taxiway}` : '';
    return { readback: `Exiting${dirText}${twText}, ${ac.callsign}` };
  }

  private handleContactGround(ac: Aircraft, _cmd: Extract<ParsedCommand, { type: 'CONTACT_GROUND' }>): CommandResult {
    return { readback: `Contacting ground, ${ac.callsign}` };
  }

  private handleFrequencyChange(ac: Aircraft, _cmd: Extract<ParsedCommand, { type: 'FREQUENCY_CHANGE' }>): CommandResult {
    // Mark aircraft as departing from our frequency
    ac.setPhase(FlightPhase.CLIMBING);
    return { readback: `Frequency change approved, good day, ${ac.callsign}` };
  }

  private handleHoldPattern(ac: Aircraft, _cmd: Extract<ParsedCommand, { type: 'HOLD_PATTERN' }>): CommandResult {
    const airbornePhases = [
      FlightPhase.CLIMBING, FlightPhase.CRUISE, FlightPhase.DESCENDING,
      FlightPhase.APPROACH, FlightPhase.FINAL,
    ];
    if (!airbornePhases.includes(ac.phase)) {
      return { readback: '', error: `${ac.callsign} — HOLD command requires airborne aircraft` };
    }
    ac.enterHolding();
    return { readback: `Hold at present position, ${ac.callsign}. Maintain ${Math.round(ac.altitude / 100) * 100} feet.` };
  }

  private handleProceedDirect(ac: Aircraft, cmd: Extract<ParsedCommand, { type: 'PROCEED_DIRECT' }>): CommandResult {
    const wp = this.dataLoader.getWaypoint(cmd.fix);
    if (!wp) {
      return { readback: '', error: `HOLDING FIX NOT FOUND — ${cmd.fix}` };
    }
    // Compute heading to waypoint
    const bearing = this.bearingTo(ac.position, wp);
    ac.setTargetHeading(bearing, 'auto');
    return { readback: `Proceeding direct ${cmd.fix}, ${ac.callsign}` };
  }

  private handleResumeNav(ac: Aircraft): CommandResult {
    if (ac.phase !== FlightPhase.HOLDING) {
      return { readback: '', error: `${ac.callsign} — not currently in a holding pattern` };
    }
    ac.resumeNav();
    return { readback: `${ac.callsign}, resume own navigation. Descend and maintain flight level as assigned.` };
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  /**
   * Find an aircraft by callsign (case-insensitive, partial match of 3+ chars).
   */
  private findAircraft(callsign: string): Aircraft | undefined {
    const upper = callsign.toUpperCase();
    // Exact match first
    const exact = this.simLoop.findAircraft(upper);
    if (exact) return exact;
    // Prefix match (minimum 3 chars)
    if (upper.length >= 3) {
      return this.simLoop.getAircraft().find(a => a.callsign.toUpperCase().startsWith(upper));
    }
    return undefined;
  }

  /**
   * Apply aircraft-type performance specs to an Aircraft instance so its
   * physics match its real-world type.
   */
  private applyAircraftSpecs(ac: Aircraft): void {
    const spec = this.dataLoader.getAircraftSpec(ac.aircraftType);
    if (!spec) return;
    const p = spec.performance;
    ac.vrKts       = p.vr_kts;
    ac.v2Kts       = p.v2_kts;
    ac.vrefKts     = p.vref_kts;
    ac.accelKtps   = p.accel_rate_ktps ?? p.acceleration_kts_per_sec ?? 1.2;
    ac.decelKtps   = p.decel_rate_ktps ?? p.deceleration_kts_per_sec ?? 3.0;
    ac.taxiKts     = p.normal_taxi_speed_kts ?? p.taxi_speed_kts ?? 15;
    ac.climbFpm    = p.climb_rate_fpm;
    ac.descentFpm  = p.descent_rate_fpm;
    ac.bankRateDps = 12.0;                               // ground turning — always crisp
    ac.airBankDps  = p.bank_rate_deg_per_sec ?? 3.0;     // air bank rate from specs
  }

  private bearingTo(from: { lat: number; lon: number }, to: { lat: number; lon: number }): number {
    const lat1 = from.lat * Math.PI / 180;
    const lat2 = to.lat   * Math.PI / 180;
    const dLon = (to.lon - from.lon) * Math.PI / 180;
    const y = Math.sin(dLon) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  }
}
