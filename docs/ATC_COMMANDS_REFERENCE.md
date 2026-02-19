# ATC Commands Reference — Chicago O'Hare Simulator

This document defines every command the player can issue to aircraft, the exact syntax, expected aircraft read-back, and the simulation's resulting behavior. All commands follow FAA JO 7110.65 phraseology adapted for a game interface.

---

## Command Input Format

Commands are typed in the command bar in this general format:

```
[CALLSIGN] [COMMAND] [PARAMETERS]
```

- **CALLSIGN:** 3–7 character aircraft identifier (e.g., `UAL123`, `AAL456`, `SWA789`)
- **COMMAND:** Keyword(s) for the instruction
- **PARAMETERS:** Values such as runway, taxiway route, altitude, speed, heading

Commands are **case-insensitive**. Partial callsign matching is supported after at least 3 characters.

---

## Category 1 — IFR Clearance

Issued before pushback. Every departing aircraft must receive an IFR clearance before any ground movement.

### Command: `CLEARED IFR`

```
Syntax:   [CALLSIGN] CLEARED IFR [DESTINATION] DEPARTURE [SID_NAME] SQUAWK [SQUAWK_CODE]
Example:  UAL123 CLEARED IFR KDEN DEPARTURE BENKY TWO SQUAWK 4521

Read-back: "Cleared to Denver, Benky Two departure, squawk four-five-two-one, UAL123"
```

**Behavior:** Aircraft transponder code set. Aircraft will now request push-back.

---

## Category 2 — Push-Back / Engine Start

### Command: `PUSH BACK`

```
Syntax:   [CALLSIGN] PUSH BACK [FACE DIRECTION (optional)]
Example:  UAL123 PUSH BACK FACE EAST
Example:  AAL456 PUSH BACK

Read-back: "Push back approved, facing east, UAL123"
           "Push back approved, AAL456"
```

**Behavior:** Aircraft begins reversing from gate at 3–5 kts. Once clear of gate area, aircraft faces the assigned direction and requests taxi clearance.

---

## Category 3 — Taxi Clearance

### Command: `TAXI`

```
Syntax:   [CALLSIGN] TAXI [RUNWAY] VIA [TAXIWAY ROUTE]
Example:  UAL123 TAXI 28R VIA ALPHA BRAVO
Example:  UAL123 TAXI 28C VIA FOXTROT GOLF KILO

Read-back: "Taxi 28 Right via Alpha, Bravo, UAL123"
           "Taxi 28 Center via Foxtrot, Golf, Kilo, UAL123"
```

**Behavior:**
- The issued taxi route is drawn as a dotted line on the map.
- Aircraft begins taxiing at 15 kts along the specified taxiway sequence.
- Aircraft automatically slows to 5 kts at turns > 90°.
- Aircraft stops at every hold-short line and requests crossing clearance.

### Command: `TAXI CROSS RUNWAY`

```
Syntax:   [CALLSIGN] CROSS RUNWAY [RUNWAY_ID]
Example:  UAL123 CROSS RUNWAY 27L

Read-back: "Cross runway 27 Left, UAL123"
```

**Behavior:** Aircraft crosses the specified runway when clear. Only valid when the runway is not occupied.

### Command: `HOLD SHORT`

```
Syntax:   [CALLSIGN] HOLD SHORT [RUNWAY / TAXIWAY]
Example:  UAL123 HOLD SHORT RUNWAY 28R
Example:  AAL456 HOLD SHORT TAXIWAY BRAVO

Read-back: "Hold short runway 28 Right, UAL123"
```

**Behavior:** Aircraft stops at the hold-short line and does not proceed without further clearance.

---

## Category 4 — Runway Lineup

### Command: `LINE UP AND WAIT`

```
Syntax:   [CALLSIGN] LINE UP AND WAIT [RUNWAY]
Example:  UAL123 LINE UP AND WAIT 28R

Read-back: "Line up and wait, runway 28 Right, UAL123"
```

**Behavior:** Aircraft taxis onto the runway and holds at the hold line near the center/end of the runway. Transponder switches to ALT mode. Aircraft does NOT begin takeoff roll until takeoff clearance is received.

---

## Category 5 — Takeoff Clearance

### Command: `CLEARED FOR TAKEOFF`

```
Syntax:   [CALLSIGN] CLEARED FOR TAKEOFF [RUNWAY]
Example:  UAL123 CLEARED FOR TAKEOFF 28R
Example:  UAL123 CLEARED FOR TAKEOFF 28R FLY HEADING 290

Read-back: "Cleared for takeoff, runway 28 Right, UAL123"
           "Cleared for takeoff, runway 28 Right, fly heading 290, UAL123"
```

**Behavior:**
1. Aircraft begins takeoff roll, accelerating per `data/aircraft_specs.json` V-speed data.
2. Aircraft rotates at VR.
3. Aircraft climbs to SID initial altitude (typically 5,000 ft) at V2+10 kts.
4. If heading assigned, aircraft flies that heading instead of SID.
5. Speed restricted to 250 kts below 10,000 ft.

**Preconditions checked (command rejected if any fail):**
- Runway not occupied by another aircraft.
- No landing aircraft within 3 nm on approach.
- Aircraft is on the runway (not still at hold-short).

### Command: `CANCEL TAKEOFF CLEARANCE`

```
Syntax:   [CALLSIGN] CANCEL TAKEOFF CLEARANCE
Example:  UAL123 CANCEL TAKEOFF CLEARANCE

Read-back: "Wilco, stopping, UAL123"
```

**Behavior:** Aircraft aborts takeoff if still on the ground. Decelerates at maximum deceleration. If airborne, command is invalid.

---

## Category 6 — Approach Clearance

### Command: `EXPECT ILS APPROACH`

```
Syntax:   [CALLSIGN] EXPECT ILS APPROACH RUNWAY [RUNWAY]
Example:  UAL456 EXPECT ILS APPROACH RUNWAY 28R

Read-back: "Expect ILS approach runway 28 Right, UAL456"
```

**Behavior:** Aircraft prepares for ILS approach. No movement change yet, but runway is pre-assigned.

### Command: `ILS APPROACH CLEARED`

```
Syntax:   [CALLSIGN] ILS APPROACH CLEARED RUNWAY [RUNWAY]
Example:  UAL456 ILS APPROACH CLEARED RUNWAY 28R

Read-back: "ILS approach cleared runway 28 Right, UAL456"
```

**Behavior:**
1. Aircraft turns to intercept the ILS localizer.
2. Descends on the 3° glide slope.
3. Speed reduces from current to final approach speed (Vref + 5–10 kts).
4. Aircraft lands automatically at threshold, decelerates, and exits runway.

**Preconditions checked:**
- Runway not occupied.
- No conflicting arrival within 3 nm on same runway final.

### Command: `VISUAL APPROACH CLEARED`

```
Syntax:   [CALLSIGN] VISUAL APPROACH CLEARED RUNWAY [RUNWAY]
Example:  UAL456 VISUAL APPROACH CLEARED RUNWAY 28R

Read-back: "Visual approach cleared runway 28 Right, UAL456"
```

**Behavior:** Same as ILS but without glide slope coupling. Slightly more variation in descent angle (2.5°–3.5°).

---

## Category 7 — Speed Assignments

### Command: `REDUCE SPEED`

```
Syntax:   [CALLSIGN] REDUCE SPEED [SPEED] KNOTS
Example:  UAL456 REDUCE SPEED 180 KNOTS

Read-back: "Reducing to one-eight-zero knots, UAL456"
```

**Behavior:** Aircraft decelerates to the assigned speed. Must be within aircraft's current envelope.

### Command: `INCREASE SPEED`

```
Syntax:   [CALLSIGN] INCREASE SPEED [SPEED] KNOTS
Example:  UAL456 INCREASE SPEED 220 KNOTS

Read-back: "Increasing to two-two-zero knots, UAL456"
```

### Command: `MAINTAIN [SPEED]`

```
Syntax:   [CALLSIGN] MAINTAIN [SPEED] KNOTS
Example:  UAL456 MAINTAIN 250 KNOTS

Read-back: "Maintaining two-fifty knots, UAL456"
```

---

## Category 8 — Altitude Assignments

### Command: `DESCEND AND MAINTAIN`

```
Syntax:   [CALLSIGN] DESCEND AND MAINTAIN [ALTITUDE]
Example:  UAL456 DESCEND AND MAINTAIN 6000

Read-back: "Descending to six thousand, UAL456"
```

**Behavior:** Aircraft descends at ~1,500–2,500 fpm (depending on type) to assigned altitude.

### Command: `CLIMB AND MAINTAIN`

```
Syntax:   [CALLSIGN] CLIMB AND MAINTAIN [ALTITUDE]
Example:  UAL123 CLIMB AND MAINTAIN 10000

Read-back: "Climbing to ten thousand, UAL123"
```

---

## Category 9 — Heading Assignments

### Command: `FLY HEADING`

```
Syntax:   [CALLSIGN] FLY HEADING [HEADING]
Example:  UAL456 FLY HEADING 270

Read-back: "Fly heading two-seven-zero, UAL456"
```

**Behavior:** Aircraft turns to the assigned heading at its standard bank angle (25° for jets).

### Command: `TURN LEFT HEADING`

```
Syntax:   [CALLSIGN] TURN LEFT HEADING [HEADING]
Example:  UAL456 TURN LEFT HEADING 200

Read-back: "Turn left heading two hundred, UAL456"
```

### Command: `TURN RIGHT HEADING`

```
Syntax:   [CALLSIGN] TURN RIGHT HEADING [HEADING]
Example:  UAL456 TURN RIGHT HEADING 360

Read-back: "Turn right heading three-six-zero, UAL456"
```

---

## Category 10 — Holding Patterns

### Command: `HOLD`

```
Syntax:   [CALLSIGN] HOLD [FIX] [DIRECTION] INBOUND [HEADING] [LEG] MINUTES
Example:  UAL456 HOLD PAITN NORTHEAST INBOUND 220 1 MINUTE LEGS

Read-back: "Holding northeast of PAITN on 220 inbound, one-minute legs, UAL456"
```

**Behavior:**
- Aircraft flies to the holding fix.
- Enters the hold using standard entry procedure.
- Flies oval pattern: outbound 1 minute, turn, inbound 1 minute, turn.
- Maintains current altitude unless altitude is also assigned.
- Aircraft continues holding until cleared for approach or given further instructions.

### Command: `EXIT HOLDING`

```
Syntax:   [CALLSIGN] PROCEED DIRECT [FIX]
Example:  UAL456 PROCEED DIRECT MAAYO

Read-back: "Proceeding direct MAAYO, UAL456"
```

---

## Category 11 — Go-Around

### Command: `GO AROUND`

```
Syntax:   [CALLSIGN] GO AROUND [INSTRUCTIONS]
Example:  UAL456 GO AROUND FLY RUNWAY HEADING CLIMB TO 3000
Example:  UAL456 GO AROUND

Read-back: "Going around, runway heading, climbing to three thousand, UAL456"
```

**Behavior:**
1. Aircraft immediately adds full thrust.
2. Climbs at go-around pitch (~10°) to at least 2,000 ft AGL.
3. Follows published missed approach procedure unless specific heading/altitude assigned.
4. Aircraft re-enters traffic pattern.

---

## Category 12 — Landing Clearance

### Command: `CLEARED TO LAND`

```
Syntax:   [CALLSIGN] CLEARED TO LAND RUNWAY [RUNWAY]
Example:  AAL789 CLEARED TO LAND RUNWAY 28C

Read-back: "Cleared to land runway 28 Center, AAL789"
```

**Note:** `ILS APPROACH CLEARED` and `CLEARED TO LAND` together constitute a full landing clearance. `CLEARED TO LAND` is issued on final, inside 10 nm, once the runway is confirmed clear.

---

## Category 13 — Post-Landing Instructions

### Command: `EXIT RUNWAY` / `TURN`

```
Syntax:   [CALLSIGN] EXIT [DIRECTION] [TAXIWAY]
Example:  AAL789 EXIT RIGHT TAXIWAY GOLF

Read-back: "Exiting right on Golf, AAL789"
```

### Command: `CONTACT GROUND`

```
Syntax:   [CALLSIGN] CONTACT GROUND
Example:  AAL789 CONTACT GROUND

Read-back: "Contacting ground, AAL789"
```

**Behavior:** Aircraft switches from Tower to Ground frequency for taxi-to-gate instructions.

---

## Category 14 — Frequency / Handoff

### Command: `FREQUENCY CHANGE`

```
Syntax:   [CALLSIGN] FREQUENCY CHANGE APPROVED
Example:  UAL123 FREQUENCY CHANGE APPROVED

Read-back: "Frequency change approved, good day, UAL123"
```

**Behavior:** Aircraft exits the simulation or transitions to next controller.

---

## Error Messages

| Error | Trigger |
|---|---|
| `RUNWAY OCCUPIED — clearance denied` | Takeoff/landing clearance on occupied runway |
| `SEPARATION — aircraft on 3-mile final` | Takeoff clearance with arrival on final |
| `INVALID ROUTE — taxiway not connected` | Taxi route specifies disconnected taxiways |
| `AIRCRAFT NOT ON FREQUENCY` | Callsign not recognized or aircraft not under your control |
| `AIRSPEED LIMIT — cannot exceed 250 kts below FL100` | Speed assignment above limit |
| `HOLDING FIX NOT FOUND` | Hold command references unknown fix |

---

## Quick Reference Card

| Phase | Key Commands |
|---|---|
| Pre-departure | `CLEARED IFR`, `PUSH BACK` |
| Taxi | `TAXI [RWY] VIA [route]`, `HOLD SHORT`, `CROSS RUNWAY` |
| Runway | `LINE UP AND WAIT`, `CLEARED FOR TAKEOFF` |
| Departure | `CLIMB AND MAINTAIN`, `FLY HEADING`, `FREQUENCY CHANGE APPROVED` |
| Enroute (arrival) | `DESCEND AND MAINTAIN`, `REDUCE SPEED`, `HOLD`, `PROCEED DIRECT` |
| Approach | `EXPECT ILS APPROACH`, `ILS APPROACH CLEARED`, `CLEARED TO LAND` |
| Post-landing | `EXIT [dir] TAXIWAY [id]`, `CONTACT GROUND` |
| Emergency | `GO AROUND`, `CANCEL TAKEOFF CLEARANCE` |
