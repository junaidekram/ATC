import type { Aircraft } from '../aircraft/Aircraft';
import { FlightPhase } from '../aircraft/FlightPhase';

/**
 * RequestsPanel  — Phase 4
 *
 * Three sub-tabs inside the REQUESTS panel:
 *
 *   PUSHBACK  — parked aircraft that have radioed for pushback clearance.
 *               Approved aircraft briefly show a success card, then move to TAXI.
 *
 *   TAXI      — aircraft that are pushing back / taxiing.
 *               Sub-sections: "AWAITING ROUTE" vs "TAXIING"
 *
 *   RUNWAY    — aircraft holding short, lined up, or awaiting crossing clearance.
 *               Buttons disabled when runway is detected occupied.
 *
 * All strip cards are clickable → fires 'select-aircraft' to highlight the
 * plane on the map.  Action buttons fire 'atc-command' custom events.
 */

// ── Constants ─────────────────────────────────────────────────────────────────

// Max cards shown per sub-tab before a "N more…" footer appears.
const MAX_VISIBLE = 15;

type SubTab = 'pushback' | 'taxi' | 'runway';

// ── Class ─────────────────────────────────────────────────────────────────────

export class RequestsPanel {
  private container: HTMLElement;
  private badge: HTMLElement | null;

  private activeSubTab: SubTab = 'pushback';
  private lastHash = '';

  constructor(containerId: string, badgeId: string) {
    const el = document.getElementById(containerId);
    if (!el) throw new Error(`RequestsPanel: element #${containerId} not found`);
    this.container = el;
    this.badge     = document.getElementById(badgeId);
    this.container.innerHTML = this.buildSkeleton(0, 0, 0);
    this.attachSubTabListeners();
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  update(aircraft: Aircraft[], approvedSet?: Set<string>): void {
    const approved = approvedSet ?? new Set<string>();

    const pbList = this.pushbackList(aircraft, approved);
    const txList = this.taxiList(aircraft);
    const rwList = this.runwayList(aircraft);

    const pbCount = pbList.length;
    const txCount = txList.all.length;
    const rwCount = rwList.all.length;
    const total   = pbCount + txCount + rwCount;

    // Change detection
    const hash = this.computeHash(aircraft, approved);
    if (hash === this.lastHash) return;
    this.lastHash = hash;

    // Update main badge
    if (this.badge) {
      this.badge.textContent = String(total);
      this.badge.classList.toggle('hidden', total === 0);
      this.badge.classList.toggle('active',  total > 0);
    }

    // Compute occupied runways
    const occupiedRunways = new Set<string>();
    for (const ac of aircraft) {
      const oPhases = [FlightPhase.TAKEOFF, FlightPhase.LANDING, FlightPhase.LINEUP, FlightPhase.FINAL];
      if (oPhases.includes(ac.phase) && ac.assignedRunway) {
        occupiedRunways.add(ac.assignedRunway.toUpperCase());
      }
    }

    this.container.innerHTML = this.buildSkeleton(pbCount, txCount, rwCount);
    this.attachSubTabListeners();
    this.renderSubTab(pbList, txList, rwList, approved, occupiedRunways);
  }

  // ── Aircraft filters ────────────────────────────────────────────────────────

  private pushbackList(aircraft: Aircraft[], approved: Set<string>): Aircraft[] {
    return aircraft.filter(ac =>
      (ac.phase === FlightPhase.PARKED && ac.departureRequest) ||
      approved.has(ac.callsign)
    );
  }

  private taxiList(aircraft: Aircraft[]): {
    awaitingRoute: Aircraft[];
    taxiing: Aircraft[];
    all: Aircraft[];
  } {
    const awaitingRoute = aircraft.filter(ac =>
      (ac.phase === FlightPhase.PUSHBACK || ac.phase === FlightPhase.TAXI_OUT) &&
      !this.hasRoute(ac)
    );
    const taxiing = aircraft.filter(ac =>
      ac.phase === FlightPhase.TAXI_OUT && this.hasRoute(ac)
    );
    return { awaitingRoute, taxiing, all: [...awaitingRoute, ...taxiing] };
  }

  private runwayList(aircraft: Aircraft[]): {
    holdingShort: Aircraft[];
    linedup: Aircraft[];
    all: Aircraft[];
  } {
    const holdingShort = aircraft.filter(ac => ac.phase === FlightPhase.HOLDING_SHORT);
    const linedup      = aircraft.filter(ac =>
      ac.phase === FlightPhase.LINEUP && !ac.getState().takeoffClearance
    );
    return { holdingShort, linedup, all: [...holdingShort, ...linedup] };
  }

  // ── Skeleton ─────────────────────────────────────────────────────────────────

  private buildSkeleton(pb: number, tx: number, rw: number): string {
    const badge = (n: number) => n > 0
      ? `<span class="rsub-badge">${n}</span>`
      : '';
    const act = (t: SubTab) => this.activeSubTab === t ? ' active' : '';
    return `
      <div class="rsub-tabs">
        <button class="rsub-btn${act('pushback')}" data-rtab="pushback">PUSHBACK ${badge(pb)}</button>
        <button class="rsub-btn${act('taxi')}"     data-rtab="taxi">TAXI ${badge(tx)}</button>
        <button class="rsub-btn${act('runway')}"   data-rtab="runway">RUNWAY ${badge(rw)}</button>
      </div>
      <div class="rsub-pane" id="rsub-content"></div>`;
  }

  private attachSubTabListeners(): void {
    this.container.querySelectorAll<HTMLButtonElement>('.rsub-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.rtab as SubTab;
        if (tab) { this.activeSubTab = tab; this.lastHash = ''; }
      });
    });
  }

  // ── Content renderer ─────────────────────────────────────────────────────────

  private renderSubTab(
    pbList:  Aircraft[],
    txList:  ReturnType<typeof this.taxiList>,
    rwList:  ReturnType<typeof this.runwayList>,
    approved: Set<string>,
    occupiedRunways: Set<string>,
  ): void {
    const pane = this.container.querySelector<HTMLElement>('#rsub-content');
    if (!pane) return;
    let html = '';
    if (this.activeSubTab === 'pushback') html = this.renderPushbackTab(pbList, approved);
    else if (this.activeSubTab === 'taxi') html = this.renderTaxiTab(txList);
    else html = this.renderRunwayTab(rwList, occupiedRunways);
    pane.innerHTML = html || `<div class="req-empty">No active ${this.activeSubTab} traffic</div>`;
    this.attachCardListeners(pane);
  }

  // ── PUSHBACK tab ──────────────────────────────────────────────────────────────

  private renderPushbackTab(list: Aircraft[], approved: Set<string>): string {
    if (list.length === 0) return '';
    const visible  = list.slice(0, MAX_VISIBLE);
    const overflow = list.length - visible.length;
    const strips   = visible.map(ac =>
      approved.has(ac.callsign) ? this.approvedStrip(ac) : this.requestingStrip(ac)
    );
    if (overflow > 0) strips.push(`<div class="req-overflow">+${overflow} more awaiting pushback</div>`);
    return `<div class="rsub-section">${strips.join('')}</div>`;
  }

  private requestingStrip(ac: Aircraft): string {
    const s    = ac.getState();
    const gate = s.gateId ? `Gate ${s.gateId}` : '';
    return `
      <div class="req-strip req-strip--departure req-strip--selectable" data-select="${s.callsign}">
        <div class="req-strip-head">
          <span class="req-callsign">${s.callsign}</span>
          <span class="req-type">${s.aircraftType}</span>
          <span class="req-dest">→ ${s.destinationIcao}</span>
        </div>
        ${gate ? `<div class="req-strip-meta">${gate} · ${s.destinationCity}</div>` : ''}
        <div class="req-strip-status req-strip-status--requesting">
          <span class="rstat-dot rstat-dot--amber"></span>Requesting pushback and taxi
        </div>
        <div class="req-actions">
          <button class="req-btn req-btn--approve" data-cmd="${s.callsign} PUSH BACK">✓ Approve Pushback</button>
          <button class="req-btn req-btn--select" data-select="${s.callsign}">⊕ Show</button>
        </div>
      </div>`;
  }

  private approvedStrip(ac: Aircraft): string {
    const s = ac.getState();
    return `
      <div class="req-strip req-strip--approved req-strip--selectable" data-select="${s.callsign}">
        <div class="req-strip-head">
          <span class="req-callsign">${s.callsign}</span>
          <span class="req-type">${s.aircraftType}</span>
          <span class="req-dest">→ ${s.destinationIcao}</span>
        </div>
        <div class="req-strip-approved-msg"><span class="approved-check">✔</span> Pushback approved — backing out</div>
      </div>`;
  }

  // ── TAXI tab ──────────────────────────────────────────────────────────────────

  private renderTaxiTab(txList: ReturnType<typeof this.taxiList>): string {
    let html = '';
    if (txList.awaitingRoute.length > 0) {
      const visible  = txList.awaitingRoute.slice(0, MAX_VISIBLE);
      const overflow = txList.awaitingRoute.length - visible.length;
      html += this.renderSection('AWAITING TAXI ROUTE', visible.map(ac => this.awaitingRouteStrip(ac)), overflow);
    }
    if (txList.taxiing.length > 0) {
      const visible  = txList.taxiing.slice(0, MAX_VISIBLE);
      const overflow = txList.taxiing.length - visible.length;
      html += this.renderSection('TAXIING', visible.map(ac => this.taxiingStrip(ac)), overflow);
    }
    return html;
  }

  private awaitingRouteStrip(ac: Aircraft): string {
    const s       = ac.getState();
    const phLabel = s.phase === FlightPhase.PUSHBACK ? 'Pushing back — route needed' : 'Stopped — no route assigned';
    return `
      <div class="req-strip req-strip--route req-strip--selectable" data-select="${s.callsign}">
        <div class="req-strip-head">
          <span class="req-callsign">${s.callsign}</span>
          <span class="req-type">${s.aircraftType}</span>
          <span class="req-dest">→ ${s.destinationIcao}</span>
        </div>
        <div class="req-strip-status req-strip-status--waiting">
          <span class="rstat-dot rstat-dot--blue"></span>${phLabel}
        </div>
        <div class="req-actions">
          <button class="req-btn req-btn--route" data-assign="${s.callsign}">✎ Draw Route</button>
          <button class="req-btn req-btn--select" data-select="${s.callsign}">⊕ Show</button>
        </div>
      </div>`;
  }

  private taxiingStrip(ac: Aircraft): string {
    const s      = ac.getState();
    const route  = s.assignedTaxiRoute?.join('→') ?? '—';
    const rwy    = s.assignedRunway ?? '?';
    const wpts   = s.taxiWaypoints?.length ?? 0;
    const done   = s.taxiWaypointIndex;
    const pct    = wpts > 0 ? Math.round((done / wpts) * 100) : 0;
    return `
      <div class="req-strip req-strip--taxi req-strip--selectable" data-select="${s.callsign}">
        <div class="req-strip-head">
          <span class="req-callsign">${s.callsign}</span>
          <span class="req-type">${s.aircraftType}</span>
          <span class="req-dest">Rwy ${rwy}</span>
        </div>
        <div class="req-strip-status req-strip-status--taxiing">
          <span class="rstat-dot rstat-dot--green"></span>Taxiing via ${route} — ${Math.round(ac.speed)} kts
        </div>
        <div class="taxi-progress"><div class="taxi-progress-bar" style="width:${pct}%"></div></div>
        <div class="req-actions">
          <button class="req-btn req-btn--hold" data-cmd="${s.callsign} HOLD POSITION">⏸ Hold</button>
          <button class="req-btn req-btn--select" data-select="${s.callsign}">⊕ Show</button>
        </div>
      </div>`;
  }

  // ── RUNWAY tab ────────────────────────────────────────────────────────────────

  private renderRunwayTab(rwList: ReturnType<typeof this.runwayList>, occupiedRunways: Set<string>): string {
    let html = '';
    if (rwList.holdingShort.length > 0) {
      const visible  = rwList.holdingShort.slice(0, MAX_VISIBLE);
      const overflow = rwList.holdingShort.length - visible.length;
      html += this.renderSection('HOLDING SHORT', visible.map(ac => this.holdingStrip(ac, occupiedRunways)), overflow);
    }
    if (rwList.linedup.length > 0) {
      const visible  = rwList.linedup.slice(0, MAX_VISIBLE);
      const overflow = rwList.linedup.length - visible.length;
      html += this.renderSection('LINED UP — AWAITING CLEARANCE', visible.map(ac => this.lineupStrip(ac, occupiedRunways)), overflow);
    }
    return html;
  }

  private holdingStrip(ac: Aircraft, occupiedRunways: Set<string>): string {
    const s         = ac.getState();
    const rwy       = s.assignedRunway ?? '?';
    const occupied  = rwy !== '?' && occupiedRunways.has(rwy.toUpperCase());
    const disAttr   = occupied ? ' disabled title="Runway occupied"' : '';
    const pending   = s.pendingRunwayCrossing;
    const crossing  = pending !== null && pending !== undefined;

    return `
      <div class="req-strip req-strip--holding req-strip--selectable" data-select="${s.callsign}">
        <div class="req-strip-head">
          <span class="req-callsign">${s.callsign}</span>
          <span class="req-type">${s.aircraftType}</span>
          <span class="req-dest">Rwy ${rwy}</span>
        </div>
        <div class="req-strip-status${occupied ? ' req-strip-status--warning' : ' req-strip-status--holding'}">
          <span class="rstat-dot ${occupied ? 'rstat-dot--red' : 'rstat-dot--yellow'}"></span>
          ${occupied ? 'Runway occupied — holding' : crossing ? `Needs crossing — Rwy ${pending}` : 'Holding short — ready'}
        </div>
        <div class="req-actions">
          ${crossing ? `
            <button class="req-btn req-btn--cross"${disAttr} data-cmd="${s.callsign} CROSS RUNWAY ${pending}">✕ Cross Rwy ${pending}</button>
          ` : `
            <button class="req-btn req-btn--lineup"${disAttr} data-cmd="${s.callsign} LINE UP AND WAIT ${rwy}">↑ Line Up</button>
            <button class="req-btn req-btn--takeoff"${disAttr} data-cmd="${s.callsign} CLEARED FOR TAKEOFF ${rwy}">▶ Clear T/O</button>
          `}
          <button class="req-btn req-btn--select" data-select="${s.callsign}">⊕ Show</button>
        </div>
      </div>`;
  }

  private lineupStrip(ac: Aircraft, occupiedRunways: Set<string>): string {
    const s        = ac.getState();
    const rwy      = s.assignedRunway ?? '?';
    const occupied = rwy !== '?' && occupiedRunways.has(rwy.toUpperCase());
    const disAttr  = occupied ? ' disabled title="Runway occupied"' : '';
    return `
      <div class="req-strip req-strip--lineup req-strip--selectable" data-select="${s.callsign}">
        <div class="req-strip-head">
          <span class="req-callsign">${s.callsign}</span>
          <span class="req-type">${s.aircraftType}</span>
          <span class="req-dest">Rwy ${rwy}</span>
        </div>
        <div class="req-strip-status req-strip-status--lineup">
          <span class="rstat-dot rstat-dot--green"></span>Lined up — awaiting takeoff clearance
        </div>
        <div class="req-actions">
          <button class="req-btn req-btn--takeoff"${disAttr} data-cmd="${s.callsign} CLEARED FOR TAKEOFF ${rwy}">▶ Cleared T/O</button>
          <button class="req-btn req-btn--select" data-select="${s.callsign}">⊕ Show</button>
        </div>
      </div>`;
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  private renderSection(title: string, strips: string[], overflow: number): string {
    const overHtml = overflow > 0 ? `<div class="req-overflow">+${overflow} more</div>` : '';
    return `
      <div class="rsub-section">
        <div class="rsub-section-title">${title} <span class="rsub-count">${strips.length + overflow}</span></div>
        ${strips.join('')}${overHtml}
      </div>`;
  }

  private hasRoute(ac: Aircraft): boolean {
    const wpts = ac.getState().taxiWaypoints;
    return Array.isArray(wpts) && wpts.length > 0;
  }

  private computeHash(aircraft: Aircraft[], approved: Set<string>): string {
    const acHash = aircraft.map(a => {
      const s = a.getState();
      return `${s.callsign}:${s.phase}:${s.departureRequest ? 1 : 0}:${s.taxiWaypointIndex}:${s.assignedRunway ?? ''}:${s.pendingRunwayCrossing ?? ''}:${s.speed | 0}`;
    }).join('|');
    return `${this.activeSubTab}|${[...approved].sort().join(',')}|${acHash}`;
  }

  // ── Event wiring ──────────────────────────────────────────────────────────────

  private attachCardListeners(root: HTMLElement): void {
    // Whole card click (excluding button clicks) → select aircraft
    root.querySelectorAll<HTMLElement>('.req-strip--selectable').forEach(strip => {
      strip.addEventListener('click', e => {
        if ((e.target as HTMLElement).closest('button')) return;
        const cs = strip.dataset.select;
        if (cs) window.dispatchEvent(new CustomEvent('select-aircraft', { detail: { callsign: cs } }));
      });
    });

    // Select button (⊕ Show)
    root.querySelectorAll<HTMLButtonElement>('button[data-select]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const cs = btn.dataset.select ?? '';
        if (cs) window.dispatchEvent(new CustomEvent('select-aircraft', { detail: { callsign: cs } }));
      });
    });

    // ATC command buttons
    root.querySelectorAll<HTMLButtonElement>('button[data-cmd]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const cmd = btn.dataset.cmd ?? '';
        if (cmd) window.dispatchEvent(new CustomEvent('atc-command', { detail: { command: cmd } }));
      });
    });

    // Route draw button
    root.querySelectorAll<HTMLButtonElement>('button[data-assign]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const cs = btn.dataset.assign ?? '';
        if (cs) window.dispatchEvent(new CustomEvent('open-route-drawer', { detail: { callsign: cs } }));
      });
    });
  }
}
