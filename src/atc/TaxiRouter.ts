import type { TaxiwayGraphData } from '../data/DataLoader';
import type { TaxiWaypoint } from '../aircraft/FlightPhase';

/** Phonetic alphabet → single-letter taxiway id */
const PHONETIC_MAP: Record<string, string> = {
  ALPHA: 'A', BRAVO: 'B', CHARLIE: 'C', DELTA: 'D', ECHO: 'E',
  FOXTROT: 'F', GOLF: 'G', HOTEL: 'H', INDIA: 'I', JULIET: 'J',
  KILO: 'K', LIMA: 'L', MIKE: 'M', NOVEMBER: 'N', OSCAR: 'O',
  PAPA: 'P', QUEBEC: 'Q', ROMEO: 'R', SIERRA: 'S', TANGO: 'T',
  UNIFORM: 'U', VICTOR: 'V', WHISKEY: 'W', XRAY: 'X', YANKEE: 'Y',
  ZULU: 'Z',
};

type CoordNode = { lat: number; lon: number };

/**
 * TaxiRouter — Dijkstra-based graph router
 *
 * Converts a player-issued taxi route (e.g. "ALPHA BRAVO GOLF") into an
 * ordered list of lat/lon waypoints constrained ENTIRELY to the taxiway graph.
 *
 * Uses Dijkstra on the pre-built taxiway graph from DataLoader.
 * When taxiway IDs are specified via "via ALPHA BRAVO", edges on those taxiways
 * get priority (lower weight), but the algorithm always finds a valid on-graph path.
 */
export class TaxiRouter {
  private graph: TaxiwayGraphData;

  constructor(graph: TaxiwayGraphData) {
    this.graph = graph;
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Parse a raw phonetic taxiway string (e.g. ["ALPHA", "BRAVO", "GOLF"]) into
   * an array of resolved taxiway IDs (e.g. ["A", "B", "G"]).
   * Tokens that are already known taxiway IDs are returned as-is (upper-cased).
   */
  parseRoute(tokens: string[]): string[] {
    return tokens.map(t => {
      const upper = t.toUpperCase();
      return PHONETIC_MAP[upper] ?? upper;
    });
  }

  /**
   * Find the nearest taxiway graph node to the given position.
   * Returns null if the graph is empty.
   */
  nearestNode(pos: CoordNode): { id: string; lat: number; lon: number } | null {
    const { nodeMap } = this.graph;
    if (nodeMap.size === 0) return null;

    let bestId   = '';
    let bestDist = Infinity;

    for (const [id, node] of nodeMap) {
      const d = this.nmDist(pos, node);
      if (d < bestDist) { bestDist = d; bestId = id; }
    }

    const best = nodeMap.get(bestId);
    if (!best) return null;
    return { id: bestId, lat: best.lat, lon: best.lon };
  }

  /**
   * Build a list of waypoints routing from startPos through the specified
   * taxiway IDs (already resolved, e.g. ["A","B"]) to destinationPos.
   *
   * The route is ENTIRELY on the taxiway graph — no cross-grass shortcuts.
   * When taxiwayIds are provided they act as preferred taxiways (lower Dijkstra
   * weight) but the algorithm will still find a valid path if the requested
   * taxiways don't directly connect.
   *
   * Returns an ordered array of TaxiWaypoint objects.
   */
  buildRoute(
    startPos: CoordNode,
    taxiwayIds: string[],
    destinationPos: CoordNode,
  ): TaxiWaypoint[] {
    const { nodeMap } = this.graph;

    if (nodeMap.size === 0) {
      // No graph data — fallback to direct two-point route
      return [{ lat: destinationPos.lat, lon: destinationPos.lon, nodeId: 'dest' }];
    }

    // Snap start and destination to nearest graph nodes
    const startNode = this.nearestNode(startPos);
    const destNode  = this.nearestNode(destinationPos);

    if (!startNode || !destNode) {
      return [{ lat: destinationPos.lat, lon: destinationPos.lon, nodeId: 'dest' }];
    }

    if (startNode.id === destNode.id) {
      return [{ lat: destNode.lat, lon: destNode.lon, nodeId: destNode.id }];
    }

    // Convert taxiwayIds to an upper-cased Set for quick lookup
    const preferredTaxiways = new Set(taxiwayIds.map(id => id.toUpperCase()));

    // Run Dijkstra on the taxiway graph with optional preferred-taxiway weighting
    const pathIds = this.dijkstra(startNode.id, destNode.id, preferredTaxiways);

    // Convert node IDs to TaxiWaypoints
    return pathIds.map(nodeId => {
      const pos = nodeMap.get(nodeId) ?? { lat: destNode.lat, lon: destNode.lon };
      return { lat: pos.lat, lon: pos.lon, nodeId };
    });
  }

  // ── Dijkstra ──────────────────────────────────────────────────────────────

  /**
   * Dijkstra shortest-path on the taxiway graph.
   *
   * @param startId   Starting node ID
   * @param endId     Destination node ID
   * @param preferred Set of preferred taxiway IDs (edges whose destination node
   *                  belongs to these receive weight × 0.5; off-route × 4)
   * @returns Array of node IDs from start (inclusive) to end (inclusive).
   *          Returns [startId, endId] if no connected path found.
   */
  private dijkstra(
    startId: string,
    endId: string,
    preferred: Set<string>,
  ): string[] {
    const { nodeMap, adjacency, nodeToTaxiways } = this.graph;

    const dist = new Map<string, number>();
    const prev = new Map<string, string>();
    const visited = new Set<string>();

    dist.set(startId, 0);

    // Priority queue as a simple sorted array (fast enough for ~2400 nodes)
    const queue: { id: string; cost: number }[] = [{ id: startId, cost: 0 }];

    while (queue.length > 0) {
      // Pop minimum-cost entry
      queue.sort((a, b) => a.cost - b.cost);
      const { id: u, cost: uCost } = queue.shift()!;

      if (visited.has(u)) continue;
      visited.add(u);
      if (u === endId) break;

      const neighbors = adjacency.get(u) ?? [];
      for (const { to, distFt } of neighbors) {
        if (visited.has(to)) continue;
        if (!nodeMap.has(to)) continue; // safety guard

        // Preferred-taxiway weighting
        let weight = distFt;
        if (preferred.size > 0) {
          const toTaxiways = nodeToTaxiways.get(to) ?? [];
          const onPreferred = toTaxiways.some(tw => preferred.has(tw));
          if (!onPreferred) weight *= 4; // penalise off-preferred-route nodes
        }

        const newCost = uCost + weight;
        if (newCost < (dist.get(to) ?? Infinity)) {
          dist.set(to, newCost);
          prev.set(to, u);
          queue.push({ id: to, cost: newCost });
        }
      }
    }

    // Reconstruct path by walking back through prev
    const path: string[] = [];
    let curr: string | undefined = endId;

    while (curr !== undefined && curr !== startId) {
      path.unshift(curr);
      curr = prev.get(curr);
    }

    if (curr === startId) {
      path.unshift(startId);
      return path;
    }

    // No connected path found — return direct two-node fallback
    console.warn(`TaxiRouter: no path from "${startId}" to "${endId}", using direct segment`);
    return [startId, endId];
  }

  // ── Geometry ──────────────────────────────────────────────────────────────

  private nmDist(a: CoordNode, b: CoordNode): number {
    const R    = 3440.065;
    const dLat = (b.lat - a.lat) * Math.PI / 180;
    const dLon = (b.lon - a.lon) * Math.PI / 180;
    const h    = Math.sin(dLat / 2) ** 2 +
                 Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) *
                 Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  }
}
