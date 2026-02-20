/**
 * scripts/convert_osm.mjs
 * Transforms data/ord_osm_raw.json (Overpass output) into:
 *   data/ord_runways.json    — precise threshold positions + headings from coords
 *   data/ord_taxiways.json   — real taxiway node-graph + gate positions
 *
 * Existing ILS, runway_configurations, and hotspot blocks are preserved
 * from the original data files (OSM has no ILS data).
 *
 * Run: node scripts/convert_osm.mjs
 */

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(__dirname, '../data');

// ─────────────────────────────────────────────────────────────────────────────
// I/O helpers
// ─────────────────────────────────────────────────────────────────────────────

function readJSON(name) {
  return JSON.parse(fs.readFileSync(path.join(DATA, name), 'utf8'));
}

function writeJSON(name, obj) {
  const out = path.join(DATA, name);
  fs.writeFileSync(out, JSON.stringify(obj, null, 2));
  console.log(`✅  Wrote ${path.relative(process.cwd(), out)}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Geo helpers
// ─────────────────────────────────────────────────────────────────────────────

const R_NM  = 3440.065;          // Earth radius in nautical miles
const R_FT  = R_NM * 6076.115;   // in feet

function toRad(d)  { return d * Math.PI / 180; }
function toDeg(r)  { return r * 180 / Math.PI; }

/** True bearing from A → B, 0–360 */
function bearing(lat1, lon1, lat2, lon2) {
  const dLon = toRad(lon2 - lon1);
  const lat1r = toRad(lat1), lat2r = toRad(lat2);
  const y = Math.sin(dLon) * Math.cos(lat2r);
  const x = Math.cos(lat1r) * Math.sin(lat2r)
          - Math.sin(lat1r) * Math.cos(lat2r) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Distance in feet between two lat/lon points */
function distFt(lat1, lon1, lat2, lon2) {
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2)**2
          + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon/2)**2;
  return R_FT * 2 * Math.asin(Math.sqrt(a));
}

/** Round to N decimal places */
function round(v, n = 6) {
  const f = 10 ** n;
  return Math.round(v * f) / f;
}

// ─────────────────────────────────────────────────────────────────────────────
// Parse OSM elements
// ─────────────────────────────────────────────────────────────────────────────

/** Build node lookup map: id -> { lat, lon, tags } */
function buildNodeMap(elements) {
  const map = new Map();
  for (const el of elements) {
    if (el.type === 'node') {
      map.set(el.id, { lat: el.lat, lon: el.lon, tags: el.tags ?? {} });
    }
  }
  return map;
}

/** Collect ways by aeroway type */
function waysByAeroway(elements, type) {
  return elements.filter(
    el => el.type === 'way' && el.tags?.aeroway === type
  );
}

/** Collect nodes by aeroway type */
function nodesByAeroway(elements, type) {
  return elements.filter(
    el => el.type === 'node' && el.tags?.aeroway === type
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Runway processing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Given a runway way's two endpoint nodes, figure out which is threshold_a
 * (lower runway number end) and which is threshold_b (higher).
 *
 * We compute the bearing from node[0] → node[last], round to nearest 10,
 * divide by 10 → that's the runway number for the "b" end direction
 * (since we're going toward that end).
 *
 * We also try to match against a known ref string like "10L/28R".
 */
function classifyRunwayEnds(nodeA, nodeB, refTag) {
  // bearing from A end to B end
  const brng = bearing(nodeA.lat, nodeA.lon, nodeB.lat, nodeB.lon);
  const rwyNum = Math.round(brng / 10);  // 1–36
  const rwyNumB = rwyNum === 0 ? 36 : rwyNum;
  const rwyNumA = rwyNumB > 18 ? rwyNumB - 18 : rwyNumB + 18;

  return {
    threshold_a: { lat: round(nodeA.lat), lon: round(nodeA.lon) },
    threshold_b: { lat: round(nodeB.lat), lon: round(nodeB.lon) },
    heading_a_true: round(bearing(nodeA.lat, nodeA.lon, nodeB.lat, nodeB.lon), 1),
    heading_b_true: round(bearing(nodeB.lat, nodeB.lon, nodeA.lat, nodeA.lon), 1),
    implied_a_num: rwyNumA,  // runway number of nodeA end
    implied_b_num: rwyNumB,  // runway number of nodeB end
  };
}

/**
 * Normalize a runway ref string to match our id format.
 * OSM uses "10L/28R", "28R/10L", etc. We want lower number first.
 */
function normalizeRunwayRef(ref) {
  if (!ref) return null;
  const parts = ref.split('/').map(s => s.trim());
  if (parts.length !== 2) return ref;
  const numA = parseInt(parts[0]);
  const numB = parseInt(parts[1]);
  // lower number first
  return numA <= numB ? `${parts[0]}/${parts[1]}` : `${parts[1]}/${parts[0]}`;
}

/**
 * Parse a suffixed runway designator like "10L" → number=10, suffix="L"
 */
function parseRwyId(id) {
  const m = id?.match(/^(\d+)([LCR]?)$/);
  if (!m) return null;
  return { num: parseInt(m[1]), suffix: m[2] };
}

// ─────────────────────────────────────────────────────────────────────────────
// Taxiway processing
// ─────────────────────────────────────────────────────────────────────────────

// Maximum gap in feet to bridge between chain endpoints during stitching.
// Covers OSM survey inaccuracy and minor segment disconnects without
// jumping across terminals (which would create phantom centerlines).
const GAP_BRIDGE_FT = 60;

/**
 * Returns true if two resolved nodes are close enough to be treated as the
 * same physical point (exact OSM id match, OR within GAP_BRIDGE_FT).
 */
function nodesNear(a, b) {
  if (a.osmId === b.osmId) return true;
  return distFt(a.lat, a.lon, b.lat, b.lon) <= GAP_BRIDGE_FT;
}

/**
 * For a group of OSM ways sharing the same taxiway ref,
 * stitch them into one or more ordered chains of resolved nodes.
 *
 * KEY CHANGE: Returns an ARRAY of chains (one per disconnected segment).
 * Disconnected segments that cannot be joined within GAP_BRIDGE_FT tolerance
 * are kept as separate chains so the renderer never draws a phantom straight
 * line bridging two physically-disconnected pieces (which caused lines to
 * appear over terminals).
 *
 * Returns: Array of { chainRef, nodes, osmToApp }
 */
function stitchTaxiwayWays(ways, nodeMap, taxiRef) {
  if (ways.length === 0) return [];

  // Resolve every way to an array of rich nodes { osmId, lat, lon }
  const segments = [];
  for (const way of ways) {
    const resolved = [];
    for (const osmId of way.nodes) {
      const n = nodeMap.get(osmId);
      if (n) resolved.push({ osmId, lat: n.lat, lon: n.lon });
    }
    if (resolved.length >= 2) segments.push(resolved);
  }
  if (segments.length === 0) return [];

  // Assemble into chains using proximity-tolerant endpoint matching
  const rawChains = assembleChainsByProximity(segments);

  // Convert each chain to app-format nodes
  return rawChains.map((chain, chainIdx) => {
    const chainRef = rawChains.length === 1
      ? taxiRef
      : `${taxiRef}-${chainIdx + 1}`;

    const nodes = [];
    const osmToApp = new Map(); // osmId -> appNodeId

    for (const node of chain) {
      if (osmToApp.has(node.osmId)) continue; // deduplicate shared endpoint
      // Use underscore separator so node IDs remain valid identifiers
      const safeRef = chainRef.replace(/-/g, '_');
      const appId = `${safeRef}${String(nodes.length + 1).padStart(2, '0')}`;
      nodes.push({ id: appId, lat: round(node.lat), lon: round(node.lon) });
      osmToApp.set(node.osmId, appId);
    }

    return { chainRef, nodes, osmToApp };
  });
}

/**
 * Greedy chain assembler operating on rich node arrays { osmId, lat, lon }.
 * Uses proximity (GAP_BRIDGE_FT) for endpoint matching so tiny OSM gaps
 * do NOT create phantom cross-terminal bridges.
 * Segments that cannot be joined within tolerance are returned as separate
 * chains — the renderer draws each as its own polyline.
 */
function assembleChainsByProximity(segments) {
  if (segments.length === 0) return [];
  if (segments.length === 1) return segments;

  const remaining = segments.map(s => [...s]);
  const chains = [];

  while (remaining.length > 0) {
    let chain = remaining.shift();

    let changed = true;
    while (changed) {
      changed = false;
      for (let i = 0; i < remaining.length; i++) {
        const seg      = remaining[i];
        const cEnd     = chain[chain.length - 1];
        const cStart   = chain[0];
        const sStart   = seg[0];
        const sEnd     = seg[seg.length - 1];

        if (nodesNear(cEnd, sStart)) {
          chain = [...chain, ...seg.slice(1)];
          remaining.splice(i, 1); changed = true; break;
        } else if (nodesNear(cEnd, sEnd)) {
          chain = [...chain, ...[...seg].reverse().slice(1)];
          remaining.splice(i, 1); changed = true; break;
        } else if (nodesNear(cStart, sEnd)) {
          chain = [...seg.slice(0, -1), ...chain];
          remaining.splice(i, 1); changed = true; break;
        } else if (nodesNear(cStart, sStart)) {
          chain = [[...seg].reverse().slice(0, -1), ...chain].flat();
          remaining.splice(i, 1); changed = true; break;
        }
      }
    }
    chains.push(chain);
  }

  return chains;
}

// ─────────────────────────────────────────────────────────────────────────────
// Graph edge building
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build edges from sequential nodes in a taxiway:
 * A01-A02, A02-A03, etc.
 */
function buildSequentialEdges(nodes) {
  const edges = [];
  for (let i = 0; i < nodes.length - 1; i++) {
    const a = nodes[i], b = nodes[i + 1];
    edges.push({
      from: a.id,
      to:   b.id,
      dist_ft: Math.round(distFt(a.lat, a.lon, b.lat, b.lon))
    });
  }
  return edges;
}

/**
 * Find cross-taxiway intersection edges: pairs of nodes from different
 * taxiways that are within a threshold distance of each other and were
 * originally the same OSM node (i.e. shared by both OSM ways).
 *
 * Rather than rely on proximity, we track original OSM node IDs and look for
 * nodes shared between two taxiways (which is exactly what OSM intersection
 * nodes are).
 */
function buildIntersectionEdges(taxiwayGroups) {
  // Build a map: osmNodeId → list of { taxiRef, appNodeId }
  const osmToApps = new Map();
  for (const [taxiRef, { osmToApp }] of taxiwayGroups) {
    for (const [osmId, appId] of osmToApp) {
      if (!osmToApps.has(osmId)) osmToApps.set(osmId, []);
      osmToApps.get(osmId).push({ taxiRef, appId });
    }
  }

  const edges = [];
  for (const apps of osmToApps.values()) {
    if (apps.length < 2) continue;
    // Every pair of app nodes that maps to the same OSM node is an intersection
    for (let i = 0; i < apps.length; i++) {
      for (let j = i + 1; j < apps.length; j++) {
        edges.push({
          type: 'intersection',
          from: apps[i].appId,
          to:   apps[j].appId,
          dist_ft: 0   // same physical point
        });
      }
    }
  }

  return edges;
}

// ─────────────────────────────────────────────────────────────────────────────
// Gate / parking position processing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Determine terminal number from OSM tags.
 * OSM may have terminal=1/2/3/5 or we can infer from gate cluster position.
 */
function inferTerminal(tags, lat, lon) {
  // Direct tag
  if (tags.terminal) {
    const t = parseInt(tags.terminal);
    if (!isNaN(t)) return String(t);
  }
  // Infer from gate letter prefix (ORD-specific knowledge)
  const ref = tags.ref ?? '';
  const letter = ref.match(/^([A-Z])/)?.[1];
  const LETTER_TO_TERMINAL = {
    K: '1', H: '2', B: '2', C: '2',
    F: '3', G: '3', T: '3',
    E: '5', L: '5', M: '5',
  };
  if (letter && LETTER_TO_TERMINAL[letter]) return LETTER_TO_TERMINAL[letter];
  // Fallback: cluster by longitude (Terminal 5 is easternmost)
  if (lon > -87.895) return '5';
  if (lon < -87.922) return '3';
  return '2';
}

/**
 * Determine gate type from OSM tags.
 */
function inferGateType(tags) {
  const aircraft = tags.aircraft ?? '';
  if (/widebody|heavy/i.test(aircraft)) return 'widebody';
  const ref = tags.ref ?? '';
  // ORD international gates (M/L/E prefix) are widebody
  if (/^[MLE]/i.test(ref)) return 'widebody_intl';
  return 'narrowbody';
}

/**
 * Find the nearest named taxiway node to a gate, for the taxiway_exit field.
 */
function nearestTaxiwayExit(gateLat, gateLon, allNodes) {
  let best = null, bestD = Infinity;
  for (const node of allNodes) {
    const d = distFt(gateLat, gateLon, node.lat, node.lon);
    if (d < bestD) { bestD = d; best = node.id; }
  }
  return best ?? 'A01';
}

// ─────────────────────────────────────────────────────────────────────────────
// Main conversion
// ─────────────────────────────────────────────────────────────────────────────

function main() {
  // Load inputs
  const osm     = readJSON('ord_osm_raw.json');
  const origRwy = readJSON('ord_runways.json');

  const elements = osm.elements ?? [];
  const nodeMap  = buildNodeMap(elements);

  console.log(`\nParsed OSM: ${elements.filter(e=>e.type==='node').length} nodes, `
    + `${elements.filter(e=>e.type==='way').length} ways`);

  // ── Runways ───────────────────────────────────────────────────────────────

  const rwyWays = waysByAeroway(elements, 'runway');
  console.log(`Found ${rwyWays.length} runway way(s) in OSM`);

  const newRunways = [];

  // ── Two-pass matching ─────────────────────────────────────────────────────
  // Pass 1: exact ref-tag match (OSM ref = "04R/22L" or reversed "22L/04R")
  // Pass 2: greedy proximity match for any unmatched ways/originals
  //
  // This ensures the real OSM 09R/27L way is always matched to our 09R/27L
  // original, even when a mis-tagged sibling (09C/27C) is also nearby.

  // Compute the center of every original runway for proximity matching.
  const origByCenter = origRwy.runways.map(rw => ({
    rw,
    centerLat: (rw.threshold_a.lat + rw.threshold_b.lat) / 2,
    centerLon: (rw.threshold_a.lon + rw.threshold_b.lon) / 2,
  }));

  const MATCH_THRESHOLD_FT = 4500;

  // Build endpoint node info for every OSM way
  const osmCenters = rwyWays.map(way => {
    const nA = nodeMap.get(way.nodes[0]);
    const nB = nodeMap.get(way.nodes[way.nodes.length - 1]);
    if (!nA || !nB) { console.warn(`  ⚠️  Runway way ${way.id}: endpoints not found`); return null; }
    return { way, nA, nB, cLat: (nA.lat + nB.lat) / 2, cLon: (nA.lon + nB.lon) / 2, ref: way.tags?.ref ?? '' };
  }).filter(Boolean);

  // Build fast lookup: normalised ref → original runway
  const origByRef = new Map();
  for (const { rw } of origByCenter) {
    origByRef.set(rw.id,                  rw);  // "09R/27L"
    origByRef.set(`${rw.id_b}/${rw.id_a}`, rw); // "27L/09R"
  }

  const matchedOsmWayIds  = new Set();
  const matchedOrigRwyIds = new Set();
  const osmToOrig         = new Map(); // OSM way.id → orig rw (null = unmatched)

  // PASS 1 — exact ref match
  for (const osm of osmCenters) {
    const candidate = origByRef.get(osm.ref) ?? origByRef.get(normalizeRunwayRef(osm.ref) ?? '');
    if (!candidate) continue;
    if (matchedOrigRwyIds.has(candidate.id)) continue;
    osmToOrig.set(osm.way.id, candidate);
    matchedOsmWayIds.add(osm.way.id);
    matchedOrigRwyIds.add(candidate.id);
  }

  // PASS 2 — greedy proximity for anything not yet matched
  const proxPairs = [];
  for (const osm of osmCenters) {
    if (matchedOsmWayIds.has(osm.way.id)) continue;
    for (const { rw, centerLat, centerLon } of origByCenter) {
      if (matchedOrigRwyIds.has(rw.id)) continue;
      const d = distFt(osm.cLat, osm.cLon, centerLat, centerLon);
      if (d <= MATCH_THRESHOLD_FT) proxPairs.push({ osm, rw, d });
    }
  }
  proxPairs.sort((a, b) => a.d - b.d);

  for (const { osm, rw } of proxPairs) {
    if (matchedOsmWayIds.has(osm.way.id))  continue;
    if (matchedOrigRwyIds.has(rw.id))       continue;
    osmToOrig.set(osm.way.id, rw);
    matchedOsmWayIds.add(osm.way.id);
    matchedOrigRwyIds.add(rw.id);
  }

  // Any OSM way still unmatched → new runway (use OSM ref for ID)
  for (const osm of osmCenters) {
    if (!osmToOrig.has(osm.way.id)) osmToOrig.set(osm.way.id, null);
  }

  for (const osm of osmCenters) {
    const { way, nA, nB } = osm;
    const orig = osmToOrig.get(way.id) ?? null;
    const osmLen = distFt(nA.lat, nA.lon, nB.lat, nB.lon);

    // Determine correct orientation:
    //   threshold_a = lower-numbered runway end (id_a)
    //   heading_a_true = direction aircraft FLY when using runway id_a
    //                  = bearing FROM threshold_b TOWARD threshold_a
    // If orig matched, orient so that nA side matches orig.threshold_a by proximity.
    let nodeA = nA, nodeB = nB;
    if (orig) {
      const dA_toOrigA = distFt(nA.lat, nA.lon, orig.threshold_a.lat, orig.threshold_a.lon);
      const dA_toOrigB = distFt(nA.lat, nA.lon, orig.threshold_b.lat, orig.threshold_b.lon);
      if (dA_toOrigB < dA_toOrigA) {
        [nodeA, nodeB] = [nB, nA];
      }
    } else {
      // No match: orient so lower-numbered end is nodeA
      const hdgTmp   = bearing(nA.lat, nA.lon, nB.lat, nB.lon);
      const rwyNumTmp = Math.round(hdgTmp / 10) % 36 || 36;
      const oppNum    = rwyNumTmp > 18 ? rwyNumTmp - 18 : rwyNumTmp + 18;
      if (rwyNumTmp < oppNum) [nodeA, nodeB] = [nB, nA];
    }

    // heading_a = bearing B→A (aircraft landing on A), heading_b = A→B
    const heading_a_true = round(bearing(nodeB.lat, nodeB.lon, nodeA.lat, nodeA.lon), 1);
    const heading_b_true = round(bearing(nodeA.lat, nodeA.lon, nodeB.lat, nodeB.lon), 1);
    const lengthFt = Math.round(osmLen);

    // Derive IDs: prefer original file's designators; for unmatched ways use OSM ref tag
    const osmRef = way.tags?.ref ?? '';
    const osmParts = osmRef.split('/').map(s => s.trim());
    let id_a, id_b;
    if (orig) {
      id_a = orig.id_a;
      id_b = orig.id_b;
    } else if (osmParts.length === 2) {
      // Use OSM ref directly, but orient lower number first
      const numA = parseInt(osmParts[0]), numB = parseInt(osmParts[1]);
      [id_a, id_b] = numA <= numB ? [osmParts[0], osmParts[1]] : [osmParts[1], osmParts[0]];
    } else {
      id_a = String(Math.round(heading_a_true / 10) % 36 || 36);
      id_b = String(Math.round(heading_b_true / 10) % 36 || 36);
    }
    const rwyId = `${id_a}/${id_b}`;

    const threshold_a = { runway_end: id_a, lat: round(nodeA.lat), lon: round(nodeA.lon), elevation_ft: orig?.threshold_a?.elevation_ft ?? 668 };
    const threshold_b = { runway_end: id_b, lat: round(nodeB.lat), lon: round(nodeB.lon), elevation_ft: orig?.threshold_b?.elevation_ft ?? 668 };

    const entry = {
      id: rwyId,
      id_a,
      id_b,
      heading_a_mag: orig?.heading_a_mag ?? Math.round((heading_a_true + 2.5 + 360) % 360),
      heading_b_mag: orig?.heading_b_mag ?? Math.round((heading_b_true + 2.5 + 360) % 360),
      heading_a_true,
      heading_b_true,
      length_ft:  orig?.length_ft ?? lengthFt,
      width_ft:   orig?.width_ft  ?? 150,
      threshold_a,
      threshold_b,
      ils: orig?.ils ?? {},
      high_speed_exits: orig?.high_speed_exits ?? {},
      lighting:         orig?.lighting ?? {},
      pcn: orig?.pcn ?? '',
      notes: orig?.notes ?? `OSM way ${way.id}${osmRef ? ` (ref: ${osmRef})` : ''}`,
    };

    newRunways.push(entry);
    const matchNote = orig ? `matched ${orig.id}` : `new (OSM ref: ${osmRef || 'none'})`;
    console.log(`  ✓ Runway ${rwyId}: hdg ${Math.round(heading_a_true)}°/${Math.round(heading_b_true)}°, ${lengthFt.toLocaleString()} ft (${matchNote})`);

  }

  // If OSM returned no runways, fall back to original data with re-computed headings
  if (newRunways.length === 0) {
    console.warn('\n⚠️  No runways found in OSM data. Re-computing headings from existing threshold coords.');
    for (const rw of origRwy.runways) {
      const { threshold_a: ta, threshold_b: tb } = rw;
      // heading_a = B→A (aircraft landing toward A), heading_b = A→B
      const heading_a_true = round(bearing(tb.lat, tb.lon, ta.lat, ta.lon), 1);
      const heading_b_true = round(bearing(ta.lat, ta.lon, tb.lat, tb.lon), 1);
      newRunways.push({ ...rw, heading_a_true, heading_b_true });
      console.log(`  ✓ Runway ${rw.id}: re-computed hdg ${Math.round(heading_a_true)}°/${Math.round(heading_b_true)}°`);
    }
  }

  const runwaysOut = {
    metadata: {
      ...origRwy.metadata,
      last_updated: new Date().toISOString().slice(0, 7),
      source: newRunways.length > 0 ? 'OSM Overpass + FAA (ILS)' : 'Original data (re-computed headings)',
    },
    runways: newRunways,
    runway_configurations: origRwy.runway_configurations ?? [],
    hotspots: origRwy.hotspots ?? [],
  };

  writeJSON('ord_runways.json', runwaysOut);

  // ── Taxiways ──────────────────────────────────────────────────────────────

  const allTaxiwayWays = [
    ...waysByAeroway(elements, 'taxiway'),
    ...waysByAeroway(elements, 'taxilane'),
  ];
  console.log(`\nFound ${allTaxiwayWays.length} taxiway/taxilane way(s) in OSM`);

  // Group ways by ref tag (A, B, C, etc.), recording aeroway subtype per way
  const waysByRef = new Map();
  for (const way of allTaxiwayWays) {
    const ref = way.tags?.ref ?? way.tags?.name ?? 'UNKNOWN';
    if (!waysByRef.has(ref)) waysByRef.set(ref, []);
    waysByRef.get(ref).push(way);
  }

  // ORD taxiway width reference (main taxiways)
  const TAXIWAY_WIDTHS = {
    A: 75, B: 75, C: 75, F: 75, G: 75, H: 75, L: 75, M: 75, R: 75,
    J: 50, K: 50, N: 50, P: 50, Q: 50
  };
  const TAXILANE_WIDTH = 35; // apron taxilanes serving gate rows

  // taxiwayGroups: chainRef → { nodes, osmToApp, baseRef, subtype }
  const taxiwayGroups = new Map();
  const newTaxiways   = [];

  for (const [ref, ways] of waysByRef) {
    if (ref === 'UNKNOWN') continue;

    // Determine subtype from OSM aeroway tag (taxiway vs taxilane)
    const subtype = ways.some(w => w.tags?.aeroway === 'taxilane') ? 'taxilane' : 'taxiway';
    const widthFt = subtype === 'taxilane'
      ? TAXILANE_WIDTH
      : (TAXIWAY_WIDTHS[ref.toUpperCase()] ?? 50);

    // stitchTaxiwayWays now returns an ARRAY of chains (one per disconnected segment)
    const chains = stitchTaxiwayWays(ways, nodeMap, ref);

    for (const { chainRef, nodes, osmToApp } of chains) {
      if (nodes.length < 2) {
        console.warn(`  ⚠️  Chain ${chainRef}: only ${nodes.length} node(s) — skipping`);
        continue;
      }

      taxiwayGroups.set(chainRef, { nodes, osmToApp, ways, baseRef: ref, subtype });

      newTaxiways.push({
        id:       chainRef,
        name:     chainRef === ref ? `Taxiway ${ref}` : `Taxiway ${chainRef}`,
        width_ft: widthFt,
        subtype,
        nodes,
      });

      console.log(`  ✓ ${subtype === 'taxilane' ? 'Lane' : 'Taxiway'} ${chainRef}: ${nodes.length} nodes`);
    }
  }

  // Build graph edges (sequential + intersection)
  const allEdges = [];
  for (const [, { nodes }] of taxiwayGroups) {
    allEdges.push(...buildSequentialEdges(nodes));
  }
  const intersectionEdges = buildIntersectionEdges(taxiwayGroups);
  allEdges.push(...intersectionEdges);
  console.log(`\nBuilt ${allEdges.length} graph edges (${intersectionEdges.length} intersections)`);

  // ── Gates ─────────────────────────────────────────────────────────────────

  const parkingNodes = [
    ...nodesByAeroway(elements, 'parking_position'),
    ...nodesByAeroway(elements, 'gate'),
  ];
  console.log(`Found ${parkingNodes.length} gate/parking position node(s) in OSM`);

  // Build a flat node lookup for exit snapping (prefer taxilane nodes for gates)
  const allTaxiNodes   = newTaxiways.flatMap(tw => tw.nodes);
  const taxilaneNodes  = newTaxiways
    .filter(tw => tw.subtype === 'taxilane')
    .flatMap(tw => tw.nodes);

  // Build nodeId → coords lookup for edge distance calculation
  const nodeCoordMap = new Map();
  for (const n of allTaxiNodes) nodeCoordMap.set(n.id, n);

  const newGates = [];
  const gateRefsSeen = new Set();

  for (const node of parkingNodes) {
    const ref = node.tags?.ref ?? '';
    if (!ref || gateRefsSeen.has(ref)) continue;
    gateRefsSeen.add(ref);

    const lat = round(node.lat);
    const lon = round(node.lon);
    const terminal = inferTerminal(node.tags, lat, lon);
    const gateType = inferGateType(node.tags);

    // Prefer snapping to a taxilane node (apron lane) so pushback lands on the
    // correct apron row rather than jumping onto a main taxiway mid-field.
    // Fall back to all nodes if no taxilane nodes exist near the gate.
    let exitNode = null;
    if (taxilaneNodes.length > 0) {
      // Search taxilane nodes within 500 ft first
      let bestD = Infinity;
      for (const n of taxilaneNodes) {
        const d = distFt(lat, lon, n.lat, n.lon);
        if (d < bestD) { bestD = d; exitNode = n.id; }
      }
      // If nearest taxilane node is too far (>800 ft), fall back to any node.
      if (bestD > 800) exitNode = null;
    }
    if (!exitNode && allTaxiNodes.length > 0) {
      exitNode = nearestTaxiwayExit(lat, lon, allTaxiNodes);
    }
    exitNode = exitNode ?? 'A_01';

    // Compute pushback stand position — offset ~60 ft from OSM gate pin
    // toward the nearest taxiway to give the aircraft room to nose-in.
    const exitCoords = nodeCoordMap.get(exitNode);
    let parkingLat = lat, parkingLon = lon;
    let noseHeading = 90;
    if (exitCoords) {
      const brng = bearing(lat, lon, exitCoords.lat, exitCoords.lon);
      noseHeading = round(brng, 1);
      // Parking stand is 80 ft closer to the taxiway than the OSM gate pin
      const offsetFt = 80;
      const ftPerDegLat = 364_620;
      const ftPerDegLon = 364_620 * Math.cos(lat * Math.PI / 180);
      const brngRad = brng * Math.PI / 180;
      parkingLat = round(lat + Math.cos(brngRad) * (offsetFt / ftPerDegLat));
      parkingLon = round(lon + Math.sin(brngRad) * (offsetFt / ftPerDegLon));
    }

    newGates.push({
      id: ref,
      terminal,
      lat,
      lon,
      type: gateType,
      taxiway_exit: exitNode,
      nose_heading: noseHeading,
      parking_lat:  parkingLat,
      parking_lon:  parkingLon,
    });
  }

  console.log(`Built ${newGates.length} gate entries`);

  // ── Gate connector edges ───────────────────────────────────────────────────
  // Each gate stand position becomes a first-class graph node (id = GATE_<ref>).
  // A connector edge links it bidirectionally to its taxiway_exit node so
  // Dijkstra can route aircraft from/to every gate.
  let gateEdgeCount = 0;
  for (const gate of newGates) {
    if (!gate.taxiway_exit) continue;
    const exitCoords = nodeCoordMap.get(gate.taxiway_exit);
    if (!exitCoords) continue;
    const d = Math.round(distFt(gate.parking_lat, gate.parking_lon, exitCoords.lat, exitCoords.lon));
    allEdges.push({ type: 'gate_connector', from: `GATE_${gate.id}`, to: gate.taxiway_exit, dist_ft: d });
    gateEdgeCount++;
  }
  console.log(`Added ${gateEdgeCount} gate connector edge(s)`);

  // Hold-short positions
  const holdNodes = nodesByAeroway(elements, 'holding_position');
  const newHoldShorts = holdNodes.map(n => ({
    id: n.tags?.ref ?? `HS_${n.id}`,
    lat: round(n.lat),
    lon: round(n.lon),
    runway: n.tags?.runway ?? n.tags?.ref ?? '',
  })).filter(h => h.id);
  console.log(`Found ${newHoldShorts.length} hold-short position(s)`);

  // ── Taxiways output ───────────────────────────────────────────────────────

  const taxiwaysOut = {
    metadata: {
      airport: 'KORD',
      description: 'Chicago O\'Hare taxiways, gates, and parking — sourced from OSM Overpass',
      coordinate_system: 'WGS84 decimal degrees',
      source: 'OpenStreetMap Overpass API',
      last_updated: new Date().toISOString().slice(0, 7),
      note: `Generated by scripts/convert_osm.mjs from data/ord_osm_raw.json. ` +
            `Re-run scripts/download_osm.mjs + scripts/convert_osm.mjs to refresh.`,
    },
    taxiways: newTaxiways,
    graph_edges: allEdges,
    hold_short_positions: newHoldShorts,
    gates: newGates,
  };

  writeJSON('ord_taxiways.json', taxiwaysOut);

  console.log('\n✅  Conversion complete.');
  console.log(`   Runways: ${newRunways.length}  Taxiways: ${newTaxiways.length}  Gates: ${newGates.length}`);
  console.log('   Next: run `npm run dev` and verify visual alignment at zoom ≥ 15.');
}

main();
