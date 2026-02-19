# Traffic Management — Queues, Separation, and Flow Control

This document describes how traffic is managed in the simulation: how aircraft are queued, how separation is enforced, and how the player manages throughput.

---

## 1. Traffic Volume Reference

### Real-World ORD Operations

| Period | Arrivals/Hour | Departures/Hour | Total Ops/Hour |
|---|---|---|---|
| Off-peak (0200–0600 local) | 5–10 | 5–10 | 10–20 |
| Morning build (0600–0800) | 25–35 | 25–35 | 50–70 |
| Morning peak (0800–1000) | 40–50 | 40–50 | 80–100 |
| Midday (1000–1400) | 30–40 | 30–40 | 60–80 |
| Afternoon peak (1500–1800) | 45–55 | 45–55 | 90–110 |
| Evening (1800–2200) | 35–45 | 35–45 | 70–90 |
| Night (2200–0200) | 10–20 | 10–20 | 20–40 |

### Simulation Initial State

At simulation start (representing morning peak, 0800–0900 local):

| Location | Count |
|---|---|
| At gates (departing) | 20–25 |
| Taxiing to runway | 5–8 |
| Holding at runway | 2–3 |
| On final approach (< 20 nm) | 6–10 |
| In TRACON (20–50 nm) | 8–12 |
| **Total active aircraft** | **40–58** |

---

## 2. Departure Queue

### Queue Order Logic

Departures are queued in this priority:
1. **Scheduled departure time** — earlier scheduled time = higher priority
2. **Fuel state** — aircraft with minimum fuel declared get priority
3. **Gate area** — aircraft that have been at the gate longest
4. **Airline priority** — (optional) hub carrier given slot preference

### Departure Sequence Example

At 0800 simulation time, a realistic departure queue:

| Position | Callsign | Type | Gate | Destination | Requested RWY | Status |
|---|---|---|---|---|---|---|
| 1 | UAL123 | B737-800 | K6 | KDEN | 28R | Pushing back |
| 2 | AAL456 | A321 | H7 | KDFW | 28C | Taxiing Alpha |
| 3 | SWA789 | B737-800 | T6 | KMDW | 28L | Ready at gate |
| 4 | DAL210 | B767-300ER | H12 | KATL | 28R | Taxiing Bravo |
| 5 | UAL301 | B787-9 | C19 | KLAX | 28C | IFR clearance |
| 6 | AAL512 | A320 | H4 | KJFK | 28R | At gate |

### Departure Rate

Maximum sustainable departure rate at ORD (west flow):
- 28R + 28C + 27L simultaneously: **~50 departures/hour**
- Minimum runway occupancy time per departure: ~60–90 seconds

---

## 3. Arrival Queue

### TRACON Flow Sequencing

Arriving aircraft are assigned a sequence number (STN — Sequence Time Number) by the AI. The player can swap positions in the arrival queue by issuing hold or direct-to instructions.

### Arrival Spacing Target

- **Final approach spacing:** 3.0 nm minimum, 4.0 nm standard, 5.0 nm after heavy
- **Traffic Management Unit (TMU) target:** Aircraft cross the outer fix at 250 kts, 1 minute apart

### Arrival Feed from All Directions

At a peak 0800 scenario, arrivals come from these directions simultaneously:

| Callsign | Airline | Type | Origin | Bearing to ORD | STAR | ETA |
|---|---|---|---|---|---|---|
| UAL421 | United | B787-9 | KEWR | 095° (E) | LEWKE | +8 min |
| DAL892 | Delta | A321 | KATL | 155° (SSE) | WYNDE | +12 min |
| AAL202 | American | B737-800 | KDFW | 190° (S) | PAITN | +15 min |
| SWA1144 | Southwest | B737-800 | KLAS | 250° (W) | BENKY | +10 min |
| UAL1502 | United | B777-200ER | KLAX | 250° (W) | BENKY | +18 min |
| MSK302 | Alaska | B737-900 | KSEA | 290° (WNW) | BENKY | +22 min |
| DAL1234 | Delta | A220-300 | KDTW | 095° (E) | LEWKE | +6 min |
| AAL891 | American | B757-200 | KMIA | 170° (SSE) | WYNDE | +20 min |
| SWA201 | Southwest | B737-800 | KDEN | 245° (WSW) | BENKY | +14 min |
| UAL600 | United | A320 | KBOS | 080° (ENE) | WATSN | +9 min |

---

## 4. Runway Assignment Logic

### West Flow (28s Active — Most Common)

When winds are from the west (270° ± 60°):

| Runway | Preferred Use | Aircraft Types |
|---|---|---|
| 28R | Primary arrivals | All types |
| 28C | Primary arrivals | All types |
| 28L | Secondary arrivals | Narrowbody only |
| 27R | Secondary arrivals | All types |
| 27L | Primary departures | All types |
| 09L | Primary departures | All types (long runway preferred for heavy) |

### East Flow (10s Active — Less Common)

When winds are from the east (090° ± 60°):

| Runway | Preferred Use |
|---|---|
| 10L | Primary arrivals |
| 10C | Primary arrivals |
| 10R | Secondary arrivals |
| 09R | Primary departures |
| 04R | Secondary departures (heavy) |

### Runway Assignment Rules

1. **Never assign a runway that is occupied** by another aircraft or has not been cleared.
2. **Wake turbulence pairing**: Do not assign a narrowbody immediately after a heavy on the same runway until 5 nm separation.
3. **Opposite direction prohibition**: Never clear aircraft in opposite directions on the same or parallel runways simultaneously without coordination.
4. **Minimum occupancy time**: After a landing, runway is blocked for at least 60 seconds.

---

## 5. Holding Pattern Management

When the arrival queue exceeds approach capacity, aircraft must hold.

### Default Holding Fixes at ORD

| Fix | Location | Altitude | Usage |
|---|---|---|---|
| PAITN | 41.24°N, 87.93°W (South) | 7,000–9,000 ft | South flow backup |
| BENKY | 42.10°N, 88.95°W (West) | 7,000–10,000 ft | West flow backup |
| LEWKE | 42.05°N, 86.80°W (East) | 8,000–10,000 ft | East flow backup |
| SWAPP | 42.70°N, 87.90°W (North) | 6,000–8,000 ft | North flow backup |

### Holding Stack

Multiple aircraft can hold at the same fix at different altitudes, 1,000 ft apart:
- Aircraft 1: 9,000 ft
- Aircraft 2: 8,000 ft
- Aircraft 3: 7,000 ft

When the lowest aircraft is cleared for approach, all aircraft descend 1,000 ft.

---

## 6. Ground Traffic Flow

### Typical Taxi Routes at ORD (West Flow)

**Terminal 1 (K gates) departing to 28R:**
```
K gate → Taxiway Alpha → Taxiway Bravo → Runway 28R hold-short
```

**Terminal 2 (H gates) departing to 28C:**
```
H gate → Taxiway Alpha → Taxiway Foxtrot → Runway 28C hold-short
```

**Terminal 3 (F/G gates) departing to 28R:**
```
F/G gate → Taxiway Foxtrot → Taxiway Bravo → Runway 28R hold-short
```

**After landing 28R, taxi to Terminal 1:**
```
High-speed exit Taxiway Bravo → Taxiway Alpha → K gate
```

**After landing 28C, taxi to Terminal 2:**
```
High-speed exit Taxiway Golf → Taxiway Foxtrot → Taxiway Alpha → H gate
```

### Hotspot Avoidance

The simulation must route aircraft around known hotspots when possible. If a hotspot crossing is unavoidable, flag it with a visual warning during the crossing.

---

## 7. Flow Rate Controls

### Ground Delay Program (GDP) — Player Option

If the arrival queue becomes too long, the player can activate a Ground Delay Program:
- Pauses spawning of new arriving aircraft for a configurable duration.
- Existing en-route aircraft hold at their entry fix.
- Gives player time to recover the sequence.

### Miles-in-Trail (MIT) Restriction

Player can issue a "miles-in-trail" restriction on a STAR to spread arrivals:
```
PAITN STAR — APPLY 10 MILES IN TRAIL
```
This delays spawning of successive aircraft on that STAR until the required spacing is achieved.

---

## 8. Separation Alert System

### Color Coding

| Color | Meaning |
|---|---|
| Green | Normal, separation maintained |
| Yellow/Amber | Advisory — separation below recommended |
| Orange | Warning — approaching minimum separation |
| Red | Violation — separation below minimum |
| Flashing red | Critical — imminent collision risk |

### Alert Panel

When a separation event occurs, the alert panel displays:
```
[AMBER] UAL123 / AAL456 — 2.1 nm separation on final (minimum 3.0 nm)
[RED]   DAL789 / SWA101 — RUNWAY INCURSION — 28R
```

---

## 9. Scoring Model

| Event | Points |
|---|---|
| Aircraft departs on time (±5 min) | +10 |
| Aircraft lands without hold | +15 |
| Aircraft holds (player-ordered, necessary) | 0 |
| Aircraft holds (avoidable) | -5 |
| Ground separation violation (amber) | -10 |
| Ground separation violation (red) | -25 |
| Runway incursion (near miss) | -50 |
| Collision | -200 |
| Go-around (player-ordered, necessary) | 0 |
| Go-around (avoidable, runway clear) | -20 |
| Perfect peak hour (40 aircraft, 0 violations) | +500 bonus |
