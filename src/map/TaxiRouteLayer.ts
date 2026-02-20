import L from 'leaflet';
import type { TaxiWaypoint } from '../aircraft/FlightPhase';

/**
 * Catmull-Rom spline smoothing for the gold taxi-route overlay.
 * Inserts smooth intermediate points so the route curves naturally
 * along taxiway bends rather than connecting waypoints with jagged straights.
 */
function catmullRomRoute(
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
          (2 * p1.lat) + (-p0.lat + p2.lat) * t +
          (2 * p0.lat - 5 * p1.lat + 4 * p2.lat - p3.lat) * t2 +
          (-p0.lat + 3 * p1.lat - 3 * p2.lat + p3.lat) * t3
        ),
        lon: 0.5 * (
          (2 * p1.lon) + (-p0.lon + p2.lon) * t +
          (2 * p0.lon - 5 * p1.lon + 4 * p2.lon - p3.lon) * t2 +
          (-p0.lon + 3 * p1.lon - 3 * p2.lon + p3.lon) * t3
        ),
      });
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/**
 * TaxiRouteLayer
 *
 * Draws and removes the dotted taxi-route overlay on the map when the player
 * issues a TAXI command.  One route polyline per callsign.
 * Routes are smoothed with Catmull-Rom splines for natural curve rendering.
 */
export class TaxiRouteLayer {
  private layerGroup: L.LayerGroup;
  /** callsign → active route polyline */
  private routes: Map<string, L.Polyline> = new Map();

  constructor(layerGroup: L.LayerGroup) {
    this.layerGroup = layerGroup;
  }

  /**
   * Draw (or replace) the taxi route for the given aircraft callsign.
   */
  setRoute(callsign: string, waypoints: TaxiWaypoint[]): void {
    this.clearRoute(callsign);
    if (waypoints.length < 2) return;

    // Apply Catmull-Rom smoothing so the route curves just like the taxiway lines
    const smoothed = catmullRomRoute(waypoints.map(wp => ({ lat: wp.lat, lon: wp.lon })), 5);
    const latLngs: L.LatLngExpression[] = smoothed.map(p => [p.lat, p.lon]);

    const polyline = L.polyline(latLngs, {
      color:       '#FFD700',  // gold
      weight:      3,
      opacity:     0.85,
      dashArray:   '8 6',
    }).addTo(this.layerGroup);

    // Add arrowheads / waypoint dots
    waypoints.forEach((wp, i) => {
      if (i === 0 || i === waypoints.length - 1) {
        L.circleMarker([wp.lat, wp.lon], {
          radius:      4,
          color:       '#FFD700',
          fillColor:   '#FFD700',
          fillOpacity: 1,
          weight:      1,
        }).addTo(this.layerGroup).bindTooltip(
          i === 0 ? `${callsign} start` : `${callsign} destination`,
          { permanent: false, direction: 'top' },
        );
      }
    });

    this.routes.set(callsign, polyline);
  }

  /**
   * Remove the taxi route overlay for the given aircraft.
   */
  clearRoute(callsign: string): void {
    const existing = this.routes.get(callsign);
    if (existing) {
      this.layerGroup.removeLayer(existing);
      this.routes.delete(callsign);
    }
  }

  /**
   * Remove all route overlays.
   */
  clearAll(): void {
    this.layerGroup.clearLayers();
    this.routes.clear();
  }
}
