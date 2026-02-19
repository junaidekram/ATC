# ORD Runway Guide — Headings, ILS, Lighting, and Procedures

This document is the authoritative reference for all runway-specific data at Chicago O'Hare International Airport (KORD). Every value here must be reflected in `data/ord_runways.json` and in the rendered simulation.

---

## Airport Reference

| Field | Value |
|---|---|
| ICAO | KORD |
| IATA | ORD |
| Name | Chicago O'Hare International Airport |
| City | Chicago, Illinois, USA |
| Elevation | 668 ft MSL (203 m) |
| Magnetic Declination | 2.5° West (2024) |
| ARP (Airport Reference Point) | 41.9802° N, 87.9090° W |
| Pattern Altitude | 1,700 ft MSL (1,032 ft AGL) |

---

## Runway Configuration

ORD has **seven runway pairs** (14 runway ends) arranged in two intersecting groups:

- **East-West runways** (headings ~093°/273° and ~098°/278°): Primary runways for west flow (landing 28s) and east flow (landing 10s).
- **Diagonal runway** (headings ~040°/220°): Used in south flow operations and crosswind situations.

---

## Detailed Runway Data

### Runway 10L / 28R

| Field | 10L | 28R |
|---|---|---|
| Heading (magnetic) | 098° | 278° |
| Heading (true) | 097° | 277° |
| Threshold coordinates | 41.9757°N, 87.8699°W | 41.9830°N, 87.9341°W |
| Length | 13,000 ft (3,962 m) | ← same runway |
| Width | 200 ft (61 m) | ← same runway |
| PCN (Pavement strength) | 107/F/B/W/T | ← same runway |
| TORA | 13,000 ft | 13,000 ft |
| TODA | 13,000 ft | 13,000 ft |
| ASDA | 13,000 ft | 13,000 ft |
| LDA | 13,000 ft | 13,000 ft |
| ILS | ILS/DME Cat IIIb | ILS/DME Cat IIIb |
| ILS Localizer Frequency | 110.30 MHz | 109.75 MHz |
| ILS Identifier | I-ORF | I-ORL |
| Glide Slope | 3.00° | 3.00° |
| VASI/PAPI | PAPI (4L) | PAPI (4L) |
| Threshold Crossing Height | 55 ft | 50 ft |
| TDZ Elevation | 668 ft | 665 ft |
| Displaced threshold | None | None |
| Stopway | None | None |
| High-speed exits | — | Taxiway B (right), Taxiway G |
| Lighting | HIRL, ALSF-2, TDZL, RCLS, REL | HIRL, ALSF-2, TDZL, RCLS, REL |

---

### Runway 10C / 28C

| Field | 10C | 28C |
|---|---|---|
| Heading (magnetic) | 098° | 278° |
| Heading (true) | 097° | 277° |
| Threshold coordinates | 41.9720°N, 87.8721°W | 41.9793°N, 87.9322°W |
| Length | 13,000 ft (3,962 m) | ← same runway |
| Width | 200 ft (61 m) | ← same runway |
| ILS | ILS/DME Cat IIIb | ILS/DME Cat IIIb |
| ILS Localizer Frequency | 111.90 MHz | 111.15 MHz |
| ILS Identifier | I-ORC | I-ORC |
| Glide Slope | 3.00° | 3.00° |
| High-speed exits | — | Taxiway Golf, Taxiway Foxtrot |

---

### Runway 10R / 28L

| Field | 10R | 28L |
|---|---|---|
| Heading (magnetic) | 098° | 278° |
| Heading (true) | 097° | 277° |
| Threshold coordinates | 41.9685°N, 87.8740°W | 41.9750°N, 87.9246°W |
| Length | 10,000 ft (3,048 m) | ← same runway |
| Width | 150 ft (46 m) | ← same runway |
| ILS | ILS/DME Cat I | ILS/DME Cat IIIb |
| ILS Localizer Frequency | — | 110.55 MHz |
| Glide Slope | 3.00° | 3.00° |
| High-speed exits | — | Taxiway Hotel |

---

### Runway 09L / 27R

| Field | 09L | 27R |
|---|---|---|
| Heading (magnetic) | 093° | 273° |
| Heading (true) | 092° | 272° |
| Threshold coordinates | 41.9938°N, 87.9003°W | 41.9950°N, 87.9357°W |
| Length | 7,500 ft (2,286 m) | ← same runway |
| Width | 150 ft (46 m) | ← same runway |
| ILS | None | ILS/DME Cat I |
| ILS Localizer Frequency | — | 111.55 MHz |
| Glide Slope | — | 3.00° |
| Notes | Primarily used for departures | ILS available |

---

### Runway 09R / 27L

| Field | 09R | 27L |
|---|---|---|
| Heading (magnetic) | 093° | 273° |
| Heading (true) | 092° | 272° |
| Threshold coordinates | 41.9800°N, 87.8965°W | 41.9812°N, 87.9298°W |
| Length | 7,967 ft (2,428 m) | ← same runway |
| Width | 150 ft (46 m) | ← same runway |
| ILS | None | ILS/DME Cat I |
| ILS Localizer Frequency | — | 109.30 MHz |
| Glide Slope | — | 3.00° |

---

### Runway 04L / 22R

| Field | 04L | 22R |
|---|---|---|
| Heading (magnetic) | 040° | 220° |
| Heading (true) | 039° | 219° |
| Threshold coordinates | 41.9650°N, 87.9280°W | 42.0042°N, 87.9002°W |
| Length | 7,500 ft (2,286 m) | ← same runway |
| Width | 150 ft (46 m) | ← same runway |
| ILS | None | ILS/DME Cat I |
| ILS Localizer Frequency | — | 109.10 MHz |
| Glide Slope | — | 3.00° |

---

### Runway 04R / 22L

| Field | 04R | 22L |
|---|---|---|
| Heading (magnetic) | 040° | 220° |
| Heading (true) | 039° | 219° |
| Threshold coordinates | 41.9590°N, 87.9390°W | 42.0080°N, 87.9041°W |
| Length | 12,000 ft (3,658 m) | ← same runway |
| Width | 200 ft (61 m) | ← same runway |
| ILS | ILS/DME Cat I | ILS/DME Cat IIIb |
| ILS Localizer Frequency | — | 110.10 MHz |
| Glide Slope | 3.00° | 3.00° |
| High-speed exits | — | Taxiway Lima |
| Notes | Long diagonal, good for south flow ops | Primary south flow arrival |

---

## Runway Configurations

ORD operates in different configurations based on wind:

### West Flow (Most Common — Westerly Winds)
- **Arrivals:** 28R, 28C, 28L, 27R, 27L, 22L (if needed)
- **Departures:** 28R, 28C, 27L, 09L
- Notes: This is the default configuration ~55% of the time

### East Flow (Easterly Winds)
- **Arrivals:** 10L, 10C, 10R
- **Departures:** 09L, 09R, 04R
- Notes: Used during sustained easterly winds

### South Flow (Southerly Winds / Crosswind)
- **Arrivals:** 22R, 22L
- **Departures:** 04L, 04R
- Notes: Less common, primarily during SE/S wind events

### Simultaneous Operations
ORD routinely operates **three runways simultaneously** for arrivals during peak hours. Typical simultaneous arrival configuration (west flow):
- 28R + 28C + 27R (triple simultaneous ILS approaches)

---

## Runway Incursion Hotspots

The FAA has identified specific hotspot intersections at ORD where incursions are most likely. The simulation MUST flag these:

| Hotspot | Location | Risk |
|---|---|---|
| HS-1 | Taxiway B / Runway 28R intersection | Runway 28R crossing |
| HS-2 | Taxiway B / Runway 32L crossing | Short crossing, poor visibility |
| HS-3 | Taxiway G / Runway 10C-28C crossing | High-speed exit confusion |
| HS-4 | Taxiway K / Runway 09L intersection | Complex intersection, limited sight lines |

---

## Hold-Short Positions

Every runway has a hold-short line at each end and at every taxiway crossing. The hold-short line is located **250 ft from the runway centerline** (for runways with instrument approaches).

In the simulation:
- Aircraft MUST stop at hold-short lines without explicit clearance.
- Hold-short lines should be rendered as a pair of yellow dashed lines with solid lines adjacent.
- Aircraft crossing a hold-short without clearance triggers an incursion alert.

---

## Runway Markings Reference

When rendering runways, include these markings (simplified):

| Marking | Description | Position |
|---|---|---|
| Threshold markings | 8 white stripes (200-ft wide runway) | At each threshold end |
| Runway number | White digits | At threshold, pointed inward |
| Centerline | White dashes, 120 ft long, 80 ft gap | Full length |
| Touchdown zone | Rectangular white bars | 500–3,000 ft from threshold |
| Aiming point | Two large white rectangles | 1,000 ft from threshold |
| Edge stripes | Continuous white lines | Full length at edge |

---

## Glide Slope Calculations

For rendering the 3° ILS glide slope in the simulation:

```
At distance D from threshold, altitude above threshold = D × tan(3°)

D = 1 nm  = 6,076 ft → altitude = 6,076 × 0.05241 = ~318 ft AGL
D = 3 nm  = 18,228 ft → altitude = ~955 ft AGL
D = 5 nm  = 30,380 ft → altitude = ~1,592 ft AGL
D = 10 nm = 60,760 ft → altitude = ~3,184 ft AGL

Rule of thumb: 300 ft per nautical mile on a 3° glide slope.
```

Aircraft on ILS should be at approximately:
- 10 nm out: ~3,200 ft MSL (3,200 + 668 ft elevation = 3,868 ft MSL at ORD)
- 5 nm out: ~1,600 ft MSL above threshold + field elevation
- Threshold: 50 ft AGL (touchdown aim point)
