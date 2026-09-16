import { DynamicsEngine } from "./engine";
import { DT } from "./types";

/** Converts rendering elapsed time into fixed physical steps only. */
export class SimulationRunner {
  paused = false;
  speed = 1;
  private accumulator = 0;

  constructor(
    public readonly engine: DynamicsEngine,
    private readonly onStep?: () => void,
  ) {}

  setPaused(paused: boolean): void {
    this.paused = paused;
    this.clearAccumulator();
  }

  clearAccumulator(): void {
    this.accumulator = 0;
  }

  advance(wallSeconds: number): number {
    if (this.paused || !Number.isFinite(wallSeconds) || wallSeconds <= 0)
      return 0;
    if (!Number.isFinite(this.speed) || this.speed <= 0) return 0;
    // Slow frames lose wall time, not threshold crossings. Hidden-page handling
    // lives in the UI, which also clears the accumulator on visibility changes.
    this.accumulator += Math.min(wallSeconds, 0.1) * this.speed;
    const steps = Math.floor((this.accumulator + DT * 1e-9) / DT);
    for (let count = 0; count < steps; count += 1) {
      this.engine.step();
      this.onStep?.();
    }
    this.accumulator -= steps * DT;
    if (this.accumulator < 0 && this.accumulator > -DT * 1e-9)
      this.accumulator = 0;
    return steps;
  }
}
