# Development Roadmap — ATC Simulator (KORD)

This roadmap breaks the project into discrete, sequential phases. Each phase has a clear goal, deliverables, and definition of done. A developer or team can pick up any phase using the detailed documentation in `docs/` and data in `data/`.

---

## Phase 0 — Project Foundation (Week 1–2)

**Goal:** Set up the project skeleton, tooling, and data pipeline.

### Deliverables
- [x] Repository with folder structure (already created)
- [x] Package/build system configured (e.g., Vite + TypeScript, or plain HTML/JS)
- [x] Leaflet.js map rendering with OSM tiles (or custom canvas)
- [x] All JSON data files loaded and validated at startup
- [x] Basic canvas or SVG layer on top of map
- [x] Unit test harness in place

### Definition of Done
- The map of ORD renders at the correct coordinates in the browser.
- All JSON data loads without errors and passes schema validation.
- A single static airplane icon appears on the map at a gate.

---

## Phase 1 — Map & Airport Layout (Week 2–4)

**Goal:** Render the full ORD airport layout with runways, taxiways, and gates correctly labeled and interactive.

### Deliverables
- [x] Runway polygons rendered at correct orientations from `data/ord_runways.json`
- [x] Runway labels (e.g., "28R", "10L") at correct threshold positions
- [x] Taxiway paths drawn from `data/ord_taxiways.json`
- [x] Taxiway alpha labels displayed at correct positions
- [x] Gate markers at terminal positions
- [x] ILS cone / glide slope approach paths visualized at 10 nm extent
- [x] Zoom levels: 50 nm overview ↔ gate-level detail
- [x] Runway heading tooltip on hover

### Definition of Done
- Every ORD runway renders with correct orientation matching real-world charts.
- Clicking a runway shows: runway ID, heading, length, ILS frequency.
- Taxiways are labeled A, B, C, F, G, H, K, L, M, N with correct geometry.
- Zoom in/out transitions are smooth.

---

## Phase 2 — Aircraft Rendering & Basic Movement (Week 4–6)

**Goal:** Render aircraft on the map and animate them along simple predefined paths.

### Deliverables
- [x] Aircraft icon renders with correct orientation (nose points in direction of travel)
- [x] Aircraft data loaded from `data/sample_flights.json`
- [x] Aircraft label: callsign, speed, altitude
- [x] Clicking aircraft opens info panel (type, airline, origin, destination, status)
- [x] Ground movement along taxiway nodes at correct taxi speed (10–20 kts)
- [x] Airborne movement along approach path points at correct speed/altitude
- [x] Altitude and speed update every simulation tick (1 second = ~10 real seconds or configurable)

### Definition of Done
- At least 10 aircraft are visible: some taxiing, some on approach.
- Each aircraft smoothly moves along its path.
- Aircraft label updates every tick with live speed and altitude.
- Clicking any aircraft shows all details from the flight data file.

---

## Phase 3 — ATC Command System (Week 6–9)

**Goal:** Implement the full ATC command interface so the player can direct aircraft.

### Deliverables
- [x] Command input bar with autocomplete for callsigns
- [x] Parser for all commands in `docs/ATC_COMMANDS_REFERENCE.md`
- [x] Aircraft read-back displayed in comms log panel
- [x] Taxi route drawn on map when taxi clearance issued
- [x] Aircraft follows issued taxi route (node-by-node from taxiway graph)
- [x] Runway assignment and lineup queue
- [x] Takeoff clearance: aircraft accelerates, rotates, climbs
- [x] Landing clearance: aircraft descends on glide slope, touches down
- [x] Hold short / hold position commands
- [x] Go-around command

### Definition of Done
- Player can issue taxi clearance, and plane animates along the correct route.
- Player can clear a plane for takeoff; plane animates acceleration and departure.
- Player can sequence a landing aircraft; plane descends and exits runway.
- All commands produce correct read-backs in the comms log.
- Invalid commands produce error messages (e.g., runway occupied).

---

## Phase 4 — Separation & Collision Management (Week 9–11)

**Goal:** Enforce real ATC separation standards automatically.

### Deliverables
- [x] Ground conflict detection: flag two aircraft < 150 ft apart on ground
- [x] Runway occupancy lock: only one aircraft on runway at a time
- [x] Approach separation: 3 nm minimum between aircraft on final
- [x] Vertical separation: 1,000 ft below FL100, 2,000 ft above
- [x] Visual warning system: aircraft turn red / amber when separation violated
- [x] Automatic hold-short enforcement if runway is occupied
- [x] Score / penalty system for separation violations

### Definition of Done
- Issuing a takeoff clearance when another aircraft is on the runway produces a warning.
- Two aircraft taxiing toward each other on the same taxiway trigger a ground conflict alert.
- Approach aircraft that are too close produce an amber visual and audio alert.

---

## Phase 5 — Traffic Flow & AI Spawning (Week 11–14)

**Goal:** Continuously spawn realistic traffic from real directions with accurate schedules.

### Deliverables
- [x] AI spawns arriving aircraft at 50 nm boundary from correct bearing (see `data/sample_flights.json`)
- [x] Arriving aircraft follow STAR waypoints into airport
- [x] Departing aircraft spawn at gates, request IFR clearance, then taxi
- [x] Traffic ramp-up: increases in intensity over time
- [x] Holding pattern logic if approach is congested (`UAL123 hold` → circular orbit; `UAL123 resume nav` exits)
- [x] Departure queue management: planes push back in scheduled order
- [x] Aircraft automatically disappear after reaching destination fix on departure

### Definition of Done
- A UAL flight arriving from Newark (bearing ~090°) appears in the east and tracks westbound.
- An AAL flight from Dallas (bearing ~190°) appears in the south and tracks northbound.
- Departure aircraft push back, taxi autonomously until cleared by player.
- 15–20 aircraft are simultaneously active without frame rate degradation.

---

## Phase 6 — Full Realism Pass (Week 14–17)

**Goal:** Polish all dynamics to match real-world aviation performance and procedures.

### Deliverables
- [x] All aircraft follow correct speed schedule per phase (see `docs/FLIGHT_DYNAMICS.md`)
- [x] ILS approach path rendered with glide slope angle (3°) and localizer width
- [x] Missed approach / go-around procedure fully animated
- [x] Wake turbulence separation: heavy aircraft require extra spacing (ICAO Doc 4444 categories SUPER/HEAVY/MEDIUM/SMALL)
- [x] Accurate runway exit points (high-speed exits at ORD: Bravo, Golf)
- [x] ATIS broadcast panel (active runway config, weather, altimeter setting)
- [ ] Wind-dependent runway configuration (ILS approach favors headwind)
- [ ] Realistic taxiway conflicts at hotspot intersections (ORD hotspots H1–H4)

### Definition of Done
- A B777 landing on 10C exits at taxiway Golf at ~30 kts as expected.
- A wind shift triggers a runway configuration change and player is notified.
- Heavy aircraft automatically get extra spacing on approach.

---

## Phase 7 — UI / UX Polish (Week 17–20)

**Goal:** Build a complete, usable ATC workstation UI.

### Deliverables
- [x] Departure queue panel with callsign, type, gate, requested runway, estimated push-back time
- [x] Arrival queue (strip bay) with callsign, type, origin, ETA, assigned runway, distance
- [x] Selected aircraft info panel with live data
- [x] Comms log with timestamps, all clearances, and read-backs
- [x] ATIS panel
- [x] Score/timer display
- [x] Configurable sim speed (1×, 2×, 4×, 10×, 20×)
- [x] Map layer toggles (show/hide taxiways, STARs, SIDs, approach paths)

### Definition of Done
- Player can manage a full 30-minute session controlling 25+ aircraft without needing to consult external documentation.
- All panels update in real time.
- UI works on a 1920×1080 display without scroll.

---

## Phase 8 — Testing & Documentation (Week 20–22)

**Goal:** Ensure correctness, write all end-user and developer documentation.

### Deliverables
- [x] Unit tests for: command parser, pathfinding, separation checks, flight dynamics calculator
- [x] Integration tests for: complete taxi sequence, complete approach/landing sequence
- [ ] Performance test: 40 simultaneous aircraft at 60 fps
- [ ] All docs reviewed for accuracy against real ORD procedures
- [ ] Tutorial / onboarding mode for new players

---

## Milestone Summary

| Milestone | End of Phase | Description | Status |
|---|---|---|---|
| M1 | Phase 1 | Airport map renders correctly | ✅ Complete |
| M2 | Phase 2 | Aircraft visible and moving | ✅ Complete |
| M3 | Phase 3 | Player can control aircraft | ✅ Complete |
| M4 | Phase 4 | Separation alerts working | ✅ Complete |
| M5 | Phase 5 | Full AI traffic flowing | ✅ Complete |
| M6 | Phase 6 | Full realism complete | ✅ Mostly complete |
| M7 | Phase 7 | Polished UI complete | ✅ Complete |
| M8 | Phase 8 | Testing & docs | 🔄 In progress |
| M8 | Phase 8 | Tested and documented |
