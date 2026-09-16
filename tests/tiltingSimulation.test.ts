import { openingForAngle, rimCapacity } from "../src/simulation/chamber";
import { describe, expect, it } from "vitest";
import { DynamicsEngine } from "../src/simulation/engine";
import {
  CAPACITY, DEFAULT_SEED, DT, PULSE_HEADROOM, PULSE_VOLUME,
  TILT_ANGLE, TILT_DURATION,
} from "../src/simulation/types";
import type { TankState } from "../src/simulation/types";

function run(engine: DynamicsEngine, seconds: number) {
  for (let tick = 0; tick < Math.round(seconds / DT); tick++) engine.step();
}
function place(tank: TankState, h: number, angle = 0) {
  tank.h = h;
  tank.ledger.initial = h;
  tank.angle = angle;
  tank.opening = openingForAngle(angle);
}
function residual(tank: TankState) {
  const l = tank.ledger;
  return l.initial + l.input + l.manual - l.slowLeak - l.fastDrain - l.overflow - tank.h;
}

describe("Tilting and water release share one physical clock", () => {
  it("opening follows the actual angle, with positive release during the finite rotation", () => {
    const engine = new DynamicsEngine("A");
    const tank = engine.tanks[1];
    place(tank, tank.params.H);
    expect(tank.opening).toBe(0);
    for (let step = 1; step <= Math.round(TILT_DURATION / DT); step++) {
      const previousFastDrain = tank.ledger.fastDrain;
      engine.step();
      expect(tank.phase).toBe("DRAIN");
      expect(tank.angle).toBeCloseTo(TILT_ANGLE * step * DT / TILT_DURATION, 12);
      expect(tank.opening).toBeCloseTo(openingForAngle(tank.angle), 14);
      expect(tank.ledger.fastDrain).toBeGreaterThanOrEqual(previousFastDrain);
      if (tank.angle <= 0.4) expect(tank.opening).toBe(0);
      expect(Math.abs(residual(tank))).toBeLessThan(1e-12);
    }
    expect(tank.angle).toBeCloseTo(TILT_ANGLE, 12);
    expect(tank.eventCount).toBe(1);
    expect(engine.events.filter(event => event.tank === 1)).toHaveLength(1);
  });

  it("a low-volume tip can start returning before full tilt without duplicating its event", () => {
    const engine = new DynamicsEngine("A");
    const tank = engine.tanks[1];
    place(tank, 0.121, TILT_ANGLE / 2);
    tank.phase = "DRAIN";
    let sawReturn = false;
    for (let step = 0; step < 120; step++) {
      engine.step();
      if ((tank.phase as string) === "RETURN") {
        sawReturn = true;
        expect(tank.angle).toBeLessThan(TILT_ANGLE);
      }
      expect(Math.abs(residual(tank))).toBeLessThan(1e-12);
    }
    expect(sawReturn).toBe(true);
    expect(tank.phase).toBe("FILL");
    expect(tank.angle).toBe(0);
    expect(tank.opening).toBe(0);
    expect(tank.eventCount).toBe(0);
  });

  it("halving the rotation substep converges in event time, volume and both outflow ledgers", () => {
    const simulate = (divisor: number) => {
      const engine = new DynamicsEngine("A", DEFAULT_SEED, { integrationStep: DT / divisor });
      run(engine, 50);
      return engine;
    };
    const coarse = simulate(1);
    const fine = simulate(2);
    const reference = simulate(16);
    const error = (engine: DynamicsEngine) => {
      const tank = engine.tanks[0];
      const referenceTank = reference.tanks[0];
      const events = engine.events.filter(event => event.tank === 0);
      const referenceEvents = reference.events.filter(event => event.tank === 0);
      expect(events).toHaveLength(referenceEvents.length);
      return Math.max(
        Math.abs(tank.h - referenceTank.h),
        Math.abs(tank.ledger.slowLeak - referenceTank.ledger.slowLeak),
        Math.abs(tank.ledger.fastDrain - referenceTank.ledger.fastDrain),
        Math.abs(tank.ledger.overflow - referenceTank.ledger.overflow),
        ...events.map((event, i) => Math.abs(event.time - referenceEvents[i]!.time)),
      );
    };
    expect(error(coarse)).toBeLessThan(0.02);
    expect(error(fine)).toBeLessThan(error(coarse) / 1.5);
    // Subdivision consumes no additional random numbers or global time ticks.
    expect(coarse.z).toBe(fine.z);
    expect(fine.z).toBe(reference.z);
    expect(coarse.time).toBe(reference.time);
  });

  it("reserves capacity for the largest inflow during rotation without truncating water", () => {
    expect(PULSE_HEADROOM).toBeGreaterThan(0.3 * (1 + 0.95) * TILT_DURATION);
    for (const kappa of [0.4, 0.8, 8]) {
      const engine = new DynamicsEngine("B");
      engine.setParam(1, "kappa", kappa);
      engine.setParam(1, "r", 0.3);
      engine.setParam(1, "a", 0.95);
      engine.setParam(1, "H", 1.65);
      const tank = engine.tanks[1];
      place(tank, CAPACITY - PULSE_HEADROOM - PULSE_VOLUME);
      engine.z = 1e100;
      expect(engine.canPulse(1)).toBe(true);
      expect(engine.requestPulse(1)).toBe(true);
      expect(engine.canPulse(1)).toBe(false);
      for (let tick = 0; tick < 120 * 120; tick++) {
        if (tick % 90 === 0) engine.requestPulse(1);
        engine.step();
        if (!(tank.h > 0 && tank.h <= CAPACITY && tank.opening >= 0 && tank.opening <= 1)) {
          throw new Error(`Invalid physical state at ${engine.time}: ${JSON.stringify(tank)}`);
        }
      }
      expect(Math.abs(residual(tank))).toBeLessThan(1e-9);
      expect(tank.ledger.manual / PULSE_VOLUME).toBeCloseTo(engine.pulses.filter(pulse => pulse.tank === 1).length, 8);
    }
  });

  it("accounts for water leaving the lowering rim and exposes the actual spill to rendering", () => {
    const engine = new DynamicsEngine("A");
    const tank = engine.tanks[1];
    place(tank, 1);
    let sawSpill = false;
    for (let tick = 0; tick < 120; tick++) {
      const priorOverflow = tank.ledger.overflow;
      engine.step();
      expect(tank.h).toBeLessThanOrEqual(rimCapacity(tank.angle) + 1e-12);
      expect(tank.spillRate * DT).toBeCloseTo(tank.ledger.overflow - priorOverflow, 12);
      if (tank.spillRate > 0) sawSpill = true;
      expect(Math.abs(residual(tank))).toBeLessThan(1e-11);
    }
    expect(sawSpill).toBe(true);
    expect(tank.ledger.overflow).toBeGreaterThan(0.3);
    expect(tank.eventCount).toBe(1);
  });

  it("integrates a rim-limited pouring equilibrium and its steady overflow exactly", () => {
    const engine = new DynamicsEngine("A");
    engine.setParam(1, "r", 0.3);
    engine.setParam(1, "kappa", 0.4);
    const tank = engine.tanks[1];
    const capacity = rimCapacity(TILT_ANGLE);
    place(tank, capacity, TILT_ANGLE);
    tank.phase = "DRAIN";
    run(engine, 40);
    expect(tank.phase).toBe("DRAIN");
    expect(tank.h).toBe(capacity);
    const spill = 0.3 - (0.16 + 0.4) * capacity;
    expect(tank.spillRate).toBeCloseTo(spill, 10);
    expect(tank.ledger.overflow).toBeCloseTo(spill * 40, 10);
    expect(tank.ledger.slowLeak).toBeCloseTo(0.16 * capacity * 40, 10);
    expect(tank.ledger.fastDrain).toBeCloseTo(0.4 * capacity * 40, 10);
    expect(Math.abs(residual(tank))).toBeLessThan(1e-10);
  });

});

describe("Stability controls change parameters, not the current trajectory state", () => {
  it.each(["monostable", "bistable"] as const)("%s preserves water, tilt, noise and logs while stopping a B background ramp", mode => {
    const engine = new DynamicsEngine("C");
    run(engine, 6);
    engine.setNoiseEnabled(1, true);
    engine.requestPulse(1);
    const before = structuredClone({
      time: engine.time, z: engine.z, tanks: engine.tanks,
      events: engine.events, pulses: engine.pulses,
    });
    engine.setStabilityMode(mode);
    expect(engine.time).toBe(before.time);
    expect(engine.z).toBe(before.z);
    expect(engine.events).toEqual(before.events);
    expect(engine.pulses).toEqual(before.pulses);
    expect(engine.tanks[0]).toEqual(before.tanks[0]);
    expect(engine.tanks[1]).toEqual({
      ...before.tanks[1], params: { ...before.tanks[1].params,
        r: 0.144, H: 1, kappa: mode === "bistable" ? 0.8 : 8 },
    });
    expect(engine.background?.active).toBe(false);
  });

  it("opening the outlet releases a formerly stable tipped state and lets it return", () => {
    const engine = new DynamicsEngine("A");
    engine.setStabilityMode("bistable");
    const tank = engine.tanks[1];
    place(tank, 0.15, TILT_ANGLE);
    tank.phase = "DRAIN";
    run(engine, 20);
    expect(tank.phase).toBe("DRAIN");
    expect(tank.h).toBeCloseTo(0.15, 12);
    engine.setStabilityMode("monostable");
    expect(tank.phase).toBe("DRAIN");
    expect(tank.angle).toBe(TILT_ANGLE);
    run(engine, 150);
    expect(tank.phase).toBe("FILL");
    expect(tank.h).toBeCloseTo(0.9, 10);
    expect(tank.eventCount).toBe(0);
    expect(Math.abs(residual(tank))).toBeLessThan(1e-9);
  });

  it.each(["FILL", "DRAIN"] as const)("noise off leaves the %s attractor stable in bistable mode", phase => {
    const engine = new DynamicsEngine("B");
    engine.setStabilityMode("bistable");
    const tank = engine.tanks[1];
    place(tank, phase === "FILL" ? 0.91 : 0.16, phase === "DRAIN" ? TILT_ANGLE : 0);
    tank.phase = phase;
    const angle = tank.angle;
    engine.disableNoise();
    run(engine, 150);
    expect(tank.phase).toBe(phase);
    expect(tank.angle).toBe(angle);
    expect(tank.h).toBeCloseTo(phase === "FILL" ? 0.9 : 0.15, 10);
    expect(tank.eventCount).toBe(0);
  });
});
