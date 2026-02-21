import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

/** Zoom levels at which each layer becomes visible */
const ZOOM_THRESHOLDS = {
  gates:         12,   // gate markers & labels
  taxiwayLabels: 99,   // taxiway labels disabled (taxiways not rendered)
  ils:           11,   // ILS cones
} as const;

type LayerName = 'runways' | 'taxiways' | 'taxiwayLabels' | 'ils' | 'gates' | 'aircraft' | 'waypoints' | 'taxiRoutes';

/**
 * MapController
 * Manages the Leaflet map instance and all map-related layers.
 * Also handles zoom-dependent layer visibility.
 *
 * Visibility model:
 *   A layer is on the map only when BOTH conditions are true:
 *     1. The user has not explicitly hidden it (userEnabled[name] !== false)
 *     2. The current zoom meets the layer's threshold (or the layer has no threshold)
 *
 *   toggleLayer() sets userEnabled, then re-evaluates.
 *   updateZoomVisibility() re-evaluates zoom conditions without touching userEnabled.
 */
export class MapController {
  private map: L.Map;
  private readonly SLC_CENTER: L.LatLngTuple = [40.7884, -111.9779];
  private layers: Partial<Record<LayerName, L.LayerGroup>> = {};

  /**
   * Tracks whether the user wants each layer visible.
   * undefined = not yet toggled by user (default visible, subject to zoom).
   * true  = user explicitly enabled.
   * false = user explicitly disabled.
   */
  private userEnabled: Partial<Record<LayerName, boolean>> = {};

  constructor(containerId: string) {
    this.map = L.map(containerId, {
      center: this.SLC_CENTER,
      zoom: 14,
      minZoom: 9,
      maxZoom: 18,
      zoomControl: true,
      attributionControl: true
    });

    // Tile layer
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19
    }).addTo(this.map);

    // Initialise layer groups (order matters — lower first = rendered under)
    // taxiways and taxiwayLabels exist for routing but are NOT added to map
    this.layers.ils           = L.layerGroup().addTo(this.map);
    this.layers.taxiways      = L.layerGroup();   // routing only, not on map
    this.layers.taxiwayLabels = L.layerGroup();   // disabled
    this.layers.runways       = L.layerGroup().addTo(this.map);
    this.layers.gates         = L.layerGroup().addTo(this.map);
    this.layers.taxiRoutes    = L.layerGroup().addTo(this.map);
    this.layers.aircraft      = L.layerGroup().addTo(this.map);
    this.layers.waypoints     = L.layerGroup().addTo(this.map);

    L.control.scale({ imperial: true, metric: false }).addTo(this.map);

    // Zoom-dependent visibility
    this.map.on('zoomend', () => this.updateZoomVisibility());
    this.updateZoomVisibility();   // apply on init

    console.log('Map initialised at SLC coordinates:', this.SLC_CENTER);
  }

  /**
   * Evaluate whether each layer should currently be shown, considering both
   * the user's explicit toggle state and the zoom-threshold rules.
   * Called on every zoomend and after every toggleLayer().
   */
  private updateZoomVisibility(): void {
    const z = this.map.getZoom();

    // Returns true if this layer should be visible right now.
    const shouldShow = (name: LayerName, zoomThreshold?: number): boolean => {
      // If user explicitly disabled it, always hide.
      if (this.userEnabled[name] === false) return false;
      // If there is a zoom threshold, enforce it.
      if (zoomThreshold !== undefined && z < zoomThreshold) return false;
      return true;
    };

    const apply = (name: LayerName, zoomThreshold?: number) => {
      const group = this.layers[name];
      if (!group) return;
      const show = shouldShow(name, zoomThreshold);
      if (show  && !this.map.hasLayer(group)) this.map.addLayer(group);
      if (!show &&  this.map.hasLayer(group)) this.map.removeLayer(group);
    };

    // Layers with zoom thresholds
    apply('gates',         ZOOM_THRESHOLDS.gates);
    apply('taxiwayLabels', ZOOM_THRESHOLDS.taxiwayLabels);
    apply('ils',           ZOOM_THRESHOLDS.ils);

    // Layers without zoom thresholds (always visible unless user hid them)
    apply('runways');
    apply('taxiways');
    apply('taxiRoutes');
    apply('aircraft');
    apply('waypoints');
  }

  getMap(): L.Map { return this.map; }

  getLayer(name: LayerName): L.LayerGroup | undefined {
    return this.layers[name];
  }

  centerOnAirport(): void {
    this.map.setView(this.SLC_CENTER, 14);
  }

  /**
   * Toggle a named layer on/off.
   * Records the user's explicit intent and re-evaluates all zoom-threshold
   * rules so the state is always consistent.
   * Returns the new visibility state.
   */
  toggleLayer(name: LayerName): boolean {
    const group = this.layers[name];
    if (!group) return false;

    // Flip the user preference
    const currentlyOn = this.map.hasLayer(group);
    this.userEnabled[name] = !currentlyOn;

    // Let updateZoomVisibility apply the combined rules
    this.updateZoomVisibility();

    return !currentlyOn;
  }

  addMarker(lat: number, lon: number, options?: L.MarkerOptions): L.Marker {
    return L.marker([lat, lon], options).addTo(this.map);
  }

  addPolyline(points: L.LatLngExpression[], options?: L.PolylineOptions): L.Polyline {
    return L.polyline(points, options).addTo(this.map);
  }

  addPolygon(points: L.LatLngExpression[], options?: L.PolylineOptions): L.Polygon {
    return L.polygon(points, options).addTo(this.map);
  }

  getBounds(): L.LatLngBounds { return this.map.getBounds(); }
  getZoom(): number           { return this.map.getZoom(); }

  clearAllLayers(): void {
    Object.values(this.layers).forEach(layer => layer?.clearLayers());
  }

  clearLayer(name: keyof typeof this.layers): void {
    this.layers[name]?.clearLayers();
  }
}
