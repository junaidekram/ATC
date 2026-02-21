/**
 * curveUtils.ts
 * Shared Catmull-Rom spline interpolation used by TaxiwayLayer and TaxiwayEditorLayer.
 */

/**
 * Catmull-Rom spline interpolation.
 * Given a polyline of control points, inserts `steps` intermediate points
 * between each consecutive pair, producing a smooth curved path.
 */
export function catmullRom(
  pts: { lat: number; lon: number }[],
  steps = 5,
): { lat: number; lon: number }[] {
  if (pts.length < 2) return pts;
  const out: { lat: number; lon: number }[] = [];

  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];

    for (let s = 0; s < steps; s++) {
      const t  = s / steps;
      const t2 = t * t;
      const t3 = t2 * t;
      out.push({
        lat: 0.5 * (
          (2 * p1.lat) +
          (-p0.lat + p2.lat) * t +
          (2 * p0.lat - 5 * p1.lat + 4 * p2.lat - p3.lat) * t2 +
          (-p0.lat + 3 * p1.lat - 3 * p2.lat + p3.lat) * t3
        ),
        lon: 0.5 * (
          (2 * p1.lon) +
          (-p0.lon + p2.lon) * t +
          (2 * p0.lon - 5 * p1.lon + 4 * p2.lon - p3.lon) * t2 +
          (-p0.lon + 3 * p1.lon - 3 * p2.lon + p3.lon) * t3
        ),
      });
    }
  }
  // Always include the exact final point
  out.push(pts[pts.length - 1]);
  return out;
}
