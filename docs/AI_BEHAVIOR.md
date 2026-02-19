# AI Behavior — Spawn Logic, STAR/SID Routing, and Realistic Approach Directions

This document defines every behavior of the AI that controls non-player aircraft in the simulation: how they spawn, how they navigate, how they communicate, and how they respond to player instructions.

---

## 1. Geographic Realism — Approach Directions

### The Core Rule

**Aircraft MUST approach from the direction of their origin airport.** This is the most critical realism requirement.

A United flight from Newark does not come from the south. An American flight from Dallas does not approach from the east. Direction is determined by the **bearing from the origin airport to ORD**.

### Bearing Calculation

```javascript
/**
 * Returns the initial bearing from origin to destination (great-circle).
 * Origin → ORD (KORD) bearing determines spawn point and STAR assignment.
 */
function bearingToORD(originLat, originLon) {
  const ORD_LAT = 41.9802;
  const ORD_LON = -87.9090;
  return bearing(originLat, originLon, ORD_LAT, ORD_LON);
}
```

### Origin Airport → Spawn Bearing

| Origin ICAO | Origin City | Origin Coords | Bearing to ORD | Spawn Direction | STAR |
|---|---|---|---|---|---|
| KDFW | Dallas/Fort Worth | 32.90°N, 97.04°W | ~011° (NNE from DFW → arrives from S at ORD) | South (~190° bearing) | PAITN |
| KATL | Atlanta | 33.64°N, 84.43°W | ~353° (NNW from ATL → arrives from SE at ORD) | South-Southeast (~155°) | WYNDE |
| KMIA | Miami | 25.80°N, 80.29°W | ~347° (NNW from MIA → arrives from SSE) | South-Southeast (~170°) | WYNDE |
| KDEN | Denver | 39.86°N, 104.67°W | ~065° (ENE from DEN → arrives from WSW) | West-Southwest (~245°) | BENKY |
| KLAX | Los Angeles | 33.94°N, 118.41°W | ~055° (NE from LAX → arrives from WSW) | West-Southwest (~250°) | BENKY |
| KSEA | Seattle | 47.45°N, 122.31°W | ~103° (E from SEA → arrives from WNW) | West-Northwest (~290°) | BENKY |
| KEWR | Newark | 40.69°N, 74.17°W | ~273° (W from EWR → arrives from E) | East (~090°) | LEWKE |
| KJFK | New York JFK | 40.64°N, 73.78°W | ~271° (W from JFK → arrives from E) | East (~090°) | LEWKE |
| KBOS | Boston | 42.36°N, 71.00°W | ~273° (W from BOS → arrives from ENE) | East-Northeast (~080°) | WATSN |
| KDTW | Detroit | 42.21°N, 83.35°W | ~264° (W from DTW → arrives from E) | East (~095°) | LEWKE |
| KMSP | Minneapolis | 44.88°N, 93.22°W | ~165° (SSE from MSP → arrives from NNW) | North-Northwest (~330°) | SWAPP |
| KPHX | Phoenix | 33.43°N, 112.01°W | ~057° (NE from PHX → arrives from WSW) | West-Southwest (~250°) | BENKY |
| KLAS | Las Vegas | 36.08°N, 115.15°W | ~053° (NE from LAS → arrives from WSW) | West-Southwest (~250°) | BENKY |
| KIAH | Houston | 29.98°N, 95.34°W | ~015° (N from IAH → arrives from SSW) | South-Southwest (~195°) | PAITN |
| CYYZ | Toronto | 43.68°N, 79.63°W | ~261° (W from YYZ → arrives from ENE) | East-Northeast (~085°) | WATSN |

---

## 2. Spawn System

### Spawn Point Calculation

Aircraft spawn at the **50 nm ring** from ORD (KORD ARP: 41.9802°N, 87.9090°W).

```javascript
const NM_TO_DEG = 1 / 60;  // approximate at this latitude
const SPAWN_RADIUS_NM = 50;

function spawnPoint(approachBearing) {
  // approachBearing: the bearing FROM ORD TOWARD the aircraft's origin
  // The aircraft appears on the opposite side (approaching from that direction)
  const spawnBearing = (approachBearing + 180) % 360; // reciprocal
  const distDeg = SPAWN_RADIUS_NM * NM_TO_DEG;
  
  const lat = ORD_LAT + distDeg * Math.cos(toRad(spawnBearing));
  const lon = ORD_LON + distDeg * Math.sin(toRad(spawnBearing)) / Math.cos(toRad(ORD_LAT));
  
  return { lat, lon };
}
```

### Spawn Altitude and Speed

| Aircraft Category | Spawn Altitude | Spawn Speed |
|---|---|---|
| Widebody | 12,000–15,000 ft | 250 kts |
| Narrowbody | 10,000–12,000 ft | 250 kts |
| Regional jet | 8,000–10,000 ft | 230 kts |
| Turboprop | 6,000–8,000 ft | 200 kts |

### Spawn Rate (Traffic Levels)

| Level | Spawn Rate |
|---|---|
| Off-peak | 1 arrival every 8–12 minutes |
| Normal | 1 arrival every 4–6 minutes |
| Peak | 1 arrival every 2–3 minutes |
| Rush | 1 arrival every 90 seconds |

The simulation starts at **Normal** and ramps to **Peak** after 10 minutes.

---

## 3. STAR Assignment Logic

The AI assigns the correct STAR based on approach bearing:

```javascript
function assignSTAR(approachBearing) {
  // approachBearing: degrees (0-360), direction FROM which aircraft arrives
  // e.g., aircraft arriving FROM the south has approachBearing ≈ 180°
  
  if (approachBearing >= 340 || approachBearing < 040) return 'SWAPP';   // North
  if (approachBearing >= 040 && approachBearing < 120) return 'WATSN';   // NE-E
  if (approachBearing >= 120 && approachBearing < 145) return 'WATSN';   // ENE
  if (approachBearing >= 145 && approachBearing < 175) return 'WYNDE';   // SE-SSE
  if (approachBearing >= 175 && approachBearing < 210) return 'PAITN';   // S-SSW
  if (approachBearing >= 210 && approachBearing < 310) return 'BENKY';   // W-WSW-WNW
  if (approachBearing >= 310 && approachBearing < 340) return 'SWAPP';   // NNW
  return 'BENKY'; // default
}
```

---

## 4. STAR Route Following

### Waypoint Navigation

Each STAR is a sequence of named waypoints. The aircraft navigates from one to the next in order.

```javascript
class Aircraft {
  navigateToWaypoint() {
    if (!this.waypoints.length) return;
    
    const target = this.waypoints[0];
    const dist = distanceNm(this.lat, this.lon, target.lat, target.lon);
    
    if (dist < 0.1) {  // within 0.1 nm = captured waypoint
      this.waypoints.shift();
      if (!this.waypoints.length) {
        this.phase = 'AWAITING_APPROACH_CLEARANCE';
        this.radioRequest('Approach, [callsign] at [fix], requesting ILS [runway]');
      }
      return;
    }
    
    this.targetHeading = bearingTo(this.lat, this.lon, target.lat, target.lon);
  }
}
```

### PAITN STAR Waypoints (South Arrival)

Aircraft from Dallas, Atlanta, Houston arrive via PAITN:

```
PAITN (41.24°N, 87.93°W) at 7,000 ft → 
  VEECK (41.45°N, 87.93°W) at 6,000 ft →
    BAGEL (41.62°N, 87.93°W) at 5,000 ft →
      DENNT (41.75°N, 87.93°W) at 4,000 ft →
        EARND (41.85°N, 87.93°W) at 3,000 ft → 
          IAF → ILS Final
```

### BENKY STAR Waypoints (West Arrival)

Aircraft from Denver, LA, Las Vegas, Seattle arrive via BENKY:

```
BENKY (42.10°N, 88.95°W) at 10,000 ft →
  KUBBS (42.05°N, 88.55°W) at 8,000 ft →
    THUNE (42.00°N, 88.20°W) at 7,000 ft →
      PLANO (41.98°N, 88.05°W) at 5,000 ft →
        IAF → ILS Final
```

### LEWKE STAR Waypoints (East Arrival)

Aircraft from Newark, JFK, Detroit arrive via LEWKE:

```
LEWKE (42.05°N, 86.80°W) at 11,000 ft →
  PEOTONE (41.33°N, 87.80°W) at 9,000 ft →  [note: routes south then back]
    DENNT (41.75°N, 87.93°W) at 5,000 ft →
      IAF → ILS Final
```

### WYNDE STAR Waypoints (Southeast Arrival)

Aircraft from Atlanta, Miami arrive via WYNDE:

```
WYNDE (41.30°N, 87.40°W) at 8,000 ft →
  BAGEL (41.62°N, 87.93°W) at 6,000 ft →
    DENNT (41.75°N, 87.93°W) at 4,500 ft →
      IAF → ILS Final
```

### SWAPP STAR Waypoints (North Arrival)

Aircraft from Minneapolis arrive via SWAPP:

```
SWAPP (42.70°N, 87.90°W) at 9,000 ft →
  WAUKEGAN (42.42°N, 87.90°W) at 7,000 ft →
    OHARA (42.15°N, 87.92°W) at 5,000 ft →
      IAF → ILS Final
```

---

## 5. AI Radio Communication

The AI generates radio call text at each phase transition. These appear in the comms log.

### Arrival Script

| Phase | AI Radio Call |
|---|---|
| Spawn at 50 nm | "[Callsign], [type], [origin] with information Alpha, descending [altitude], request STAR [name]" |
| STAR entry | "[Callsign] entering STAR [name] at [fix], [altitude]" |
| IAF arrival | "[Callsign] at [IAF fix], requesting ILS runway [number]" |
| Approach clearance received | "[Callsign] ILS runway [number], [altitude] descending" |
| 3 nm final | "[Callsign] three mile final runway [number]" |
| Touchdown | "[Callsign] runway [number], clear at [taxiway]" |
| After exit | "[Callsign] requesting taxi to [terminal]" |

### Departure Script

| Phase | AI Radio Call |
|---|---|
| Gate | "[Callsign], gate [gate], requesting IFR clearance to [destination]" |
| IFR clearance received | "[Callsign] cleared to [dest], [SID], squawk [code], read back correct" |
| Push-back request | "[Callsign] ready for push-back and start, gate [gate]" |
| Push-back complete | "[Callsign] push-back complete, request taxi" |
| Taxi clearance received | "[Callsign] taxi [runway] via [route], read back correct" |
| At hold-short | "[Callsign] holding short runway [runway], ready for departure" |
| Takeoff clearance received | "[Callsign] cleared for takeoff runway [runway], rolling" |

---

## 6. AI Conflict Avoidance

When the AI detects it will violate separation, it takes defensive action:

### Approach Conflict (Two aircraft too close on final)
- The trailing aircraft extends its downwind leg by 1–2 minutes.
- Requests speed reduction from the player in the comms log.

### Ground Conflict (Two aircraft converging on taxiway)
- The aircraft with lower priority (later push-back) stops and waits.
- After 30 seconds, it requests alternative routing.

### Holding Stack Overflow (More than 3 aircraft in hold)
- AI requests player issue approach sequence.
- After 5 minutes without clearance: aircraft enters fuel emergency state (alert shown).

---

## 7. Departure AI Sequence

1. **IFR Clearance Request** — Aircraft at gate requests clearance. Player issues it.
2. **Push-Back Request** — After IFR clearance, AI requests push-back.
3. **Taxi Request** — After clear of gate area, AI requests taxi clearance.
4. **Hold-Short Notification** — AI reports holding short of runway.
5. **Departure Request** — AI reports ready for takeoff.
6. **Awaiting Clearance** — AI holds until player issues takeoff clearance.
7. **Departure** — Aircraft takes off, follows SID, exits at 50 nm.

---

## 8. Emergency Handling

The AI may randomly generate emergency scenarios for realism (configurable, default OFF):

| Emergency | Probability/Hour | AI Behavior |
|---|---|---|
| Medical emergency on approach | 1% | Requests priority landing, skips queue |
| Fuel emergency | 0.5% | Declares minimum fuel, requests immediate approach |
| Bird strike | 0.5% | Returns to airport, requests inspection before taxi to gate |
| Hydraulic issue | 0.3% | Requests longer runway (10R/28L or 04R/22L), emergency equipment standby |

Each emergency is announced on the radio with standard FAA phraseology.
