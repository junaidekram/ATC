# ATC Simulator — Chicago O'Hare (ORD)

A fully realistic, browser-based Air Traffic Control simulation set at **Chicago O'Hare International Airport (KORD)**. Players act as the tower and TRACON controller, directing aircraft from gate to gate with realistic speeds, flight profiles, approach corridors, and ATC phraseology.

---

## Table of Contents

1. [Project Overview](#project-overview)
2. [Quick Start for Developers](#quick-start-for-developers)
3. [Documentation Index](#documentation-index)
4. [Key Design Principles](#key-design-principles)
5. [Repository Structure](#repository-structure)
6. [Data Sources](#data-sources)
7. [Contributing](#contributing)

---

## Project Overview

This simulator recreates the experience of controlling aircraft at one of the world's busiest airports. Every aspect — runway headings, taxiway layouts, airline schedules, approach paths, and ATC phraseology — is grounded in real-world data.

**What makes this simulator realistic:**

- Aircraft approach from geographically correct directions (e.g., a flight from Dallas arrives from the **south**, not the north).
- Aircraft types carry realistic performance data: max speed, climb rate, required runway length, taxi speed.
- Runways are labeled and oriented exactly as at the real KORD.
- ATC commands follow standard FAA/ICAO phraseology.
- Separation rules match real TRACON/Tower minimums.
- STAR and SID routes use real waypoint names and coordinates.

---

## Quick Start for Developers

```
git clone https://github.com/junaidekram/ATC.git
cd ATC
```

All implementation specifications are in `docs/`. All data files (JSON) are in `data/`. Start with:

1. `docs/IMPLEMENTATION_GUIDE.md` — full step-by-step build plan
2. `docs/MAP_SETUP_GUIDE.md` — how to get and configure the airport map
3. `data/ord_runways.json` — runway coordinates, headings, and ILS data
4. `data/aircraft_specs.json` — every aircraft type used in the simulation
5. `data/sample_flights.json` — realistic flights with real airline IDs, origins, routes

---

## Documentation Index

| File | Description |
|---|---|
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | Phased development timeline with milestones |
| [`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md) | Full functional and non-functional requirements |
| [`docs/MAP_SETUP_GUIDE.md`](docs/MAP_SETUP_GUIDE.md) | Getting the OSM map, labeling runways and taxiways, extracting headings |
| [`docs/RUNWAY_GUIDE.md`](docs/RUNWAY_GUIDE.md) | ORD runway details: headings, lengths, ILS frequencies, markings |
| [`docs/ATC_COMMANDS_REFERENCE.md`](docs/ATC_COMMANDS_REFERENCE.md) | Full ATC command syntax, examples, and expected aircraft responses |
| [`docs/FLIGHT_DYNAMICS.md`](docs/FLIGHT_DYNAMICS.md) | Speed/altitude profiles for taxi, takeoff, climb, approach, landing |
| [`docs/TRAFFIC_MANAGEMENT.md`](docs/TRAFFIC_MANAGEMENT.md) | Queue management, separation rules, flow control |
| [`docs/AI_BEHAVIOR.md`](docs/AI_BEHAVIOR.md) | AI spawn logic, STAR/SID routing, realistic approach directions |
| [`docs/IMPLEMENTATION_GUIDE.md`](docs/IMPLEMENTATION_GUIDE.md) | Developer step-by-step implementation walkthrough |

---

## Key Design Principles

### 1. Geographic Realism — Approach Directions

Every aircraft arrives from and departs to a realistic bearing:

| Origin City | Bearing to ORD | Arrival Direction |
|---|---|---|
| Dallas/Fort Worth (DFW) | ~190° (South) | Approaches from **South** |
| Los Angeles (LAX) | ~250° (West-Southwest) | Approaches from **West** |
| New York (JFK/EWR) | ~095° (East) | Approaches from **East** |
| Miami (MIA) | ~170° (South-Southeast) | Approaches from **South** |
| Denver (DEN) | ~245° (West-Southwest) | Approaches from **West** |
| Minneapolis (MSP) | ~330° (North-Northwest) | Approaches from **North** |
| Atlanta (ATL) | ~155° (South-Southeast) | Approaches from **South** |
| Seattle (SEA) | ~290° (West-Northwest) | Approaches from **West** |
| Boston (BOS) | ~080° (East-Northeast) | Approaches from **East** |
| Detroit (DTW) | ~095° (East) | Approaches from **East** |

### 2. Realistic Speeds

| Phase | Speed |
|---|---|
| Gate push-back | 3–5 knots |
| Taxiing | 10–20 knots |
| Runway lineup | 0 knots (holding) |
| Takeoff roll | 0 → V1 (130–165 kts depending on type) |
| Initial climb | 200 kts below 10,000 ft |
| Cruise | 450–490 kts (FL350–FL380) |
| Approach (50 nm out) | 250 kts max |
| Final approach (10 nm) | 160–180 kts |
| Short final (5 nm) | 130–150 kts |
| Touchdown | 130–145 kts → deceleration |
| Runway exit | 20–30 kts |

### 3. ATC Command Model

Players issue commands using a structured syntax closely matching real ATC phraseology. All aircraft respond with read-backs. See [`docs/ATC_COMMANDS_REFERENCE.md`](docs/ATC_COMMANDS_REFERENCE.md).

---

## Repository Structure

```
ATC/
├── README.md                        ← This file
├── plan.txt                         ← Original high-level plan
│
├── docs/
│   ├── ROADMAP.md                   ← Development phases & milestones
│   ├── REQUIREMENTS.md              ← Functional & non-functional requirements
│   ├── MAP_SETUP_GUIDE.md           ← Map acquisition and labeling guide
│   ├── RUNWAY_GUIDE.md              ← ORD runway details
│   ├── ATC_COMMANDS_REFERENCE.md    ← Full command reference
│   ├── FLIGHT_DYNAMICS.md           ← Aircraft flight profiles
│   ├── TRAFFIC_MANAGEMENT.md        ← Separation and queue management
│   ├── AI_BEHAVIOR.md               ← AI logic for spawning and routing
│   └── IMPLEMENTATION_GUIDE.md      ← Developer step-by-step guide
│
└── data/
    ├── aircraft_specs.json          ← Performance data for all aircraft types
    ├── sample_flights.json          ← Realistic flights with airline IDs & routes
    ├── ord_runways.json             ← ORD runway coordinates, headings, ILS
    ├── ord_waypoints.json           ← STAR/SID/fix waypoints with coordinates
    ├── ord_taxiways.json            ← Taxiway graph: nodes and edges
    └── airlines.json                ← Airline callsigns, ICAO codes, fleet types
```

---

## Data Sources

| Data Type | Source | URL |
|---|---|---|
| Airport diagram & gates | FAA Digital AF/D | https://www.faa.gov/air_traffic/flight_info/aeronav/digital_products/dafd |
| Runway coordinates | OpenStreetMap | https://www.openstreetmap.org |
| STAR/SID procedures | FAA NASR Subscription | https://www.faa.gov/air_traffic/flight_info/aeronav/digital_products/NASR_Subscription |
| ILS frequencies | FAA Chart Supplement | https://www.faa.gov/air_traffic/flight_info/aeronav/digital_products/dafd |
| Aircraft performance | Airbus/Boeing AMM, FCOM | Manufacturer documentation |
| Airline schedules | FlightAware / FlightRadar24 | Public ADS-B data |
| Terrain elevation | NASA SRTM | https://www2.jpl.nasa.gov/srtm |
| OSM map tiles | OpenStreetMap / Leaflet | https://leafletjs.com |

---

## Contributing

1. Read `docs/REQUIREMENTS.md` first to understand what the simulation must do.
2. Read `docs/IMPLEMENTATION_GUIDE.md` for how to build each component.
3. Use the data files in `data/` as the single source of truth for airport and aircraft data.
4. All ATC commands must follow the syntax in `docs/ATC_COMMANDS_REFERENCE.md`.
5. All flight dynamics must stay within bounds defined in `docs/FLIGHT_DYNAMICS.md`.
