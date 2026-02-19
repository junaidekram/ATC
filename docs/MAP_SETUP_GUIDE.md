# Map Setup Guide — Getting and Configuring the ORD Airport Map

This guide walks you through every step needed to acquire, configure, and label the Chicago O'Hare (KORD) airport map for use in the ATC simulator. Follow these steps exactly before implementing any game logic.

---

## Overview

The map has three layers:

1. **Basemap** — Satellite or OSM street/topo imagery as background context.
2. **Airport layer** — Runways, taxiways, aprons, terminals drawn from accurate data.
3. **Airspace layer** — Approach paths, SID/STAR routes, holding patterns, sector boundaries.

---

## Step 1 — Coordinate System Setup

All coordinates in this project use **WGS84 decimal degrees** (the same used by GPS and Google Maps).

**ORD Airport Reference Point (ARP):**
```
Latitude:  41.9802° N   (41.9802)
Longitude: 87.9090° W  (-87.9090)
Elevation: 668 ft MSL
```

Set this as your map center. Everything else is positioned relative to this point.

**Rendering Coordinate Range:**

| Zoom Level | Approximate Coverage |
|---|---|
| Overview (50 nm) | 40.24°N – 43.72°N, -89.62°W – -86.20°W |
| Mid (10 nm) | 41.54°N – 42.42°N, -88.48°W – -87.33°W |
| Ground (2 nm) | 41.89°N – 42.07°N, -88.02°W – -87.80°W |
| Gate detail (0.5 nm) | 41.96°N – 41.99°N, -87.94°W – -87.90°W |

---

## Step 2 — Getting the Basemap

### Option A: Leaflet.js with OpenStreetMap Tiles (Recommended)

```javascript
// In your HTML:
// <link rel="stylesheet" href="https://unpkg.com/leaflet/dist/leaflet.css" />
// <script src="https://unpkg.com/leaflet/dist/leaflet.js"></script>

const map = L.map('map-container').setView([41.9802, -87.9090], 12);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© OpenStreetMap contributors',
  maxZoom: 19,
}).addTo(map);
```

### Option B: Satellite Imagery via Esri

```javascript
L.tileLayer(
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  { attribution: 'Tiles © Esri', maxZoom: 19 }
).addTo(map);
```

### Option C: Aeronautical Sectional (OpenAeroMap)

For airspace visualization at the overview zoom level, use sectional chart tiles:
```
https://wms.chartbundle.com/tms/1.0.0/sec/{z}/{x}/{y}.png
```
Note: Check current availability and licensing before use.

---

## Step 3 — Getting the Airport Diagram (FAA Official)

The official ORD airport diagram can be downloaded from the FAA:

1. Go to: https://www.faa.gov/air_traffic/flight_info/aeronav/digital_products/dafd/
2. Click **"Search by Airport ID"**
3. Enter: **KORD**
4. Download the **Airport Diagram** (PDF, usually labeled "ORD AD")
5. Download the **Chart Supplement** for ILS frequencies and procedures

**What to extract from the FAA Airport Diagram:**
- Runway numbers, thresholds, and displaced thresholds
- Runway lengths and widths
- Hold-short line positions
- Taxiway alpha labels and positions
- Terminal building positions
- Runway Incursion Hotspot locations (marked as "H-1", "H-2", etc.)

---

## Step 4 — Getting Runway Data from OpenStreetMap

OSM contains accurate runway geometry for ORD. You can extract it without coding using the Overpass API.

### 4A. Using the Overpass API (Web, No Setup Required)

1. Go to: https://overpass-turbo.eu/
2. Paste the following query (extracts all airport features at ORD):

```
[out:json][timeout:60];
(
  way["aeroway"="runway"](41.93,-88.02,42.03,-87.87);
  way["aeroway"="taxiway"](41.93,-88.02,42.03,-87.87);
  way["aeroway"="taxilane"](41.93,-88.02,42.03,-87.87);
  way["aeroway"="apron"](41.93,-88.02,42.03,-87.87);
  way["aeroway"="terminal"](41.93,-88.02,42.03,-87.87);
  node["aeroway"="gate"](41.93,-88.02,42.03,-87.87);
  node["aeroway"="holding_position"](41.93,-88.02,42.03,-87.87);
);
out body;
>;
out skel qt;
```

3. Click **"Run"** — results appear in the right panel.
4. Click **"Export"** → **"GeoJSON"** → save as `ord_osm_raw.geojson`

### 4B. Programmatic Download (Node.js)

```javascript
// download_osm.js
const https = require('https');
const fs = require('fs');

const query = encodeURIComponent(`
[out:json][timeout:60];
(
  way["aeroway"="runway"](41.93,-88.02,42.03,-87.87);
  way["aeroway"="taxiway"](41.93,-88.02,42.03,-87.87);
  node["aeroway"="gate"](41.93,-88.02,42.03,-87.87);
);
out body;>;out skel qt;
`);

const url = `https://overpass-api.de/api/interpreter?data=${query}`;
https.get(url, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => fs.writeFileSync('ord_osm_raw.json', data));
});
```

---

## Step 5 — Labeling Runways

Every runway in the simulation MUST be labeled with:
1. **Runway number** (the magnetic heading rounded to nearest 10° and divided by 10)
2. **Heading** (exact magnetic heading in degrees)
3. **Threshold position** (GPS coordinates of the threshold, not runway centerpoint)
4. **Displaced threshold** (if applicable — marked on FAA diagram)
5. **Length** (in feet)

### How Runway Numbers Work

Runway numbers = **magnetic bearing ÷ 10**, rounded to nearest whole number.

Examples for ORD:
- A runway with magnetic heading 280° → Runway **28** (from the 280° end) / Runway **10** (from the opposite 100° end)
- A runway with magnetic heading 040° → Runway **04** / Runway **22**

The letter suffix (L/C/R) indicates **Left / Center / Right** when multiple parallel runways share the same heading.

### ORD Runway Identification Table

Use this to label your rendered runways:

| Runway | Heading (True) | Heading (Mag) | Length (ft) | Width (ft) | ILS |
|---|---|---|---|---|---|
| 10L/28R | 097° / 277° | 098° / 278° | 13,000 | 200 | ILS 28R, ILS 10L |
| 10C/28C | 097° / 277° | 098° / 278° | 13,000 | 200 | ILS 28C, ILS 10C |
| 10R/28L | 097° / 277° | 098° / 278° | 10,000 | 150 | ILS 28L, ILS 10R |
| 09L/27R | 092° / 272° | 093° / 273° | 7,500 | 150 | ILS 27R |
| 09R/27L | 092° / 272° | 093° / 273° | 7,967 | 150 | ILS 27L |
| 04L/22R | 039° / 219° | 040° / 220° | 7,500 | 150 | ILS 22R |
| 04R/22L | 039° / 219° | 040° / 220° | 12,000 | 200 | ILS 22L, ILS 04R |

### Rendering Runways in Code

```javascript
// From data/ord_runways.json:
runways.forEach(rwy => {
  const thresholdA = [rwy.threshold_a.lat, rwy.threshold_a.lon];
  const thresholdB = [rwy.threshold_b.lat, rwy.threshold_b.lon];
  
  // Draw runway as a thick polyline
  L.polyline([thresholdA, thresholdB], {
    color: '#444444',
    weight: 12,  // width in pixels at this zoom
    opacity: 1.0
  }).addTo(map);
  
  // Add runway number labels at each threshold
  L.marker(thresholdA, {
    icon: L.divIcon({
      html: `<div class="rwy-label">${rwy.id_a}</div>`,
      className: ''
    })
  }).addTo(map);
});
```

---

## Step 6 — Labeling Taxiways

Every taxiway segment must be tagged with:
1. **Alpha identifier** (A, B, C, F, G, H, J, K, L, M, N, P, Q, R, etc.)
2. **Node IDs** at each intersection (for pathfinding)
3. **Width** (varies: 75 ft for taxiway A, 50 ft for inner taxiways)

### How to Read Taxiway Data from OSM

In the OSM data, taxiways have the tag `"aeroway": "taxiway"` and `"ref": "A"` (or B, C, etc.). Some OSM entries for ORD may be missing the `ref` tag — cross-reference with the FAA airport diagram.

### Primary ORD Taxiway Reference

| Taxiway | Description | Width (ft) |
|---|---|---|
| A (Alpha) | Main inner loop around north complex | 75 |
| B (Bravo) | North complex, parallel to 28R | 75 |
| C (Charlie) | Links Terminal 1/2 to outer runways | 75 |
| F (Foxtrot) | South bypass road | 75 |
| G (Golf) | High-speed exit from 10C/28C | 75 |
| H (Hotel) | Outer ring, north | 75 |
| J (Juliet) | Links apron south | 50 |
| K (Kilo) | Parallel to 09L/27R | 50 |
| L (Lima) | Outer south | 75 |
| M (Mike) | Main south loop | 75 |
| N (November) | South-east connector | 50 |
| P (Papa) | Links Terminal 5 area | 50 |
| Q (Quebec) | Remote apron access | 50 |
| R (Romeo) | Links south runways to terminal | 75 |

### Rendering Taxiways

```javascript
taxiways.forEach(tw => {
  const polyline = L.polyline(
    tw.nodes.map(n => [n.lat, n.lon]),
    { color: '#999900', weight: 4, opacity: 0.8 }
  ).addTo(map);
  
  // Label at midpoint
  const mid = tw.nodes[Math.floor(tw.nodes.length / 2)];
  L.marker([mid.lat, mid.lon], {
    icon: L.divIcon({
      html: `<div class="tw-label">${tw.id}</div>`,
      className: ''
    })
  }).addTo(map);
});
```

---

## Step 7 — Extracting Runway Headings

To get the magnetic heading of a runway from two threshold coordinates:

### Formula (JavaScript)

```javascript
/**
 * Calculate the magnetic heading from point A to point B.
 * Returns degrees 0–360.
 */
function bearing(lat1, lon1, lat2, lon2) {
  const toRad = d => d * Math.PI / 180;
  const toDeg = r => r * 180 / Math.PI;
  
  const dLon = toRad(lon2 - lon1);
  const lat1r = toRad(lat1);
  const lat2r = toRad(lat2);
  
  const y = Math.sin(dLon) * Math.cos(lat2r);
  const x = Math.cos(lat1r) * Math.sin(lat2r)
           - Math.sin(lat1r) * Math.cos(lat2r) * Math.cos(dLon);
  
  let brng = toDeg(Math.atan2(y, x));
  brng = (brng + 360) % 360;
  return brng;  // True bearing
  // For magnetic heading: west declination means magnetic > true, so ADD the declination value.
  // brng_magnetic = (brng + 2.5 + 360) % 360;  // +2.5° for 2.5° West declination at ORD
}

// Example: Runway 28R
// threshold_28R = [41.9830, -87.9341]  (western threshold)
// threshold_10L = [41.9757, -87.8699]  (eastern threshold)
const heading28R = bearing(41.9757, -87.8699, 41.9830, -87.9341);
// → approximately 277° true / 278° magnetic → Runway 28
```

**Magnetic Declination at ORD:** approximately **2.5° West** in 2024. For west declination, **add** the declination value to the true heading to get magnetic heading: `magnetic = true + declination`. For Runway 28R: 277° true + 2.5° = ~280° magnetic → Runway 28.

---

## Step 8 — Getting ILS Approach Paths

ILS data for ORD (from FAA Chart Supplement, effective 2024):

| Runway | Localizer Freq | Glide Slope | FAF | Threshold Crossing Height |
|---|---|---|---|---|
| 28R | 109.75 MHz | 3.00° | MAAYO | 50 ft AGL |
| 28C | 111.15 MHz | 3.00° | VECTO | 50 ft AGL |
| 28L | 110.55 MHz | 3.00° | AKUNA | 50 ft AGL |
| 27R | 111.55 MHz | 3.00° | SMEEJ | 50 ft AGL |
| 22R | 109.10 MHz | 3.00° | ZEDAR | 50 ft AGL |
| 10L | 110.30 MHz | 3.00° | — | 50 ft AGL |
| 10C | 111.90 MHz | 3.00° | — | 50 ft AGL |

### Rendering the ILS Cone (Localizer)

```javascript
/**
 * Draw the ILS localizer cone extending `distanceNm` nautical miles
 * from the threshold in the reciprocal direction.
 * localizer half-width at the FAF: ~2.5° either side of centerline.
 */
function drawILSCone(thresholdLat, thresholdLon, headingFromRunway, distanceNm) {
  const NM_TO_DEG_LAT = 1 / 60;
  // Project centerline
  const centerDist = distanceNm * NM_TO_DEG_LAT;
  // ... (use bearing/distance projection formula)
  // Draw centerline + two outer lines at ±2.5°
}
```

---

## Step 9 — Verifying Your Map

After rendering, verify against the FAA airport diagram:

1. **Runway 28R/10L** should be the northernmost east-west runway.
2. **Runway 22L/04R** (the diagonal) should run NE–SW in the southwest area.
3. **Terminal 1** (K gates) should be north of center.
4. **Terminal 2** (H gates) should be east of Terminal 1.
5. **Terminal 3** (F/G gates) should be south-east.
6. **Terminal 5** (international, M gates) should be on the far east side.
7. **Taxiway B** should parallel the north side of runway 28R.
8. All runway intersections should match their actual positions.

**Cross-check:** Open Google Maps at 41.9802°N 87.9090°W, switch to satellite view, and overlay your rendered airport. The shapes should align closely.

---

## Step 10 — STAR Approach Waypoints (Arrival Fixes)

These waypoints define where arriving aircraft enter the ORD traffic management area. Use coordinates from `data/ord_waypoints.json`.

### Key ORD Arrival Fixes by Direction

| Direction | STAR | Entry Fix | Lat/Lon (approx) |
|---|---|---|---|
| From East (NY, Detroit) | LEWKE STAR | LEWKE | 42.05°N, 86.80°W |
| From West (Denver, LA) | BENKY STAR | BENKY | 42.10°N, 88.95°W |
| From South (Dallas, ATL) | PAITN STAR | PAITN | 41.24°N, 87.93°W |
| From South-SE (Miami) | WYNDE STAR | WYNDE | 41.30°N, 87.40°W |
| From North (Minneapolis) | SWAPP STAR | SWAPP | 42.70°N, 87.90°W |
| From NE (Boston, Toronto) | WATSN STAR | WATSN | 42.40°N, 87.10°W |

Each STAR has multiple waypoints leading to the IAF (Initial Approach Fix). All waypoint coordinates are in `data/ord_waypoints.json`.
