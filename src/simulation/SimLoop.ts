import type { Aircraft } from '../aircraft/Aircraft';

/**
 * SimLoop
 * Main simulation loop that updates all aircraft and game state
 */
export class SimLoop {
  private aircraft: Aircraft[] = [];
  private running = false;
  private lastUpdateTime = 0;
  private simulationSpeed = 10; // 10x real-time
  private updateCallbacks: Array<(deltaTime: number) => void> = [];

  constructor() {
    this.lastUpdateTime = performance.now();
  }

  /**
   * Start the simulation loop
   */
  start(): void {
    if (this.running) {
      console.warn('Simulation loop already running');
      return;
    }

    this.running = true;
    this.lastUpdateTime = performance.now();
    this.loop();
    console.log('✅ Simulation loop started');
  }

  /**
   * Stop the simulation loop
   */
  stop(): void {
    this.running = false;
    console.log('⏸️ Simulation loop stopped');
  }

  /**
   * Main simulation loop
   */
  private loop = (): void => {
    if (!this.running) return;

    const currentTime = performance.now();
    const realDeltaTime = (currentTime - this.lastUpdateTime) / 1000; // Convert to seconds
    const simDeltaTime = realDeltaTime * this.simulationSpeed;

    this.lastUpdateTime = currentTime;

    // Update all aircraft — pass the full list so each aircraft can detect traffic ahead
    const allAircraft = this.aircraft.slice();
    this.aircraft.forEach(aircraft => {
      aircraft.update(simDeltaTime, allAircraft);
    });

    // Call all registered update callbacks
    this.updateCallbacks.forEach(callback => {
      callback(simDeltaTime);
    });

    // Schedule next frame
    requestAnimationFrame(this.loop);
  };

  /**
   * Add an aircraft to the simulation
   */
  addAircraft(aircraft: Aircraft): void {
    this.aircraft.push(aircraft);
  }

  /**
   * Remove an aircraft from the simulation
   */
  removeAircraft(callsign: string): void {
    const index = this.aircraft.findIndex(a => a.callsign === callsign);
    if (index >= 0) {
      this.aircraft.splice(index, 1);
    }
  }

  /**
   * Get all aircraft in the simulation
   */
  getAircraft(): Aircraft[] {
    return this.aircraft;
  }

  /**
   * Find an aircraft by callsign
   */
  findAircraft(callsign: string): Aircraft | undefined {
    return this.aircraft.find(a => a.callsign === callsign);
  }

  /**
   * Register a callback to be called on each simulation update
   */
  onUpdate(callback: (deltaTime: number) => void): void {
    this.updateCallbacks.push(callback);
  }

  /**
   * Set the simulation speed multiplier
   */
  setSpeed(speed: number): void {
    this.simulationSpeed = Math.max(1, Math.min(100, speed));
    console.log(`Simulation speed set to ${this.simulationSpeed}x`);
  }

  /**
   * Get the current simulation speed
   */
  getSpeed(): number {
    return this.simulationSpeed;
  }

  /**
   * Check if simulation is running
   */
  isRunning(): boolean {
    return this.running;
  }
}
