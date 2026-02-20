/**
 * scripts/download_osm.mjs
 * One-time download of O'Hare aeroway geometry from the Overpass API.
 * Run: node scripts/download_osm.mjs
 * Output: data/ord_osm_raw.json
 */

import https from 'https';
import fs    from 'fs';
import path  from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, '../data/ord_osm_raw.json');

// ORD bounding box  (south, west, north, east)
const BBOX = '41.93,-88.02,42.03,-87.87';

const QUERY = `
[out:json][timeout:90];
(
  way["aeroway"="runway"](${BBOX});
  way["aeroway"="taxiway"](${BBOX});
  way["aeroway"="taxilane"](${BBOX});
  way["aeroway"="holding_position"](${BBOX});
  node["aeroway"="holding_position"](${BBOX});
  node["aeroway"="parking_position"](${BBOX});
  node["aeroway"="gate"](${BBOX});
);
out body;
>;
out skel qt;
`.trim();

const URL = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(QUERY)}`;

console.log('Downloading ORD aeroway data from Overpass API…');
console.log('This may take 15–30 seconds.\n');

https.get(URL, (res) => {
  if (res.statusCode !== 200) {
    console.error(`HTTP ${res.statusCode}: ${res.statusMessage}`);
    process.exit(1);
  }

  const chunks = [];
  res.on('data', (chunk) => chunks.push(chunk));
  res.on('end', () => {
    const raw = Buffer.concat(chunks).toString('utf8');

    // Basic sanity-check — Overpass wraps in {"version":0.6,"elements":[...]}
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      console.error('Failed to parse response JSON');
      process.exit(1);
    }

    const elementCount = parsed.elements?.length ?? 0;
    console.log(`Received ${elementCount} elements from Overpass.`);

    if (elementCount < 50) {
      console.warn('⚠️  Very few elements returned – check bbox or retry if rate-limited.');
    }

    fs.writeFileSync(OUT, JSON.stringify(parsed, null, 2));
    console.log(`✅  Saved → ${path.relative(process.cwd(), OUT)}`);
  });

  res.on('error', (err) => {
    console.error('Response error:', err.message);
    process.exit(1);
  });
}).on('error', (err) => {
  console.error('Request error:', err.message);
  process.exit(1);
});
