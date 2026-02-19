# Requirements Specification — ATC Simulator (KORD)

Version 1.0 | Airport: Chicago O'Hare International (KORD)

---

## 1. Functional Requirements

### 1.1 Map & Airport Layout

| ID | Requirement |
|---|---|
| F-MAP-01 | The system SHALL render the ORD airport diagram using OpenStreetMap data at the correct geographic coordinates (centered at 41.9802° N, 87.9090° W). |
| F-MAP-02 | All seven active ORD runway pairs SHALL be rendered as polygons with correct orientation, length, and width. |
| F-MAP-03 | Each runway threshold SHALL display the correct runway number (e.g., "28R", "10L"). |
| F-MAP-04 | The system SHALL render all primary ORD taxiways (A, B, C, F, G, H, J, K, L, M, N, P, Q, R) as polylines with correct labels. |
| F-MAP-05 | Terminal buildings and gate positions SHALL be rendered as reference markers. |
| F-MAP-06 | The system SHALL support zoom from a 50 nm radius overview down to a 0.25 nm gate-level detail. |
| F-MAP-07 | ILS approach paths SHALL be visualized as a cone extending 10 nm from the runway threshold at the correct localizer heading. |
| F-MAP-08 | STAR route waypoints SHALL be displayed as toggleable overlays. |
| F-MAP-09 | SID route waypoints SHALL be displayed as toggleable overlays. |
| F-MAP-10 | The map SHALL display a compass rose and scale bar. |

### 1.2 Aircraft & Flight Data

| ID | Requirement |
|---|---|
| F-AC-01 | The system SHALL support the following aircraft types: B737-800, B737 MAX 8, B757-200, B767-300ER, B777-200ER, B787-9, A319, A320, A321, A220-300, E175, CRJ-700, CRJ-900, Q400. |
| F-AC-02 | Each aircraft SHALL carry: callsign, airline, origin ICAO, destination ICAO, aircraft type, current position (lat/lon), current altitude (ft), current speed (kts), current heading (°), flight phase, assigned runway, assigned taxi route. |
| F-AC-03 | Each aircraft SHALL appear on the map as a directional icon whose nose points in the direction of current heading. |
| F-AC-04 | Aircraft labels SHALL display: callsign, speed (kts), altitude (ft), and flight phase. |
| F-AC-05 | Clicking an aircraft SHALL open a detail panel showing all fields from F-AC-02 plus origin city, destination city, and ETA. |
| F-AC-06 | Aircraft SHALL use the performance data from `data/aircraft_specs.json` for all speed, altitude, and acceleration calculations. |

### 1.3 ATC Command System

| ID | Requirement |
|---|---|
| F-CMD-01 | The player SHALL be able to issue commands using a text input bar in the format defined in `docs/ATC_COMMANDS_REFERENCE.md`. |
| F-CMD-02 | The command parser SHALL accept case-insensitive input and autocomplete callsigns. |
| F-CMD-03 | Every command issued by the player SHALL produce a read-back from the aircraft in the comms log. |
| F-CMD-04 | The system SHALL support all command categories: IFR clearance, push-back, taxi, lineup, takeoff, approach, landing, go-around, hold, speed/altitude assignments, frequency change. |
| F-CMD-05 | Taxi routes SHALL be drawn on the map as an animated dotted line when clearance is issued. |
| F-CMD-06 | The issued taxi route SHALL follow valid taxiway graph edges from `data/ord_taxiways.json`. |
| F-CMD-07 | Invalid commands (e.g., cleared for takeoff on occupied runway) SHALL produce an error message and NOT execute. |

### 1.4 Ground Movement

| ID | Requirement |
|---|---|
| F-GND-01 | Aircraft SHALL taxi at 10–20 knots along assigned taxiway centerlines. |
| F-GND-02 | Aircraft SHALL slow to 5 knots when making turns > 90°. |
| F-GND-03 | Aircraft SHALL stop at hold-short lines until cleared to cross or enter the runway. |
| F-GND-04 | Aircraft SHALL not enter a runway without explicit player clearance. |
| F-GND-05 | Two aircraft SHALL not occupy the same taxiway segment simultaneously (conflict detection). |
| F-GND-06 | The system SHALL detect and flag runway incursions in real time. |

### 1.5 Takeoff

| ID | Requirement |
|---|---|
| F-TO-01 | Takeoff clearance SHALL require: aircraft at hold-short or runway entry point, runway not occupied. |
| F-TO-02 | On clearance, aircraft SHALL accelerate from 0 to VR (rotation speed) based on aircraft type and runway length. |
| F-TO-03 | Aircraft SHALL rotate and begin climb at the correct VR for its type (see `data/aircraft_specs.json`). |
| F-TO-04 | Aircraft SHALL climb at the correct initial climb rate and follow the assigned SID if specified. |
| F-TO-05 | Aircraft SHALL accelerate to no more than 250 kts below 10,000 ft MSL. |
| F-TO-06 | Aircraft SHALL exit the simulation area after reaching the departure fix or 50 nm radius. |

### 1.6 Approach & Landing

| ID | Requirement |
|---|---|
| F-LND-01 | Arriving aircraft SHALL spawn at the 50 nm ring at the bearing corresponding to their origin airport. |
| F-LND-02 | Arriving aircraft SHALL initially fly at 10,000–15,000 ft and 250 kts. |
| F-LND-03 | Arriving aircraft SHALL follow the assigned STAR waypoints toward the IAF (Initial Approach Fix). |
| F-LND-04 | The player SHALL assign an ILS approach clearance, specifying the runway. |
| F-LND-05 | On approach clearance, aircraft SHALL descend on the 3° glide slope at the correct final approach speed for their type. |
| F-LND-06 | Aircraft SHALL cross the runway threshold at the correct Vref speed (see `data/aircraft_specs.json`). |
| F-LND-07 | After touchdown, aircraft SHALL decelerate and exit at the first available high-speed taxiway. |
| F-LND-08 | Aircraft with no landing clearance within 3 nm of threshold SHALL initiate an automatic go-around. |

### 1.7 AI Behavior

| ID | Requirement |
|---|---|
| F-AI-01 | AI SHALL spawn arriving aircraft at the 50 nm boundary at a rate consistent with ORD's real-world operations (~80–100 arrivals per hour at peak). |
| F-AI-02 | AI SHALL spawn departing aircraft at gates on a schedule loaded from `data/sample_flights.json`. |
| F-AI-03 | Arriving AI aircraft SHALL request IFR clearance by radio before player interacts. |
| F-AI-04 | AI aircraft SHALL hold at waypoints or enter holding patterns if no clearance is given within a configurable timeout. |
| F-AI-05 | AI SHALL pick the correct STAR based on the bearing from the aircraft's origin. |

### 1.8 Separation & Safety

| ID | Requirement |
|---|---|
| F-SEP-01 | Ground separation minimum: 150 ft between aircraft on taxiways (alert), 50 ft (critical). |
| F-SEP-02 | Runway separation: only one aircraft on runway at a time. |
| F-SEP-03 | Approach separation: 3 nm minimum between aircraft on final approach. |
| F-SEP-04 | Vertical separation: 1,000 ft below FL100, 2,000 ft above FL100. |
| F-SEP-05 | Wake turbulence separation: B777/B787 require 5 nm behind; B757 requires 4 nm behind. |
| F-SEP-06 | Violations SHALL be flagged with visual (amber/red) and audio alerts. |
| F-SEP-07 | Each violation SHALL be logged and reduce the player's score. |

### 1.9 UI Panels

| ID | Requirement |
|---|---|
| F-UI-01 | Arrival queue panel showing: callsign, type, origin, bearing, distance, ETA, altitude, assigned runway. |
| F-UI-02 | Departure queue panel showing: callsign, type, gate, destination, requested runway, push-back status. |
| F-UI-03 | Selected aircraft panel with all real-time data. |
| F-UI-04 | Comms log with timestamps, all issued commands, and aircraft read-backs. |
| F-UI-05 | ATIS panel: active runway configuration, winds, altimeter, remarks. |
| F-UI-06 | Simulation speed control: 1×, 2×, 4×. |
| F-UI-07 | Map layer toggle: runways, taxiways, STARs, SIDs, approach cones, labels. |

---

## 2. Non-Functional Requirements

| ID | Requirement |
|---|---|
| NF-PERF-01 | The simulation SHALL maintain ≥ 30 fps with 40 simultaneous aircraft active. |
| NF-PERF-02 | Command processing latency SHALL be < 100 ms from input to aircraft response. |
| NF-PERF-03 | Map tile loading SHALL not block the simulation loop. |
| NF-ACC-01 | All runway headings SHALL match real ORD data within ±1°. |
| NF-ACC-02 | All taxiway paths SHALL match real ORD geometry within ±10 meters. |
| NF-ACC-03 | Aircraft speeds SHALL not exceed or fall below the bounds in `data/aircraft_specs.json` by more than 5%. |
| NF-ACC-04 | Approach paths SHALL use the correct 3.0° glide slope angle. |
| NF-REL-01 | The simulation SHALL not crash or lock up during a 60-minute session with 40 aircraft. |
| NF-REL-02 | All JSON data files SHALL be validated against a schema on load; malformed data produces an error, not a crash. |
| NF-USE-01 | All ATC commands SHALL be documented and discoverable within the UI (help overlay). |
| NF-USE-02 | The player SHALL never need to consult external documentation to understand a command response. |
| NF-PORT-01 | The application SHALL run in Chrome, Firefox, and Edge (latest versions) without plugins. |

---

## 3. Constraints

- The simulation uses **real ORD coordinates** and real runway/taxiway data. Do not invent fictional geometry.
- All ATC phraseology follows **FAA JO 7110.65 (Air Traffic Control)** order.
- Aircraft performance envelopes come from **publicly available manufacturer data** and **Jeppesen charts**.
- All airline callsigns and flight numbers used in `data/sample_flights.json` are based on **publicly available schedule data** (FlightAware, OAG).
- Map tiles use **OpenStreetMap** (ODbL license) or custom-rendered airport tiles.

---

## 4. Out of Scope (v1.0)

- Multiplayer (player vs. player or player + co-controller).
- Weather simulation (wind shear, thunderstorms, icing).
- ATC voice recognition.
- Aircraft mechanical failures.
- Full SID/STAR automation (player assigns STAR; aircraft follows it, but not full RNAV simulation).
- Gate assignment optimization.
- Airline economics / slot management.
