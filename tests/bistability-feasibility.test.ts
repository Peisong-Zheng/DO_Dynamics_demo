import { openingForAngle, rimCapacity } from "../src/simulation/chamber";
import { describe, expect, it } from "vitest";
import { DynamicsEngine } from "../src/simulation/engine";
import { createPresetTanks } from "../src/simulation/presets";
import { THROTTLED_OUTLET_LIMIT, isBaffleFitted } from "../src/simulation/regime";
import type { Phase } from "../src/simulation/types";
import { DT, TILT_ANGLE } from "../src/simulation/types";

function candidate(phase: Phase, h: number) {
  const engine = new DynamicsEngine("A");
  const tank = engine.tanks[1];
  engine.setStabilityMode("bistable");
  tank.h = h;
  tank.phase = phase;
  tank.angle = phase === "DRAIN" ? TILT_ANGLE : 0;
  tank.opening = openingForAngle(tank.angle);
  tank.ledger.initial = h;
  return engine;
}
function run(engine: DynamicsEngine, seconds: number) {
  for (let i = 0; i < Math.round(seconds / DT); i++) engine.step();
}
function residual(engine: DynamicsEngine) {
  const { h, ledger: l } = engine.tanks[1];
  return l.initial + l.input + l.manual - l.slowLeak - l.fastDrain - l.overflow - h;
}

describe("Retaining baffle is an apparatus fitting, not a side effect of the threshold", () => {
  it("is fitted with the throttled outlet and survives inflow, threshold and noise changes", () => {
    const [selfSustained, monostable] = createPresetTanks("B");
    expect(isBaffleFitted(selfSustained.params)).toBe(false);
    expect(isBaffleFitted(monostable.params)).toBe(false);
    const bistable = { ...monostable.params, kappa: 0.8 };
    expect(isBaffleFitted(bistable)).toBe(true);
    // Dragging the threshold past the receiving equilibrium used to strip the
    // vessel of its baffle while the fitting button silently cleared itself.
    for (const H of [0.55, 0.8, 0.9, 1, 1.2, 1.65])
      expect(isBaffleFitted({ ...bistable, H })).toBe(true);
    for (const r of [0.06, 0.144, 0.3]) expect(isBaffleFitted({ ...bistable, r })).toBe(true);
    expect(isBaffleFitted({ ...bistable, a: 0 })).toBe(true);
    // Only the outlet coefficient decides whether the fitting is installed.
    expect(isBaffleFitted({ ...bistable, kappa: THROTTLED_OUTLET_LIMIT })).toBe(false);
    expect(isBaffleFitted({ ...bistable, kappa: 8 })).toBe(false);
  });
});

describe("One or two resting states in the same angle-coupled model", () => {
  it("same constant parameters admit two attracting equilibria under small perturbations", () => {
    for (const [phase, h, target] of [
      ["FILL", 0.85, 0.9], ["FILL", 0.95, 0.9],
      ["DRAIN", 0.135, 0.15], ["DRAIN", 0.18, 0.15],
    ] as const) {
      const engine = candidate(phase, h);
      run(engine, 150);
      expect(engine.tanks[1].phase).toBe(phase);
      expect(engine.tanks[1].h).toBeCloseTo(target, 10);
      expect(engine.tanks[1].eventCount).toBe(0);
      expect(Math.abs(residual(engine))).toBeLessThan(1e-9);
    }
  });

  it("a finite pulse switches to the low equilibrium and a brief inflow reduction switches back", () => {
    const engine = candidate("FILL", 0.9);
    expect(engine.requestPulse(1)).toBe(true);
    run(engine, 20);
    expect(engine.tanks[1].phase).toBe("DRAIN");
    expect(engine.tanks[1].h).toBeCloseTo(0.15, 7);
    expect(engine.tanks[1].eventCount).toBe(1);
    engine.setParam(1, "r", 0.06);
    run(engine, 1);
    expect(engine.tanks[1].phase).toBe("FILL");
    engine.setParam(1, "r", 0.144);
    run(engine, 150);
    expect(engine.tanks[1].phase).toBe("FILL");
    expect(engine.tanks[1].h).toBeCloseTo(0.9, 10);
    expect(engine.tanks[1].eventCount).toBe(1);
    expect(Math.abs(residual(engine))).toBeLessThan(1e-9);
  });

  it("shared inflow OU can produce both directions in a reproducible bistable trajectory", () => {
    const engine = candidate("FILL", 0.7);
    engine.setParam(1, "a", 0.9);
    let previous: Phase = "FILL";
    let opened = 0;
    let returned = 0;
    for (let i = 0; i < Math.round(300 / DT); i++) {
      engine.step();
      const phase = engine.tanks[1].phase;
      if (phase === "DRAIN" && previous === "FILL") opened++;
      if (phase === "FILL" && previous === "RETURN") returned++;
      previous = phase;
    }
    expect(opened).toBeGreaterThan(0);
    expect(returned).toBeGreaterThan(0);
    expect(Math.abs(residual(engine))).toBeLessThan(1e-9);
  });
});
