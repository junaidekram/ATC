/**
 * CommandParser
 *
 * Converts a raw text command string (typed by the player) into a structured
 * ParsedCommand object.  Returns null if the string cannot be matched to any
 * known command.
 *
 * The general format is:
 *   [CALLSIGN] [VERB ...] [PARAMETERS]
 *
 * All matching is case-insensitive.
 */

// ── Command type union ────────────────────────────────────────────────────────

export type ParsedCommand =
  | { type: 'CLEARED_IFR';        callsign: string; destination: string; sid?: string; squawk?: number }
  | { type: 'PUSH_BACK';          callsign: string; faceDirection?: string; faceHeading?: number }
  | { type: 'TAXI';               callsign: string; runway: string; via: string[] }
  | { type: 'CROSS_RUNWAY';       callsign: string; runway: string }
  | { type: 'HOLD_SHORT';         callsign: string; pointType: 'runway' | 'taxiway'; pointId: string }
  | { type: 'HOLD_POSITION';       callsign: string }
  | { type: 'LINE_UP_AND_WAIT';   callsign: string; runway: string }
  | { type: 'CLEARED_TAKEOFF';    callsign: string; runway: string; flyHeading?: number }
  | { type: 'CANCEL_TAKEOFF';     callsign: string }
  | { type: 'EXPECT_ILS';         callsign: string; runway: string }
  | { type: 'ILS_CLEARED';        callsign: string; runway: string }
  | { type: 'VISUAL_CLEARED';     callsign: string; runway: string }
  | { type: 'CLEARED_LAND';       callsign: string; runway: string }
  | { type: 'REDUCE_SPEED';       callsign: string; speed: number }
  | { type: 'INCREASE_SPEED';     callsign: string; speed: number }
  | { type: 'MAINTAIN_SPEED';     callsign: string; speed: number }
  | { type: 'DESCEND_MAINTAIN';   callsign: string; altitude: number }
  | { type: 'CLIMB_MAINTAIN';     callsign: string; altitude: number }
  | { type: 'FLY_HEADING';        callsign: string; heading: number; direction?: 'left' | 'right' }
  | { type: 'HOLD_PATTERN';       callsign: string; fix: string }
  | { type: 'PROCEED_DIRECT';     callsign: string; fix: string }
  | { type: 'GO_AROUND';          callsign: string; flyHeading?: number; climbTo?: number }
  | { type: 'EXIT_RUNWAY';        callsign: string; direction?: string; taxiway?: string }
  | { type: 'CONTACT_GROUND';     callsign: string }
  | { type: 'FREQUENCY_CHANGE';   callsign: string }
  | { type: 'RESUME_NAV';          callsign: string };

// ── Cardinal directions ───────────────────────────────────────────────────────

const CARDINAL_HEADINGS: Record<string, number> = {
  NORTH: 360, NORTHEAST: 45, EAST: 90, SOUTHEAST: 135,
  SOUTH: 180, SOUTHWEST: 225, WEST: 270, NORTHWEST: 315,
};

// ── Parser ────────────────────────────────────────────────────────────────────

export class CommandParser {
  /**
   * Parse a raw command string into a ParsedCommand.
   * Returns null if nothing matches.
   */
  parse(raw: string): ParsedCommand | null {
    const tokens = raw.trim().toUpperCase().split(/\s+/);
    if (tokens.length < 2) return null;

    const callsign = tokens[0];
    const rest     = tokens.slice(1);

    // ── IFR clearance ──────────────────────────────────────────────────────
    // UAL123 CLEARED IFR KDEN DEPARTURE BENKY TWO SQUAWK 4521
    if (rest[0] === 'CLEARED' && rest[1] === 'IFR') {
      const dest     = rest[2] ?? '';
      const sqIdx    = rest.indexOf('SQUAWK');
      const squawk   = sqIdx >= 0 ? parseInt(rest[sqIdx + 1], 10) : undefined;
      const depIdx   = rest.indexOf('DEPARTURE');
      const sid      = depIdx >= 0 && sqIdx > depIdx
        ? rest.slice(depIdx + 1, sqIdx < 0 ? undefined : sqIdx).join(' ')
        : undefined;
      return { type: 'CLEARED_IFR', callsign, destination: dest, sid, squawk };
    }

    // ── Push back ──────────────────────────────────────────────────────────
    // UAL123 PUSH BACK [FACE EAST | FACE 090]
    if (rest[0] === 'PUSH' && rest[1] === 'BACK') {
      const faceIdx = rest.indexOf('FACE');
      if (faceIdx >= 0) {
        const faceToken = rest[faceIdx + 1];
        if (CARDINAL_HEADINGS[faceToken] !== undefined) {
          return { type: 'PUSH_BACK', callsign, faceDirection: faceToken, faceHeading: CARDINAL_HEADINGS[faceToken] };
        }
        const numeric = parseInt(faceToken, 10);
        if (!isNaN(numeric)) {
          return { type: 'PUSH_BACK', callsign, faceHeading: numeric };
        }
      }
      return { type: 'PUSH_BACK', callsign };
    }

    // ── Taxi ───────────────────────────────────────────────────────────────
    // UAL123 TAXI 28R VIA ALPHA BRAVO
    if (rest[0] === 'TAXI' && rest[1] !== 'CROSS') {
      const runway = rest[1] ?? '';
      const viaIdx = rest.indexOf('VIA');
      const via    = viaIdx >= 0 ? rest.slice(viaIdx + 1) : [];
      return { type: 'TAXI', callsign, runway, via };
    }

    // ── Cross runway ───────────────────────────────────────────────────────
    // UAL123 CROSS RUNWAY 27L
    if ((rest[0] === 'CROSS' && rest[1] === 'RUNWAY') ||
        (rest[0] === 'TAXI'  && rest[1] === 'CROSS' && rest[2] === 'RUNWAY')) {
      const rwyIdx = rest.indexOf('RUNWAY');
      const runway = rest[rwyIdx + 1] ?? '';
      return { type: 'CROSS_RUNWAY', callsign, runway };
    }

    // ── Hold short ─────────────────────────────────────────────────────────
    // UAL123 HOLD SHORT RUNWAY 28R   |  UAL123 HOLD SHORT TAXIWAY BRAVO
    // UAL123 HOLD POSITION
    if (rest[0] === 'HOLD' && rest[1] === 'POSITION') {
      return { type: 'HOLD_POSITION', callsign };
    }

    if (rest[0] === 'HOLD' && rest[1] === 'SHORT') {
      const pointType = rest[2] === 'RUNWAY' ? 'runway' : 'taxiway';
      const pointId   = rest[3] ?? '';
      return { type: 'HOLD_SHORT', callsign, pointType, pointId };
    }

    // ── Line up and wait ───────────────────────────────────────────────────
    // UAL123 LINE UP AND WAIT 28R
    if (rest[0] === 'LINE' && rest[1] === 'UP') {
      const runway = rest[rest.length - 1];
      return { type: 'LINE_UP_AND_WAIT', callsign, runway };
    }

    // ── Cleared for takeoff ────────────────────────────────────────────────
    // UAL123 CLEARED FOR TAKEOFF 28R [FLY HEADING 290]
    if (rest[0] === 'CLEARED' && rest[1] === 'FOR' && rest[2] === 'TAKEOFF') {
      const runway  = rest[3] ?? '';
      const hdgIdx  = rest.indexOf('HEADING');
      const flyHdg  = hdgIdx >= 0 ? parseInt(rest[hdgIdx + 1], 10) : undefined;
      return { type: 'CLEARED_TAKEOFF', callsign, runway, flyHeading: isNaN(flyHdg ?? NaN) ? undefined : flyHdg };
    }

    // ── Cancel takeoff ─────────────────────────────────────────────────────
    // UAL123 CANCEL TAKEOFF CLEARANCE
    if (rest[0] === 'CANCEL' && rest[1] === 'TAKEOFF') {
      return { type: 'CANCEL_TAKEOFF', callsign };
    }

    // ── Expect ILS approach ────────────────────────────────────────────────
    // UAL456 EXPECT ILS APPROACH RUNWAY 28R
    if (rest[0] === 'EXPECT' && rest[1] === 'ILS') {
      const rwyIdx = rest.indexOf('RUNWAY');
      const runway = rest[rwyIdx + 1] ?? rest[rest.length - 1];
      return { type: 'EXPECT_ILS', callsign, runway };
    }

    // ── ILS approach cleared ───────────────────────────────────────────────
    // UAL456 ILS APPROACH CLEARED RUNWAY 28R
    if (rest[0] === 'ILS' && rest[1] === 'APPROACH' && rest[2] === 'CLEARED') {
      const rwyIdx = rest.indexOf('RUNWAY');
      const runway = rwyIdx >= 0 ? rest[rwyIdx + 1] : rest[rest.length - 1];
      return { type: 'ILS_CLEARED', callsign, runway };
    }

    // ── Visual approach cleared ────────────────────────────────────────────
    // UAL456 VISUAL APPROACH CLEARED RUNWAY 28R
    if (rest[0] === 'VISUAL' && rest[1] === 'APPROACH' && rest[2] === 'CLEARED') {
      const rwyIdx = rest.indexOf('RUNWAY');
      const runway = rwyIdx >= 0 ? rest[rwyIdx + 1] : rest[rest.length - 1];
      return { type: 'VISUAL_CLEARED', callsign, runway };
    }

    // ── Cleared to land ────────────────────────────────────────────────────
    // AAL789 CLEARED TO LAND RUNWAY 28C
    if (rest[0] === 'CLEARED' && rest[1] === 'TO' && rest[2] === 'LAND') {
      const rwyIdx = rest.indexOf('RUNWAY');
      const runway = rwyIdx >= 0 ? rest[rwyIdx + 1] : rest[rest.length - 1];
      return { type: 'CLEARED_LAND', callsign, runway };
    }

    // ── Speed commands ─────────────────────────────────────────────────────
    if (rest[0] === 'REDUCE' && rest[1] === 'SPEED') {
      return { type: 'REDUCE_SPEED', callsign, speed: parseInt(rest[2], 10) };
    }
    if (rest[0] === 'INCREASE' && rest[1] === 'SPEED') {
      return { type: 'INCREASE_SPEED', callsign, speed: parseInt(rest[2], 10) };
    }
    if (rest[0] === 'MAINTAIN' && rest[rest.length - 1] === 'KNOTS') {
      return { type: 'MAINTAIN_SPEED', callsign, speed: parseInt(rest[1], 10) };
    }

    // ── Altitude commands ──────────────────────────────────────────────────
    if (rest[0] === 'DESCEND' && rest[1] === 'AND' && rest[2] === 'MAINTAIN') {
      return { type: 'DESCEND_MAINTAIN', callsign, altitude: parseInt(rest[3], 10) };
    }
    if (rest[0] === 'CLIMB' && rest[1] === 'AND' && rest[2] === 'MAINTAIN') {
      return { type: 'CLIMB_MAINTAIN', callsign, altitude: parseInt(rest[3], 10) };
    }

    // ── Heading commands ───────────────────────────────────────────────────
    if (rest[0] === 'FLY' && rest[1] === 'HEADING') {
      return { type: 'FLY_HEADING', callsign, heading: parseInt(rest[2], 10) };
    }
    if (rest[0] === 'TURN' && rest[1] === 'LEFT' && rest[2] === 'HEADING') {
      return { type: 'FLY_HEADING', callsign, heading: parseInt(rest[3], 10), direction: 'left' };
    }
    if (rest[0] === 'TURN' && rest[1] === 'RIGHT' && rest[2] === 'HEADING') {
      return { type: 'FLY_HEADING', callsign, heading: parseInt(rest[3], 10), direction: 'right' };
    }

    // ── Go around ──────────────────────────────────────────────────────────
    // UAL456 GO AROUND [FLY RUNWAY HEADING | CLIMB TO 3000]
    if (rest[0] === 'GO' && rest[1] === 'AROUND') {
      const hdgIdx  = rest.indexOf('HEADING');
      const cliIdx  = rest.indexOf('TO');
      const flyHdg  = hdgIdx >= 0 ? parseInt(rest[hdgIdx + 1], 10) : undefined;
      const climbTo = cliIdx  >= 0 ? parseInt(rest[cliIdx  + 1], 10) : undefined;
      return {
        type: 'GO_AROUND',
        callsign,
        flyHeading: isNaN(flyHdg  ?? NaN) ? undefined : flyHdg,
        climbTo:    isNaN(climbTo ?? NaN) ? undefined : climbTo,
      };
    }

    // ── Hold pattern ───────────────────────────────────────────────────────
    if (rest[0] === 'HOLD' && rest[1] !== 'SHORT') {
      const fix = rest[1] ?? '';
      return { type: 'HOLD_PATTERN', callsign, fix };
    }

    // ── Proceed direct ─────────────────────────────────────────────────────
    if (rest[0] === 'PROCEED' && rest[1] === 'DIRECT') {
      return { type: 'PROCEED_DIRECT', callsign, fix: rest[2] ?? '' };
    }

    // ── Exit runway ────────────────────────────────────────────────────────
    // AAL789 EXIT RIGHT TAXIWAY GOLF | AAL789 EXIT LEFT B
    if (rest[0] === 'EXIT') {
      const direction = (rest[1] === 'LEFT' || rest[1] === 'RIGHT') ? rest[1].toLowerCase() : undefined;
      const twIdx     = rest.indexOf('TAXIWAY');
      const twName    = twIdx >= 0 ? rest[twIdx + 1] : (direction ? rest[2] : rest[1]);
      return { type: 'EXIT_RUNWAY', callsign, direction, taxiway: twName };
    }

    // ── Resume nav (exit holding) ──────────────────────────────────────────
    if ((rest[0] === 'RESUME' && rest[1] === 'NAV') || rest[0] === 'RESUME_NAV') {
      return { type: 'RESUME_NAV', callsign };
    }

    // ── Contact ground ─────────────────────────────────────────────────────
    if (rest[0] === 'CONTACT' && rest[1] === 'GROUND') {
      return { type: 'CONTACT_GROUND', callsign };
    }

    // ── Frequency change ───────────────────────────────────────────────────
    if (rest[0] === 'FREQUENCY' && rest[1] === 'CHANGE') {
      return { type: 'FREQUENCY_CHANGE', callsign };
    }

    // ── Resume nav / exit holding ───────────────────────────────────────────
    if (rest[0] === 'RESUME' && (rest[1] === 'NAV' || rest[1] === 'NAVIGATION')) {
      return { type: 'RESUME_NAV', callsign };
    }

    return null;
  }
}
