# Flight Dynamics — Speed, Altitude, and Movement Profiles

This document defines the exact performance envelope for all aircraft phases in the simulation. Every number is derived from publicly available manufacturer documentation and standard aviation operating procedures.

---

## Simulation Tick Rate

- **1 simulation tick = 1 second real time** (at 1× speed)
- At 2× speed: 1 second real time = 2 seconds simulated
- At 4× speed: 1 second real time = 4 seconds simulated
- Position, speed, altitude, and heading are updated every tick
- Pathfinding is recalculated when needed (new clearance, deviation)

---

## Phase 1 — Gate / Parking (PARKED)

| Parameter | Value |
|---|---|
| Speed | 0 kts |
| Altitude | Field elevation (668 ft MSL at ORD) |
| Heading | Fixed (parked orientation) |
| Transponder | STBY or Ground |

---

## Phase 2 — Push-Back (PUSHBACK)

| Parameter | Value |
|---|---|
| Speed | 3–5 kts (rearward) |
| Duration | ~2–5 minutes depending on gate type |
| Heading change | Nose rotates from gate orientation to taxiway heading |
| Engine status | One or both engines may start during pushback |

**Simulation model:**
```javascript
// pushback acceleration
if (phase === 'PUSHBACK') {
  speed = lerp(speed, 4, 0.05);  // smoothly reach 4 kts
  heading = rotateToward(heading, targetHeading, 2.0); // 2°/sec turn
}
```

---

## Phase 3 — Taxi (TAXI)

| Parameter | Narrowbody | Widebody | Regional Jet |
|---|---|---|---|
| Normal taxi speed | 15 kts | 12 kts | 15 kts |
| Max taxi speed | 20 kts | 18 kts | 20 kts |
| Speed on turn < 45° | 15 kts | 12 kts | 15 kts |
| Speed on turn 45–90° | 10 kts | 8 kts | 10 kts |
| Speed on turn > 90° | 5 kts | 4 kts | 5 kts |
| Acceleration rate | 1 kt/s | 0.8 kt/s | 1 kt/s |
| Deceleration rate | 3 kt/s | 2.5 kt/s | 3 kt/s |
| Stop distance at 15 kts | ~50 ft | ~80 ft | ~50 ft |

**Hold-short behavior:** Aircraft decelerates to 0 kts with 50 ft of clearance from hold-short line.

---

## Phase 4 — Takeoff Roll (TAKEOFF_ROLL)

V-speeds by aircraft type (from `data/aircraft_specs.json`):

| Aircraft | V1 (kts) | VR (kts) | V2 (kts) | Takeoff run (at MTOW, SL) |
|---|---|---|---|---|
| B737-800 | 138 | 142 | 148 | ~7,500 ft |
| B737 MAX 8 | 138 | 143 | 149 | ~7,300 ft |
| B757-200 | 147 | 152 | 158 | ~8,000 ft |
| B767-300ER | 155 | 161 | 167 | ~9,800 ft |
| B777-200ER | 160 | 167 | 174 | ~10,500 ft |
| B787-9 | 153 | 159 | 165 | ~10,000 ft |
| A319 | 130 | 135 | 140 | ~6,500 ft |
| A320 | 136 | 141 | 147 | ~7,100 ft |
| A321 | 146 | 151 | 157 | ~8,100 ft |
| A220-300 | 128 | 133 | 138 | ~6,200 ft |
| E175 | 125 | 130 | 135 | ~5,800 ft |
| CRJ-700 | 122 | 127 | 132 | ~5,500 ft |
| CRJ-900 | 126 | 131 | 136 | ~5,800 ft |
| Q400 | 105 | 110 | 115 | ~4,800 ft |

**Takeoff roll simulation:**
```javascript
// Simple physics model on runway
if (phase === 'TAKEOFF_ROLL') {
  const thrust = aircraftSpec.thrust_lbs;
  const drag = 0.02 * aircraftSpec.mtow_lbs;  // simplified
  const accel = (thrust - drag) / aircraftSpec.mtow_lbs * 32.174; // ft/s²
  speed += accel * dt;  // dt in seconds
  
  if (speed >= aircraftSpec.vr_kts) {
    phase = 'ROTATE';
  }
}
```

---

## Phase 5 — Rotation & Initial Climb (ROTATE / CLIMB)

| Parameter | Value |
|---|---|
| Pitch at rotation | 8–12° nose-up (aircraft type dependent) |
| Initial climb rate | 2,000–3,000 fpm |
| Climb speed (below 10,000 ft) | V2 + 10 → 250 kts (FAA limit below FL100) |
| Flap retraction schedule | Begin at V2 + 10, complete by 3,000 ft AGL |
| Gear retraction | 400 ft AGL |

**Altitude milestones during departure:**

| Altitude (ft MSL) | Speed | Action |
|---|---|---|
| 668 (field) | V2 | Wheels leave ground |
| 1,068 (400 ft AGL) | V2 + 10 | Gear up |
| 3,668 (3,000 ft AGL) | ~210 kts | Flaps retracted |
| 5,668 (5,000 ft AGL) | 250 kts | Accelerate toward 250 kts |
| 10,668 (10,000 ft AGL) | 250 kts | Accelerate to cruise climb speed |
| FL180 | ~280 kts IAS | Standard climb transition |
| FL350–FL390 | M0.82–M0.85 | Cruise |

---

## Phase 6 — Cruise (EN_ROUTE / APPROACHING)

Arriving aircraft enter the simulation at the 50 nm ring in cruise descent configuration:

| Aircraft | Initial Speed | Initial Altitude |
|---|---|---|
| Widebody (B777, B787, A350) | 250 kts | 10,000–15,000 ft |
| Narrowbody (B737, A320) | 250 kts | 10,000–12,000 ft |
| Regional jet (E175, CRJ) | 230 kts | 8,000–10,000 ft |
| Turboprop (Q400) | 200 kts | 6,000–8,000 ft |

---

## Phase 7 — Approach (APPROACH)

### Speed Schedule on Approach

| Distance from Threshold | Speed |
|---|---|
| 30 nm | 250 kts |
| 20 nm | 220 kts |
| 15 nm | 200 kts |
| 10 nm | 180 kts |
| Glide slope intercept (~8 nm) | 160–170 kts |
| Final approach fix (5 nm) | 150–160 kts |
| Short final (2 nm) | Vref + 5 |
| Threshold (0 nm) | Vref |

### Vref (Landing Reference Speed) by Aircraft

| Aircraft | Vref at MLW |
|---|---|
| B737-800 | 137 kts |
| B737 MAX 8 | 138 kts |
| B757-200 | 144 kts |
| B767-300ER | 147 kts |
| B777-200ER | 152 kts |
| B787-9 | 148 kts |
| A319 | 130 kts |
| A320 | 133 kts |
| A321 | 138 kts |
| A220-300 | 128 kts |
| E175 | 123 kts |
| CRJ-700 | 119 kts |
| CRJ-900 | 122 kts |
| Q400 | 107 kts |

### Glide Slope Descent Rate

At standard 3° glidepath:
```
Vertical Speed (fpm) = Ground Speed (kts) × 101.27 × tan(3°)
                     ≈ Ground Speed (kts) × 5.3

At 150 kts ground speed → ~795 fpm descent
At 160 kts ground speed → ~848 fpm descent
```

---

## Phase 8 — Landing Roll (LANDING_ROLL)

| Parameter | Value |
|---|---|
| Touchdown speed | Vref (see above) |
| Deceleration (normal) | 4–6 kt/s (using autobrake/spoilers/thrust reverser) |
| Runway exit speed | 20–30 kts at high-speed exits, 10–15 kts at 90° exits |
| Total landing roll at Vref 140 kts | ~5,500–7,000 ft depending on aircraft weight |

### High-Speed Exit Locations at ORD

Aircraft exit the runway at these taxiways (implemented in simulation):

| Runway | High-Speed Exit | Notes |
|---|---|---|
| 28R | Taxiway Bravo (right) | ~3,500 ft from threshold |
| 28R | Taxiway Golf | ~5,500 ft from threshold |
| 28C | Taxiway Golf | ~3,500 ft from threshold |
| 22L | Taxiway Lima | ~3,000 ft from threshold |

**Logic:** Aircraft selects the first available high-speed exit where its speed will be ≤ 30 kts.

---

## Phase 9 — Taxi to Gate (TAXI_IN)

After landing and runway exit:

| Parameter | Value |
|---|---|
| Speed | 12–15 kts |
| Route | Assigned by player or auto-assigned to nearest available gate |
| Duration | ~5–15 minutes depending on gate distance |

---

## Acceleration & Turn Model

### Turn Rate

Standard rate turn for jets = **3° per second** (standard rate turn = 180° in 60 seconds).

```javascript
// Heading interpolation
function updateHeading(current, target, speed_kts, dt_sec) {
  const turnRate = 3.0; // degrees per second (standard rate)
  const maxTurn = turnRate * dt_sec;
  const diff = ((target - current + 540) % 360) - 180; // shortest path
  const turn = Math.max(-maxTurn, Math.min(maxTurn, diff));
  return (current + turn + 360) % 360;
}
```

### Speed Interpolation

```javascript
function updateSpeed(current, target, accelRate, decelRate, dt_sec) {
  const rate = target > current ? accelRate : decelRate;
  const delta = rate * dt_sec;
  if (Math.abs(target - current) < delta) return target;
  return current + Math.sign(target - current) * delta;
}
```

### Altitude Interpolation

```javascript
function updateAltitude(current, target, climbRate, descentRate, dt_sec) {
  const rate = target > current ? climbRate : descentRate;
  const delta = (rate / 60) * dt_sec; // rate in fpm → ft/s
  if (Math.abs(target - current) < delta) return target;
  return current + Math.sign(target - current) * delta;
}
```

---

## Separation Minimums (ATC Standards)

### Ground Separation

| Situation | Minimum | Alert Threshold | Critical Threshold |
|---|---|---|---|
| Taxiing aircraft | 150 ft wingtip to wingtip | 200 ft | 100 ft |
| At runway hold-short | 250 ft from centerline | — | — |
| At gate / apron | Gate envelope (type-specific) | — | — |

### Airborne Separation

| Airspace | Horizontal | Vertical |
|---|---|---|
| Class B (< FL100) | 3 nm | 1,000 ft |
| Final approach | 3 nm (5 nm if heavy ahead) | N/A (same altitude) |
| Departure | 3 nm horizontal OR 1,000 ft vertical | — |

### Wake Turbulence Separation

| Lead Aircraft | Following Aircraft | Separation |
|---|---|---|
| Heavy (B777, B787, A350) | Any | 5 nm |
| Heavy | Heavy | 4 nm |
| B757 (special) | Any | 4 nm |
| Large (B737, A320) | Small (CRJ, E175) | 4 nm |
| Large | Large | 3 nm |
