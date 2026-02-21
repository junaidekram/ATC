import type { Aircraft } from '../aircraft/Aircraft';
import { FlightPhase } from '../aircraft/FlightPhase';

/**
 * ArrivalsPanel — Phase 7
 *
 * Arrival strip bay showing all aircraft on approach, final, or landing.
 * Each strip shows: callsign, type, origin, ETA estimate, altitude,
 * distance from ORD, and assigned runway.
 *
 * Action buttons:
 *   EXPECT ILS  — fires the EXPECT_ILS command
 *   CLEAR ILS   — fires the ILS_CLEARED command
 *   CLEAR LAND  — fires the CLEARED_LAND command
 */

const ORD_LAT = 40.7884;
const ORD_LON = -111.9779;

const ARRIVAL_PHASES = new Set<FlightPhase>([
  FlightPhase.APPROACH,
  FlightPhase.FINAL,
  FlightPhase.LANDING,
  FlightPhase.TAXI_IN,
  FlightPhase.ARRIVED,
  FlightPhase.DESCENDING,
]);

export class ArrivalsPanel {
  private container: HTMLElement;
  private lastHash = '';

  constructor(containerId: string) {
    const el = document.getElementById(containerId);
    if (!el) throw new Error(`ArrivalsPanel: #${containerId} not found`);
    this.container = el;
    this.container.innerHTML = this.emptyHtml();
  }

  update(aircraft: Aircraft[]): void {
    const arrivals = aircraft.filter(ac => ARRIVAL_PHASES.has(ac.phase));
    // Sort: closest to runway first
    arrivals.sort((a, b) => this.distFromORD(a) - this.distFromORD(b));

    const hash = arrivals.map(a =>
      `${a.callsign}:${a.phase}:${Math.round(a.altitude / 100)}:${Math.round(a.speed)}`
    ).join('|');
    if (hash === this.lastHash) return;
    this.lastHash = hash;

    if (arrivals.length === 0) {
      this.container.innerHTML = this.emptyHtml();
      return;
    }

    this.container.innerHTML = `<div class="arr-list">${arrivals.map(ac => this.buildStrip(ac)).join('')}</div>`;
    this.attachListeners();
  }

  private buildStrip(ac: Aircraft): string {
    const s   = ac.getState();
    const distNM = this.distFromORD(ac);
    const altFt  = Math.round(ac.altitude);
    const spdKts = Math.round(ac.speed);
    const phase  = s.phase.replace(/_/g, ' ');
    const rwy    = s.assignedRunway ?? s.approachRunway ?? '—';

    const phaseClass = this.phaseClass(s.phase);

    let etaStr = '—';
    if (distNM > 0.1 && spdKts > 10) {
      const etaMin = (distNM / spdKts) * 60;
      etaStr = etaMin < 1 ? '<1 min' : `${etaMin.toFixed(0)} min`;
    }

    const actions = this.buildActions(s.callsign, rwy, s.phase, s.landingClearance, s.onILS);

    return `
      <div class="arr-strip arr-strip--${phaseClass} arr-strip--selectable" data-select="${s.callsign}">
        <div class="arr-strip-head">
          <span class="arr-callsign" data-select="${s.callsign}">${s.callsign}</span>
          <span class="arr-type">${s.aircraftType}</span>
          <span class="arr-rwy">RWY ${rwy}</span>
        </div>
        <div class="arr-strip-meta">
          ${s.originIcao} → ${s.destinationIcao} · ETA ${etaStr}
        </div>
        <div class="arr-strip-data">
          <span class="arr-data-item">
            <span class="arr-data-lbl">ALT</span>
            <span class="arr-data-val">${altFt > 4400 ? `${altFt.toLocaleString()} ft` : 'GND'}</span>
          </span>
          <span class="arr-data-item">
            <span class="arr-data-lbl">SPD</span>
            <span class="arr-data-val">${spdKts > 0 ? `${spdKts} kts` : 'STOPPED'}</span>
          </span>
          <span class="arr-data-item">
            <span class="arr-data-lbl">DIST</span>
            <span class="arr-data-val">${distNM > 0.3 ? `${distNM.toFixed(1)} NM` : 'CLOSE'}</span>
          </span>
          <span class="arr-data-item arr-phase-badge arr-phase--${phaseClass}">${phase}</span>
        </div>
        ${actions}
      </div>`;
  }

  private buildActions(callsign: string, rwy: string, phase: FlightPhase,
                        landingClearance: boolean, onILS: boolean): string {
    const btns: string[] = [];

    if (phase === FlightPhase.DESCENDING || phase === FlightPhase.APPROACH) {
      if (!onILS) {
        btns.push(`<button class="arr-btn arr-btn--ils"
          data-cmd="${callsign} ILS APPROACH CLEARED RUNWAY ${rwy}">ILS Clr ${rwy}</button>`);
      }
      if (!landingClearance) {
        btns.push(`<button class="arr-btn arr-btn--land"
          data-cmd="${callsign} CLEARED TO LAND RUNWAY ${rwy}">Land Clr ${rwy}</button>`);
      }
    }

    if (phase === FlightPhase.FINAL) {
      if (!landingClearance) {
        btns.push(`<button class="arr-btn arr-btn--land"
          data-cmd="${callsign} CLEARED TO LAND RUNWAY ${rwy}">✓ Land Clr ${rwy}</button>`);
      } else {
        btns.push(`<span class="arr-cleared-badge">✔ LAND CLEARED</span>`);
      }
      btns.push(`<button class="arr-btn arr-btn--go"
        data-cmd="${callsign} GO AROUND">↑ Go Around</button>`);
    }

    if (phase === FlightPhase.LANDING) {
      btns.push(`<button class="arr-btn arr-btn--exit"
        data-cmd="${callsign} EXIT RUNWAY">Exit Runway</button>`);
    }

    if (phase === FlightPhase.TAXI_IN) {
      btns.push(`<button class="arr-btn arr-btn--select"
        data-select="${callsign}">⊕ View</button>`);
    }

    if (btns.length === 0) return '';
    return `<div class="arr-actions">${btns.join('')}</div>`;
  }

  private phaseClass(phase: FlightPhase): string {
    switch (phase) {
      case FlightPhase.DESCENDING: return 'descending';
      case FlightPhase.APPROACH:   return 'approach';
      case FlightPhase.FINAL:      return 'final';
      case FlightPhase.LANDING:    return 'landing';
      case FlightPhase.TAXI_IN:    return 'taxiin';
      case FlightPhase.ARRIVED:    return 'arrived';
      default:                     return 'default';
    }
  }

  private attachListeners(): void {
    this.container.querySelectorAll<HTMLElement>('[data-select]').forEach(el => {
      el.addEventListener('click', () => {
        const cs = el.dataset.select;
        if (cs) window.dispatchEvent(new CustomEvent('select-aircraft', { detail: { callsign: cs } }));
      });
    });
    this.container.querySelectorAll<HTMLButtonElement>('[data-cmd]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const cmd = btn.dataset.cmd;
        if (cmd) window.dispatchEvent(new CustomEvent('atc-command', { detail: { command: cmd } }));
      });
    });
  }

  private emptyHtml(): string {
    return `<div class="req-empty">No arrival traffic</div>`;
  }

  private distFromORD(ac: Aircraft): number {
    const R    = 3440.065;
    const dLat = (ORD_LAT - ac.position.lat) * Math.PI / 180;
    const dLon = (ORD_LON - ac.position.lon) * Math.PI / 180;
    const a    = Math.sin(dLat / 2) ** 2 +
                 Math.cos(ac.position.lat * Math.PI / 180) * Math.cos(ORD_LAT * Math.PI / 180) *
                 Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
}
