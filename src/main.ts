import { MapController } from './map/MapController';
import { RunwayLayer } from './map/RunwayLayer';
import { TaxiwayLayer } from './map/TaxiwayLayer';
import { GateLayer, type Gate } from './map/GateLayer';
import { TaxiwayEditorLayer } from './map/TaxiwayEditorLayer';
import { EditorPanel } from './ui/EditorPanel';
import { AircraftLayer } from './map/AircraftLayer';
import { TaxiRouteLayer } from './map/TaxiRouteLayer';
import { RouteDrawer } from './map/RouteDrawer';
import { PushbackDrawer } from './map/PushbackDrawer';
import { DataLoader } from './data/DataLoader';
import { Aircraft } from './aircraft/Aircraft';
import { FlightPhase } from './aircraft/FlightPhase';
import { Physics } from './aircraft/Physics';
import { SimLoop } from './simulation/SimLoop';
import { CommsLog } from './ui/CommsLog';
import { AircraftInfoPanel } from './ui/AircraftInfoPanel';
import { RequestsPanel } from './ui/RequestsPanel';
import { ArrivalsPanel } from './ui/ArrivalsPanel';
import { AtisPanel } from './ui/AtisPanel';
import { CommandParser } from './atc/CommandParser';
import { CommandHandler } from './atc/CommandHandler';
import { SeparationMonitor, type SeparationSeverity } from './atc/SeparationMonitor';
import { TrafficSpawner } from './simulation/TrafficSpawner';

/**
 * Set to `false` once you have drawn and saved your taxiway network and no
 * longer need the editor.  This hides the editor button and removes all
 * editor code paths from the running application.
 */
const EDITOR_ENABLED = true;

/**
 * ATCSimulator — main application class (Phase 3 revised)
 *
 * Key behaviours
 *  - All aircraft spawn PARKED — nothing moves until the controller acts.
 *  - Ground departures auto-request to leave the gate; shown in Requests panel.
 *  - Controller approves pushback, assigns taxi route, and issues takeoff clearance.
 *  - Route can be assigned by draw (click map) or by text command.
 *  - Collision avoidance: aircraft stop behind another ground aircraft.
 *  - Runway protection: no automatic runway entry; every crossing/takeoff needs clearance.
 */
class ATCSimulator {
  private mapController!: MapController;
  private dataLoader: DataLoader;
  private simLoop: SimLoop;
  private commsLog!: CommsLog;
  private aircraftInfoPanel!: AircraftInfoPanel;
  private requestsPanel!: RequestsPanel;
  private arrivalsPanel!: ArrivalsPanel;
  private atis!: AtisPanel;

  private runwayLayer!: RunwayLayer;
  private taxiwayLayer!: TaxiwayLayer;
  private gateLayer!: GateLayer;
  private aircraftLayer!: AircraftLayer;
  private taxiRouteLayer!: TaxiRouteLayer;
  private routeDrawer!: RouteDrawer;
  private pushbackDrawer!: PushbackDrawer;

  // ── Taxiway editor (only active when EDITOR_ENABLED = true) ───────────────
  private taxiwayEditor: TaxiwayEditorLayer | null = null;
  private editorPanel:   EditorPanel        | null = null;

  private commandParser  = new CommandParser();
  private commandHandler!: CommandHandler;
  private separationMonitor!: SeparationMonitor;
  private trafficSpawner!: TrafficSpawner;

  /** Callsign of the currently selected aircraft */
  private selectedCallsign: string | null = null;

  /** Callsigns approved for pushback — shown as success cards briefly */
  private approvedCallsigns = new Set<string>();
  private approvedTimers    = new Map<string, ReturnType<typeof setTimeout>>();

  /** Previous alert IDs — used to detect NEW violations for scoring */
  private prevAlertIds = new Set<string>();

  /** Current session score (starts at 1000, deducts on violations) */
  private score = 1000;

  constructor() {
    this.dataLoader = DataLoader.getInstance();
    this.simLoop    = new SimLoop();
  }

  // ── Initialisation ────────────────────────────────────────────────────────

  async init(): Promise<void> {
    console.log('🚀 Initialising ATC Simulator…');

    await this.dataLoader.loadAll();

    this.mapController = new MapController('map');

    const runwayLG     = this.mapController.getLayer('runways')!;
    const taxiwayLG    = this.mapController.getLayer('taxiways')!;
    const taxiwayLblLG = this.mapController.getLayer('taxiwayLabels')!;
    const ilsLG        = this.mapController.getLayer('ils')!;
    const gateLG       = this.mapController.getLayer('gates')!;
    const aircraftLG   = this.mapController.getLayer('aircraft')!;
    const taxiRouteLG  = this.mapController.getLayer('taxiRoutes')!;

    this.runwayLayer    = new RunwayLayer(runwayLG, ilsLG);
    this.taxiwayLayer   = new TaxiwayLayer(taxiwayLG, taxiwayLblLG);
    this.gateLayer      = new GateLayer(gateLG);
    this.aircraftLayer  = new AircraftLayer(aircraftLG, this.mapController.getMap());
    this.taxiRouteLayer = new TaxiRouteLayer(taxiRouteLG);
    this.routeDrawer    = new RouteDrawer(this.mapController.getMap(), this.dataLoader.getTaxiways());

    this.routeDrawer.onCommit = (callsign, waypoints) => {
      const ac = this.simLoop.findAircraft(callsign);
      if (!ac) return;
      ac.setTaxiWaypoints(waypoints);
      if (ac.phase === FlightPhase.PARKED || ac.phase === FlightPhase.HOLDING_SHORT) {
        ac.setPhase(FlightPhase.TAXI_OUT);
      }
      this.taxiRouteLayer.setRoute(callsign, waypoints);
      this.commsLog.addSystemMessage(`Route assigned to ${callsign}: ${waypoints.length} waypoints`);
      this.setModeIndicator('');
    };

    this.pushbackDrawer = new PushbackDrawer(this.mapController.getMap(), this.dataLoader.getTaxiways());

    this.pushbackDrawer.onConfirm = (callsign, waypoints) => {
      const ac = this.simLoop.findAircraft(callsign);
      if (!ac) return;
      // Apply any controller adjustments to the path, then start moving.
      ac.updatePushbackPath(waypoints);
      ac.confirmPushback();
      this.commsLog.addSystemMessage(`${callsign}: pushback started`);
    };

    this.pushbackDrawer.onCancel = (callsign) => {
      const ac = this.simLoop.findAircraft(callsign);
      if (!ac) return;
      ac.cancelPushback();
      this.commsLog.addSystemMessage(`${callsign}: pushback cancelled`);
    };

    this.runwayLayer.renderRunways(this.dataLoader.getRunways());
    this.gateLayer.renderGates(this.dataLoader.getGates());

    // Render taxiways on map (uses custom_taxiways.json if it was loaded by DataLoader)
    this.taxiwayLayer.renderTaxiways(this.dataLoader.getTaxiways());

    // ── Taxiway editor ───────────────────────────────────────────────────────
    if (EDITOR_ENABLED) {
      this.taxiwayEditor = new TaxiwayEditorLayer(
        this.mapController.getMap(),
        this.dataLoader.getGates(),
      );
      this.editorPanel = new EditorPanel(this.taxiwayEditor);

      // Pre-populate editor with any already-saved custom taxiways so users
      // can resume editing without losing previously drawn lines.
      try {
        const resp = await fetch('/data/custom_taxiways.json');
        if (resp.ok) {
          const saved = await resp.json() as {
            taxiways?: Array<{
              id: string; name: string; width_ft: number; subtype: string;
              nodes: Array<{ id: string; lat: number; lon: number }>;
            }>;
          };
          if (Array.isArray(saved.taxiways) && saved.taxiways.length > 0) {
            this.taxiwayEditor.loadFromSaved(saved.taxiways);
          }
        }
      } catch { /* no saved file — start fresh */ }
    }

    // ── UI ──────────────────────────────────────────────────────────────────
    this.commsLog         = new CommsLog('comms-log');
    this.aircraftInfoPanel = new AircraftInfoPanel('aircraft-info');
    this.requestsPanel    = new RequestsPanel('requests-panel', 'req-badge');
    this.arrivalsPanel    = new ArrivalsPanel('arrivals-panel');
    this.atis             = new AtisPanel('atis-panel');

    this.commandHandler   = new CommandHandler(this.dataLoader, this.simLoop);
    this.separationMonitor = new SeparationMonitor(this.dataLoader.getRunways());
    this.trafficSpawner   = new TrafficSpawner(this.dataLoader, this.simLoop,
                              (ac) => {
                                this.aircraftLayer.renderAircraft(ac);
                                this.commsLog.addSystemMessage(
                                  `${ac.callsign}: KSLC Approach, ${ac.callsign} with you, ` +
                                  `${Math.round(ac.altitude / 100) * 100} ft`
                                );
                              });

    this.setupEventListeners();
    this.loadAllAircraft();

    this.simLoop.onUpdate(() => this.updateDisplay());
    this.simLoop.start();

    const totalAc = this.simLoop.getAircraft().length;
    const gateAc  = this.simLoop.getAircraft().filter(a => a.getState().gateId).length;
    const airAc   = totalAc - gateAc;
    this.commsLog.addSystemMessage('KSLC Tower & Ground online');
    this.commsLog.addSystemMessage(
      `${totalAc} aircraft loaded — ${gateAc} at gates, ${airAc} airborne | ` +
      `${this.dataLoader.getRunways().length} runways`
    );
    this.commsLog.addSystemMessage('Departure requests incoming…');

    console.log('✅ ATC Simulator ready');
  }

  // ── Aircraft loading ──────────────────────────────────────────────────────

  /**
   * Load all sample flights.
   *   - Gate-parked departures → PARKED at their gate; will request pushback.
   *   - Airborne arrivals / in-flight aircraft → correct phase, altitude, speed.
   *   - Non-gate ground aircraft (taxi/pushback/holding_short) → PARKED so
   *     the player explicitly controls them.
   */
  private loadAllAircraft(): void {
    const sampleFlights = this.dataLoader.getSampleFlights();
    const gates         = this.dataLoader.getGates();
    const gateMap       = new Map<string, Gate>();
    for (const g of gates) gateMap.set(g.id, g);

    /** JSON phase string → FlightPhase for airborne / approach aircraft */
    const AIRBORNE_MAP: Record<string, FlightPhase> = {
      APPROACH:   FlightPhase.APPROACH,
      FINAL:      FlightPhase.FINAL,
      CLIMBING:   FlightPhase.CLIMBING,
      CRUISE:     FlightPhase.CRUISE,
      DESCENDING: FlightPhase.DESCENDING,
      LANDING:    FlightPhase.LANDING,
    };

    let loaded = 0, skipped = 0;

    for (const fd of sampleFlights) {
      try {
        let position:    { lat: number; lon: number } | undefined;
        let heading    = fd.initial_heading ?? fd.current_heading ?? 360;
        let altitude   = 4227;   // ft MSL — default field elevation
        let speed      = 0;     // kts
        let phase      = FlightPhase.PARKED;
        const gateId   = fd.gate ?? null;

        const jsonPhase = (fd.phase ?? 'PARKED').toUpperCase();

        if (fd.gate) {
          // ── Gate-parked departure ───────────────────────────────────────
          // Always force PARKED at gate regardless of JSON phase field,
          // so pushback is always player-authorised.
          const g = gateMap.get(fd.gate);
          if (g) {
            position = { lat: g.parking_lat ?? g.lat, lon: g.parking_lon ?? g.lon };
            heading  = g.nose_heading ?? heading;
          } else {
            position = fd.current_position ?? fd.initial_position;
          }
          phase    = FlightPhase.PARKED;
          altitude = 4227;
          speed    = 0;

        } else if (AIRBORNE_MAP[jsonPhase]) {
          // ── Airborne / approach aircraft ────────────────────────────────
          position = fd.initial_position ?? fd.current_position;
          altitude = fd.initial_altitude_ft ?? fd.current_altitude_ft ?? 4227;
          speed    = fd.initial_speed_kts   ?? fd.current_speed_kts   ?? 0;
          phase    = AIRBORNE_MAP[jsonPhase];
          // For approach, set target heading toward SLC so the aircraft
          // actually tracks inbound even before the player issues clearance.
          if (phase === FlightPhase.APPROACH || phase === FlightPhase.CLIMBING) {
            // target heading is already set as initial_heading in JSON
          }

        } else {
          // ── Non-gate ground aircraft (taxi, pushback, holding_short) ────
          // Spawn as PARKED so player controls every movement.
          position = fd.current_position ?? fd.initial_position;
          phase    = FlightPhase.PARKED;
          altitude = 4227;
          speed    = 0;
        }

        if (!position) {
          console.warn(`No position for ${fd.callsign} — skipping`);
          skipped++;
          continue;
        }

        const aircraft = new Aircraft({
          callsign:        fd.callsign,
          flightNumber:    fd.flight_number   ?? fd.callsign,
          airlineIcao:     fd.airline_icao    ?? 'UNK',
          aircraftType:    fd.aircraft_type   ?? 'B737',
          originIcao:      fd.origin_icao     ?? '????',
          originCity:      fd.origin_city     ?? fd.origin_icao ?? '—',
          destinationIcao: fd.destination_icao ?? 'KSLC',
          destinationCity: fd.destination_city ?? fd.destination_icao ?? '—',
          position,
          altitude,
          speed,
          heading,
          phase,
          assignedRunway:  fd.assigned_runway ?? null,
          assignedTaxiRoute: null,
          squawk:          fd.squawk ?? 7000,

          targetAltitude:  phase === FlightPhase.CLIMBING  ? (altitude + 10_000) : null,
          targetSpeed:     phase === FlightPhase.CLIMBING  ? speed : null,
          targetHeading:   (phase === FlightPhase.APPROACH || phase === FlightPhase.CLIMBING)
                            ? heading : null,
          turnDirection:   'auto',

          taxiWaypoints:              null,
          taxiWaypointIndex:          0,
          pushbackFaceHeading:        null,
          pushbackDistanceTraveled:   0,
          pushbackTargetDistance:     0,
          pushbackWaypoints:          null,
          pushbackWaypointIndex:      0,

          ifrCleared:        false,
          takeoffClearance:  false,
          takeoffHeading:    null,
          initialClimbAlt:   5000,

          approachRunway:    phase === FlightPhase.APPROACH ? fd.assigned_runway ?? null : null,
          landingClearance:  false,
          onILS:             false,
          climbTargetAlt:    null,

          departureRequest:  false,
          gateId,
          pendingRunwayCrossing: null,

          holdingFix:        null,
          holdingAngleDeg:   0,
          holdingRadiusNM:   1.5,
        });

        this.simLoop.addAircraft(aircraft);
        this.aircraftLayer.renderAircraft(aircraft);
        loaded++;
      } catch (e) {
        console.warn(`Skipped ${fd.callsign}:`, e);
        skipped++;
      }
    }

    console.log(`✈ Loaded ${loaded} aircraft, ${skipped} skipped`);

    // Only gate-parked aircraft ever request pushback
    this.scheduleGateDepartureRequests();
  }

  /**
   * Stagger pushback requests for gate-parked departures only.
   * Arrivals and in-flight aircraft NEVER request pushback.
   * Formula: delays are quadratic so aircraft trickle in naturally over ~15 min.
   */
  private scheduleGateDepartureRequests(): void {
    const gateAircraft = this.simLoop.getAircraft()
      .filter(ac => ac.getState().gateId !== null && ac.phase === FlightPhase.PARKED);

    gateAircraft.forEach((ac, i) => {
      // Quadratic growth + deterministic jitter — no randomness so replays are consistent
      const jitterMs = ((i * 7 + 3) % 11) * 1_000;      // 0–10 s jitter
      const baseMs   = 2_000 + i * i * 300;              // 2 s, grows to ~10 min for #50
      const delayMs  = baseMs + jitterMs;

      setTimeout(() => {
        // Double-check the aircraft is still parked (could have been removed)
        const still = this.simLoop.findAircraft(ac.callsign);
        if (!still || still.phase !== FlightPhase.PARKED) return;
        still.requestDeparture();
        this.commsLog.addAircraftMessage(
          `${ac.callsign}: Ground, ${ac.callsign} at gate ${ac.getState().gateId}, requesting pushback and taxi`
        );
      }, delayMs);
    });
  }

  // ── Display update loop ───────────────────────────────────────────────────

  private updateDisplay(): void {
    const aircraft = this.simLoop.getAircraft();

    // ── Auto-remove aircraft that have left the simulation boundary ────────
    this.autoRemoveAircraft(aircraft);

    // ── Separation monitoring (Phase 4) ───────────────────────────────────
    const alerts = this.separationMonitor.check(aircraft);
    this.processAlerts(alerts);

    // Auto-stop aircraft at runway hold-short lines
    this.enforceRunwayHoldShort(aircraft);

    // Render aircraft positions
    aircraft.forEach(ac => this.aircraftLayer.renderAircraft(ac));

    // Update requests panel
    this.requestsPanel.update(aircraft, this.approvedCallsigns);

    // Update arrivals panel
    this.arrivalsPanel.update(aircraft);

    // Refresh selected aircraft info panel
    if (this.selectedCallsign) {
      const ac = this.simLoop.findAircraft(this.selectedCallsign);
      if (ac) this.aircraftInfoPanel.refreshIfShowing(ac.getState());
    }

    // Clear taxi route for departed / arrived aircraft
    aircraft.forEach(ac => {
      if (ac.phase === FlightPhase.CLIMBING || ac.phase === FlightPhase.ARRIVED) {
        this.taxiRouteLayer.clearRoute(ac.callsign);
      }
    });

    this.updateHeader();
    this.updateAlertBar(alerts);
    this.updateAtisDisplay();
    this.refreshCallsignDatalist(aircraft);
  }

  /** Keep the callsign autocomplete datalist in sync with active aircraft */
  private refreshCallsignDatalist(aircraft: Aircraft[]): void {
    const dl = document.getElementById('callsign-datalist');
    if (!dl) return;
    const existing = new Set(Array.from(dl.querySelectorAll('option')).map(o => (o as HTMLOptionElement).value));
    const current  = new Set(aircraft.map(ac => ac.callsign));
    // Add new callsigns
    for (const cs of current) {
      if (!existing.has(cs)) {
        const opt = document.createElement('option');
        opt.value = cs;
        dl.appendChild(opt);
      }
    }
    // Remove stale callsigns
    for (const opt of Array.from(dl.querySelectorAll('option'))) {
      if (!current.has((opt as HTMLOptionElement).value)) dl.removeChild(opt);
    }
  }

  /** SLC centre (used for distance checks) */
  private static readonly ORD_LAT = 40.7884;
  private static readonly ORD_LON = -111.9779;
  /** Boundary in NM — aircraft beyond this are removed from the sim */
  private static readonly REMOVAL_DIST_NM = 55;

  /**
   * Remove aircraft that have flown outside the 55 NM boundary (departures)
   * or have been ARRIVED for longer than 45 sim-seconds (arrivals at gate).
   */
  private autoRemoveAircraft(aircraft: Aircraft[]): void {
    const removable: string[] = [];
    for (const ac of aircraft) {
      // Departed aircraft that flew out of range
      const airbornePhases = [
        FlightPhase.CLIMBING, FlightPhase.CRUISE, FlightPhase.DESCENDING,
      ];
      if (airbornePhases.includes(ac.phase)) {
        const dist = this.nmFrom(ac.position.lat, ac.position.lon,
          ATCSimulator.ORD_LAT, ATCSimulator.ORD_LON);
        if (dist > ATCSimulator.REMOVAL_DIST_NM) {
          removable.push(ac.callsign);
          this.commsLog.addSystemMessage(
            `${ac.callsign} handed off — exiting KSLC TRACON`
          );
          this.addScore(50); // reward for successful departure
        }
      }
      // Arrived aircraft that have been parked long enough
      if (ac.phase === FlightPhase.ARRIVED) {
        this.arrivedTimers.set(ac.callsign,
          (this.arrivedTimers.get(ac.callsign) ?? 0) + 1);
        if ((this.arrivedTimers.get(ac.callsign) ?? 0) > 150) { // ~15 real-sec
          removable.push(ac.callsign);
          this.arrivedTimers.delete(ac.callsign);
          this.commsLog.addSystemMessage(
            `${ac.callsign} at gate — arrival complete`
          );
          this.addScore(50); // reward for successful arrival
        }
      }
    }

    for (const cs of removable) {
      this.simLoop.removeAircraft(cs);
      this.aircraftLayer.removeAircraft(cs);
      this.taxiRouteLayer.clearRoute(cs);
      if (this.selectedCallsign === cs) {
        this.selectedCallsign = null;
        this.aircraftInfoPanel.clear();
      }
    }

    // Spawn replacement traffic when aircraft count drops below threshold
    this.trafficSpawner.tick(this.simLoop.getAircraft());
  }

  private nmFrom(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R    = 3440.065;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a    = Math.sin(dLat / 2) ** 2 +
                 Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                 Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  /** Track how long each ARRIVED aircraft has been at the gate (sim-ticks) */
  private arrivedTimers = new Map<string, number>();

  /** Update the ATIS display overlay on the map */
  private updateAtisDisplay(): void {
    const runways = this.dataLoader.getRunways();
    const aircraft = this.simLoop.getAircraft();
    // Find runways in use for departure (TAKEOFF/LINEUP) and arrival (LANDING/FINAL)
    const departingOn = new Set<string>();
    const arrivingOn  = new Set<string>();
    for (const ac of aircraft) {
      if (ac.assignedRunway) {
        if ([FlightPhase.TAKEOFF, FlightPhase.LINEUP].includes(ac.phase)) {
          departingOn.add(ac.assignedRunway);
        }
        if ([FlightPhase.LANDING, FlightPhase.FINAL, FlightPhase.APPROACH].includes(ac.phase)) {
          arrivingOn.add(ac.assignedRunway);
        }
      }
    }
    this.atis.setActiveRunways(
      [...departingOn].join(', ') || '—',
      [...arrivingOn].join(', ')  || '—'
    );
  }

  // ── Separation alert processing ────────────────────────────────────────────

  private processAlerts(alerts: ReturnType<typeof this.separationMonitor.check>): void {
    // Build per-callsign severity map
    const sevMap = new Map<string, SeparationSeverity>();
    const newIds = new Set<string>();
    for (const a of alerts) {
      newIds.add(a.id);
      for (const cs of a.callsigns) {
        const prev = sevMap.get(cs);
        if (!prev || (a.severity === 'critical' && prev === 'warning')) {
          sevMap.set(cs, a.severity);
        }
      }
    }

    this.aircraftLayer.setAlerts(sevMap);

    // Score deductions for NEW alerts only (avoids spamming per-tick)
    for (const a of alerts) {
      if (!this.prevAlertIds.has(a.id)) {
        const penalty = a.severity === 'critical' ? 100 : 25;
        this.addScore(-penalty);
        this.commsLog.addErrorMessage(
          `⚠ ${a.severity.toUpperCase()} ${a.message}`
        );
      }
    }
    this.prevAlertIds = newIds;
  }

  /** Auto-hold any TAXI_OUT aircraft that reaches a runway hold-short line */
  private enforceRunwayHoldShort(aircraft: Aircraft[]): void {
    const incursions = this.separationMonitor.findRunwayIncursions(aircraft);
    for (const { callsign, runwayId, ac } of incursions) {
      // Only trigger once per runway
      if (ac.pendingRunwayCrossing === runwayId) continue;
      ac.setPhase(FlightPhase.HOLDING_SHORT);
      ac.setPendingRunwayCrossing(runwayId);
      this.commsLog.addAircraftMessage(
        `${callsign}: Holding short runway ${runwayId}, awaiting crossing clearance`
      );
      // Switch to RUNWAY tab so player sees the hold
      this.switchTab('requests');
    }
  }

  /** Update the separation alert overlay above the map */
  private updateAlertBar(alerts: ReturnType<typeof this.separationMonitor.check>): void {
    let bar = document.getElementById('sep-alert-bar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'sep-alert-bar';
      bar.className = 'sep-alert-bar';
      document.querySelector('.map-container')?.appendChild(bar);
    }

    const criticals = alerts.filter(a => a.severity === 'critical');
    if (criticals.length === 0) {
      bar.innerHTML = '';
      return;
    }

    bar.innerHTML = criticals.slice(0, 3).map(a =>
      `<div class="sep-alert sep-alert--critical">⚠ ${a.message}</div>`
    ).join('');
  }

  private updateHeader(): void {
    const timeEl  = document.getElementById('sim-time');
    const countEl = document.getElementById('aircraft-count');
    const scoreEl = document.getElementById('score-display');
    if (timeEl)  timeEl.textContent  = new Date().toUTCString().split(' ')[4] + 'Z';
    if (countEl) countEl.textContent = `${this.simLoop.getAircraft().length} aircraft`;
    if (scoreEl) scoreEl.textContent = `Score: ${this.score}`;
  }

  private addScore(delta: number): void {
    this.score = Math.max(0, this.score + delta);
    const el = document.getElementById('score-display');
    if (el && delta < 0) {
      el.classList.remove('hdr-score--penalty');
      void el.offsetWidth; // reflow to restart animation
      el.classList.add('hdr-score--penalty');
      setTimeout(() => el.classList.remove('hdr-score--penalty'), 1200);
    }
  }

  // ── Event listeners ───────────────────────────────────────────────────────

  private setupEventListeners(): void {
    // Map layer toggles
    this.bindToggle('center-map',      () => this.mapController.centerOnAirport());
    this.bindLayerBtn('toggle-taxiways', ['taxiways','taxiwayLabels']);
    this.bindLayerBtn('toggle-ils',      ['ils']);
    this.bindLayerBtn('toggle-gates',    ['gates']);

    // Taxiway editor toggle (only wired when EDITOR_ENABLED = true)
    if (EDITOR_ENABLED && this.taxiwayEditor && this.editorPanel) {
      const editorBtn = document.getElementById('toggle-editor');
      if (editorBtn) {
        editorBtn.addEventListener('click', () => {
          const panel = this.editorPanel!;
          const editor = this.taxiwayEditor!;
          const nowVisible = !panel.isShowing();
          if (nowVisible) {
            panel.show();
            editor.enable();
            this.setAircraftVisible(false);  // Hide aircraft during editing
            editorBtn.classList.add('active');
          } else {
            panel.hide();
            editor.disable();
            this.setAircraftVisible(true);   // Restore aircraft visibility
            editorBtn.classList.remove('active');
          }
        });
      }
    } else {
      // Hide the button entirely when editor is disabled
      const editorBtn = document.getElementById('toggle-editor');
      if (editorBtn) editorBtn.style.display = 'none';
    }

    // Sim speed buttons
    document.querySelectorAll<HTMLButtonElement>('[data-speed]').forEach(btn => {
      btn.addEventListener('click', () => {
        const spd = parseInt(btn.dataset.speed ?? '10', 10);
        this.simLoop.setSpeed(spd);
        document.querySelectorAll('[data-speed]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.commsLog.addSystemMessage(`Simulation speed: ${spd}×`);
      });
    });

    // Command input
    const cmdInput = document.getElementById('command-input') as HTMLInputElement | null;
    cmdInput?.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        const cmd = cmdInput.value.trim();
        if (cmd) { this.handleCommand(cmd); cmdInput.value = ''; }
      }
    });

    // Tab switching
    document.querySelectorAll<HTMLButtonElement>('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        if (!tab) return;
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(`tab-${tab}`)?.classList.add('active');
      });
    });

    // Custom events from UI components
    window.addEventListener('atc-command', ((e: CustomEvent) => {
      const cmd: string = e.detail?.command ?? '';
      if (cmd) {
        // Show in comms then process
        this.handleCommand(cmd);
      }
    }) as EventListener);

    window.addEventListener('open-route-drawer', ((e: CustomEvent) => {
      const callsign: string = e.detail?.callsign ?? '';
      if (callsign) {
        this.routeDrawer.start(callsign);
        this.setModeIndicator(`ROUTE DRAW: ${callsign}`);
        this.commsLog.addSystemMessage(`Route draw mode activated for ${callsign} — click taxiway nodes on map`);
      }
    }) as EventListener);

    window.addEventListener('select-aircraft', ((e: CustomEvent) => {
      const callsign: string = e.detail?.callsign ?? '';
      const ac = this.simLoop.findAircraft(callsign);
      if (ac) {
        this.selectedCallsign = callsign;
        this.aircraftLayer.setSelected(callsign);
        this.aircraftInfoPanel.displayAircraft(ac.getState());
        // Switch to INFO tab
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
        document.querySelector('[data-tab="info"]')?.classList.add('active');
        document.getElementById('tab-info')?.classList.add('active');
        // Pan map to aircraft
        this.mapController.getMap().panTo([ac.position.lat, ac.position.lon]);
      }
    }) as EventListener);

    // Aircraft click on map → select
    window.addEventListener('aircraft-selected', ((e: CustomEvent) => {
      const state = e.detail;
      if (state?.callsign) {
        this.selectedCallsign = state.callsign;
        this.aircraftLayer.setSelected(state.callsign);
      }
    }) as EventListener);
  }

  // ── Command handling ──────────────────────────────────────────────────────

  private handleCommand(command: string): void {
    this.commsLog.addPlayerMessage(command);

    // Handle internal pseudo-command for departure request
    const reqMatch = command.match(/^REQUEST_DEPARTURE\s+(\S+)$/i);
    if (reqMatch) {
      const callsign = reqMatch[1].toUpperCase();
      const ac = this.findAircraftFuzzy(callsign);
      if (ac) {
        ac.requestDeparture();
        this.commsLog.addAircraftMessage(`${ac.callsign}: Ground, requesting pushback and taxi`);
      } else {
        this.commsLog.addErrorMessage(`Aircraft ${callsign} not found`);
      }
      return;
    }

    const parsed = this.commandParser.parse(command);
    if (!parsed) {
      this.commsLog.addErrorMessage(`UNRECOGNISED COMMAND — ${command}`);
      return;
    }

    const result = this.commandHandler.execute(parsed);

    if (result.error) {
      this.commsLog.addErrorMessage(result.error);
    } else if (result.readback) {
      this.commsLog.addAircraftMessage(result.readback);
      // Auto-switch to COMMS tab on read-back so player sees the reply
      this.switchTab('comms');
    }

    // ── Pushback approved → show interactive path editor on the map ───────────
    if (parsed.type === 'PUSH_BACK' && !result.error) {
      const cs = parsed.callsign.toUpperCase();

      // Brief badge notification in the requests panel
      this.approvedCallsigns.add(cs);
      if (this.approvedTimers.has(cs)) clearTimeout(this.approvedTimers.get(cs)!);
      const t = setTimeout(() => {
        this.approvedCallsigns.delete(cs);
        this.approvedTimers.delete(cs);
      }, 2_000);
      this.approvedTimers.set(cs, t);

      // Launch the interactive pushback path editor.
      const ac = this.findAircraftFuzzy(cs);
      if (ac) {
        let wpts = ac.getState().pushbackWaypoints;
        if (!wpts || wpts.length === 0) {
          // No gate data — generate a default straight-back point.
          const reverseHdg = (ac.heading + 180 + 360) % 360;
          const fallback   = Physics.updatePosition(
            ac.position.lat, ac.position.lon,
            reverseHdg, 4,
            /* seconds to cover ~250 ft at 4 kts */ 37.8,
          );
          wpts = [{ lat: fallback.lat, lon: fallback.lon, nodeId: 'fallback_0' }];
        }
        this.pushbackDrawer.start(ac.callsign, ac.position, wpts);
      }
    }

    // Draw/update taxi route on map after TAXI command
    if (parsed.type === 'TAXI' && !result.error) {
      const cs = parsed.callsign.toUpperCase();
      const ac = this.findAircraftFuzzy(cs);
      if (ac) {
        const wpts = ac.getState().taxiWaypoints;
        if (wpts && wpts.length > 0) this.taxiRouteLayer.setRoute(ac.callsign, wpts);
      }
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private findAircraftFuzzy(callsign: string): Aircraft | undefined {
    const upper = callsign.toUpperCase();
    return (
      this.simLoop.findAircraft(upper) ??
      this.simLoop.getAircraft().find(a => a.callsign.startsWith(upper.slice(0, 3)))
    );
  }

  private bindToggle(id: string, action: () => void): void {
    document.getElementById(id)?.addEventListener('click', action);
  }

  private bindLayerBtn(id: string, layers: string[]): void {
    document.getElementById(id)?.addEventListener('click', e => {
      const btn = e.currentTarget as HTMLButtonElement;
      let on = false;
      layers.forEach(l => { on = this.mapController.toggleLayer(l as Parameters<typeof this.mapController.toggleLayer>[0]); });
      btn.classList.toggle('active', on);
    });
  }

  private switchTab(tab: 'requests' | 'comms' | 'info' | 'arrivals'): void {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
    document.querySelector(`[data-tab="${tab}"]`)?.classList.add('active');
    document.getElementById(`tab-${tab}`)?.classList.add('active');
  }

  /** Hide or show aircraft and make them (un)clickable when editing taxiways */
  private setAircraftVisible(visible: boolean): void {
    this.aircraftLayer.setVisible(visible);
  }

  /** Add a method to clear the aircraft info panel */
  private aircraftInfoPanelClear(): void {
    // Use public API if available, otherwise just clear the inner div
    const el = document.getElementById('aircraft-info');
    if (el) el.innerHTML = '<div class="info-placeholder"><div class="info-placeholder-icon">✈</div><p>Select an aircraft</p></div>';
  }

  private setModeIndicator(text: string): void {
    const el = document.getElementById('mode-indicator');
    if (!el) return;
    el.textContent = text;
    el.classList.toggle('active', text.length > 0);
  }
}

// ── Bootstrap ──────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  const app = new ATCSimulator();
  try {
    await app.init();
  } catch (err) {
    console.error('Fatal init error:', err);
    alert('Failed to initialise ATC Simulator. Check console for details.');
  }
});
