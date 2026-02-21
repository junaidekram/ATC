/**
 * AtisPanel — Phase 6
 *
 * Renders an ATIS (Automatic Terminal Information Service) overlay on the map.
 * Shows: information letter, wind, altimeter, active runways for dep/arr.
 *
 * The element with id="atis-panel" must exist in the HTML.
 */

const INFORMATION_LETTERS = 'ALPHA BRAVO CHARLIE DELTA ECHO FOXTROT GOLF HOTEL INDIA JULIET KILO LIMA MIKE NOVEMBER OSCAR PAPA'.split(' ');

export class AtisPanel {
  private container: HTMLElement;
  private infoIdx = 0;

  // Simulated weather (static for now — Phase 6 realism can make this dynamic)
  private windDir  = 290;   // degrees
  private windKts  = 10;    // knots
  private altim    = 29.92; // inches Hg
  private depRwy   = '—';
  private arrRwy   = '—';

  constructor(containerId: string) {
    const el = document.getElementById(containerId);
    if (!el) throw new Error(`AtisPanel: #${containerId} not found`);
    this.container = el;
    this.render();
  }

  /** Called by main.ts updateDisplay with live runway data */
  setActiveRunways(dep: string, arr: string): void {
    if (dep === this.depRwy && arr === this.arrRwy) return;
    this.depRwy = dep;
    this.arrRwy = arr;
    this.render();
  }

  /** Advance to the next ATIS information letter */
  nextInfo(): void {
    this.infoIdx = (this.infoIdx + 1) % INFORMATION_LETTERS.length;
    this.render();
  }

  private render(): void {
    const letter = INFORMATION_LETTERS[this.infoIdx];
    const windStr = this.windKts === 0
      ? 'CALM'
      : `${this.windDir.toString().padStart(3, '0')}° / ${this.windKts} KTS`;

    this.container.innerHTML = `
      <div class="atis-header">
        <span class="atis-station">KSLC ATIS</span>
        <span class="atis-letter">${letter}</span>
      </div>
      <div class="atis-body">
        <div class="atis-row">
          <span class="atis-lbl">WIND</span>
          <span class="atis-val">${windStr}</span>
        </div>
        <div class="atis-row">
          <span class="atis-lbl">ALTIM</span>
          <span class="atis-val">${this.altim.toFixed(2)} inHg</span>
        </div>
        <div class="atis-row">
          <span class="atis-lbl">DEP</span>
          <span class="atis-val atis-rwy">${this.depRwy || '—'}</span>
        </div>
        <div class="atis-row">
          <span class="atis-lbl">ARR</span>
          <span class="atis-val atis-rwy">${this.arrRwy || '—'}</span>
        </div>
      </div>`;
  }
}
