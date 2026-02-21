import type { AircraftState } from '../aircraft/FlightPhase';
import { FlightPhase } from '../aircraft/FlightPhase';
import { getAircraftDisplay } from '../aircraft/AircraftConfig';

/**
 * AircraftInfoPanel — Phase 3 revised
 * Shows live aircraft state plus contextual action buttons.
 */
export class AircraftInfoPanel {
  private panelElement: HTMLElement;
  private currentCallsign: string | null = null;

  constructor(elementId: string) {
    const element = document.getElementById(elementId);
    if (!element) throw new Error(`Element with ID "${elementId}" not found`);
    this.panelElement = element;
    this.showDefault();

    window.addEventListener('aircraft-selected', ((e: CustomEvent) => {
      this.displayAircraft(e.detail);
    }) as EventListener);
  }

  get selectedCallsign(): string | null { return this.currentCallsign; }

  private showDefault(): void {
    this.currentCallsign = null;
    this.panelElement.innerHTML = `
      <div class="info-placeholder">
        <div class="info-placeholder-icon">✈</div>
        <p>Click an aircraft on the map to view details</p>
      </div>`;
  }

  displayAircraft(state: AircraftState): void {
    this.currentCallsign = state.callsign;
    const display = getAircraftDisplay(state.aircraftType);
    const altStr  = state.altitude > 4400 ? `${Math.round(state.altitude).toLocaleString()} ft MSL` : 'Ground';
    const spdStr  = state.speed > 0 ? `${Math.round(state.speed)} kts` : 'Stopped';
    const hdgStr  = `${Math.round(state.heading).toString().padStart(3, '0')}°`;

    const routeSection  = this.buildRouteSection(state);
    const actionSection = this.buildActions(state);

    this.panelElement.innerHTML = `
      <div class="info-banner info-banner--${this.phaseCss(state.phase)}">
        <div class="info-callsign">${state.callsign}</div>
        <div class="info-phase">${state.phase.replace(/_/g, ' ')}</div>
      </div>

      <div class="info-body">
        <div class="info-grid">
          <span class="ig-label">Flight</span>
          <span class="ig-value">${state.flightNumber}</span>

          <span class="ig-label">Type</span>
          <span class="ig-value">${display.label}</span>

          <span class="ig-label">Route</span>
          <span class="ig-value">${state.originIcao} → ${state.destinationIcao}</span>

          <span class="ig-label">Alt</span>
          <span class="ig-value">${altStr}</span>

          <span class="ig-label">Speed</span>
          <span class="ig-value">${spdStr}</span>

          <span class="ig-label">Hdg</span>
          <span class="ig-value">${hdgStr}</span>

          ${state.squawk ? `<span class="ig-label">Squawk</span><span class="ig-value">${state.squawk}</span>` : ''}
          ${state.assignedRunway ? `<span class="ig-label">Runway</span><span class="ig-value">${state.assignedRunway}</span>` : ''}
          ${state.assignedTaxiRoute ? `<span class="ig-label">Taxi</span><span class="ig-value">via ${state.assignedTaxiRoute.join(' ')}</span>` : ''}
        </div>

        ${routeSection}
        ${actionSection}
      </div>`;

    this.panelElement.querySelector('[data-action="req-depart"]')?.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('atc-command', {
        detail: { command: `REQUEST_DEPARTURE ${state.callsign}` },
      }));
    });

    this.panelElement.querySelector('[data-action="assign-route"]')?.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('open-route-drawer', {
        detail: { callsign: state.callsign },
      }));
    });

    this.panelElement.querySelector('[data-action="approve-pushback"]')?.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('atc-command', {
        detail: { command: `${state.callsign} PUSH BACK` },
      }));
    });
  }

  /** Refresh display if already showing the same callsign */
  refreshIfShowing(state: AircraftState): void {
    if (this.currentCallsign === state.callsign) this.displayAircraft(state);
  }

  clear(): void { this.showDefault(); }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private buildRouteSection(s: AircraftState): string {
    const wpts = s.taxiWaypoints;
    if (!wpts || wpts.length === 0) return '';
    const done  = s.taxiWaypointIndex;
    const total = wpts.length;
    const pct   = Math.round((done / total) * 100);
    return `
      <div class="info-route">
        <div class="ir-title">Taxi Route <span class="ir-progress">${done}/${total} wpts</span></div>
        <div class="ir-bar"><div class="ir-bar-fill" style="width:${pct}%"></div></div>
      </div>`;
  }

  private buildActions(s: AircraftState): string {
    const btns: string[] = [];

    if (s.phase === FlightPhase.PARKED) {
      if (!s.departureRequest) {
        btns.push(`<button class="info-btn info-btn--request" data-action="req-depart">
          📡 Request Departure</button>`);
      } else {
        btns.push(`<button class="info-btn info-btn--approve" data-action="approve-pushback">
          ✓ Approve Pushback</button>`);
      }
    }

    if ((s.phase === FlightPhase.TAXI_OUT || s.phase === FlightPhase.HOLDING_SHORT) &&
        (!s.taxiWaypoints || s.taxiWaypoints.length === 0)) {
      btns.push(`<button class="info-btn info-btn--route" data-action="assign-route">
        ✎ Assign Taxi Route</button>`);
    }

    if (s.phase === FlightPhase.TAXI_OUT && s.taxiWaypoints && s.taxiWaypoints.length > 0) {
      btns.push(`<button class="info-btn info-btn--route" data-action="assign-route">
        ✎ Modify Route</button>`);
    }

    return btns.length > 0 ? `<div class="info-actions">${btns.join('')}</div>` : '';
  }

  private phaseCss(phase: FlightPhase): string {
    switch (phase) {
      case FlightPhase.PARKED:        return 'parked';
      case FlightPhase.PUSHBACK:      return 'ground';
      case FlightPhase.TAXI_OUT:
      case FlightPhase.TAXI_IN:       return 'taxi';
      case FlightPhase.HOLDING_SHORT: return 'holding';
      case FlightPhase.LINEUP:        return 'lineup';
      case FlightPhase.TAKEOFF:       return 'takeoff';
      case FlightPhase.CLIMBING:      return 'climb';
      case FlightPhase.CRUISE:        return 'cruise';
      case FlightPhase.DESCENDING:
      case FlightPhase.APPROACH:
      case FlightPhase.FINAL:         return 'approach';
      case FlightPhase.LANDING:       return 'landing';
      case FlightPhase.ARRIVED:       return 'arrived';
      default:                        return 'default';
    }
  }
}
