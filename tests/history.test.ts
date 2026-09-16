import { describe, expect, it } from "vitest";
import { DynamicsEngine } from "../src/simulation/engine";
import { History } from "../src/ui/charts";
import { DT, TILT_ANGLE } from "../src/simulation/types";
import { rimCapacity } from "../src/simulation/chamber";

function run(engine: DynamicsEngine, history: History, seconds: number) {
  for (let tick = 0; tick < Math.round(seconds / DT); tick++) {
    engine.step();
    history.record(engine);
  }
}

describe("曲线保留实际发生的历史", () => {
  it("plots the retained pouring equilibrium when excess inflow spills over the rim", () => {
    const engine = new DynamicsEngine("B");
    const history = new History();
    history.clear(engine);
    engine.setParam(1, "r", .3);
    engine.setParam(1, "kappa", .4);
    history.record(engine, true);
    const before = structuredClone(history.values());
    expect(before.at(-1)!.drainEq[1]).toBeCloseTo(rimCapacity(TILT_ANGLE), 12);
    expect(before.at(-1)!.drainEq[1]).toBeLessThan(.3 / .56);
    engine.setStabilityMode("bistable");
    history.record(engine, true);
    expect(history.values().slice(0, before.length)).toEqual(before);
    expect(history.values().at(-1)!.drainEq[1]).toBeCloseTo(.15, 12);
  });

  it("mode changes retain historical equilibria and the actual tilted state", () => {
    const engine = new DynamicsEngine("B");
    const history = new History();
    history.clear(engine);
    run(engine, history, 3);
    const before = structuredClone(history.values());
    const tank = engine.tanks[1];
    const state = { h: tank.h, phase: tank.phase, angle: tank.angle, time: engine.time };
    history.record(engine, true);
    engine.setStabilityMode("bistable");
    history.record(engine, true);
    const samples = history.values();
    expect(samples.slice(0, before.length)).toEqual(before);
    expect(samples.at(-2)!.drainEq[1]).toBeCloseTo(.144 / 8.16, 12);
    expect(samples.at(-1)!.drainEq[1]).toBeCloseTo(.15, 12);
    expect(samples.at(-1)!.eq[1]).toBeCloseTo(.9, 12);
    expect(samples.at(-1)!.reset[1]).toBe(.12);
    expect(samples.at(-1)!.phase[1]).toBe(state.phase);
    expect({ h: tank.h, phase: tank.phase, angle: tank.angle, time: engine.time }).toEqual(state);
  });

  it("同一模拟时刻的参数修改前后都可记录，不覆盖过去的 H、r/k 或水位", () => {
    const engine = new DynamicsEngine("A");
    const history = new History();
    history.clear(engine);
    run(engine, history, 5);
    const past = structuredClone(history.values());
    const h = engine.tanks.map((tank) => tank.h);

    // Match main.ts: capture before and after a slider edit, without a step.
    history.record(engine, true);
    engine.setParam(1, "H", 0.75);
    history.record(engine, true);
    const thresholdEdit = history.values().slice(-2);
    expect(thresholdEdit.map((sample) => sample.t)).toEqual([5, 5]);
    expect(thresholdEdit.map((sample) => sample.H[1])).toEqual([1, 0.75]);
    expect(thresholdEdit.map((sample) => sample.h)).toEqual([h, h]);

    history.record(engine, true);
    engine.setParam(1, "r", 0.2);
    history.record(engine, true);
    const inputEdit = history.values().slice(-2);
    expect(inputEdit.map((sample) => sample.t)).toEqual([5, 5]);
    expect(inputEdit[0]!.eq[1]).toBeCloseTo(0.9, 12);
    expect(inputEdit[1]!.eq[1]).toBeCloseTo(1.25, 12);
    expect(inputEdit.map((sample) => sample.H[1])).toEqual([0.75, 0.75]);
    expect(inputEdit.map((sample) => sample.h)).toEqual([h, h]);
    expect(history.values().slice(0, past.length)).toEqual(past);
    run(engine, history, 1);
    expect(history.values().slice(0, past.length)).toEqual(past);
  });

  it("关闭噪声保留全部旧记录，之后继续追加实际轨迹", () => {
    const engine = new DynamicsEngine("B");
    const history = new History();
    history.clear(engine);
    run(engine, history, 20);
    const before = structuredClone(history.values());
    engine.disableNoise();
    expect(history.values()).toEqual(before);
    run(engine, history, 10);
    const after = history.values();
    expect(after.slice(0, before.length)).toEqual(before);
    expect(after.length).toBeGreaterThan(before.length);
    expect(after.at(-1)!.t).toBeCloseTo(30, 12);
  });

  it("长期高频循环有固定容量，仍覆盖最近 60 秒且记录按时间排序", () => {
    const engine = new DynamicsEngine("B");
    for (const index of [0, 1] as const) {
      engine.setParam(index, "r", 0.3);
      engine.setParam(index, "H", 0.55);
      engine.setParam(index, "a", 0.95);
    }
    const history = new History();
    history.clear(engine);
    run(engine, history, 300);
    const saturatedLength = history.values().length;
    run(engine, history, 300);
    const samples = history.values();
    expect(samples.length).toBe(saturatedLength);
    expect(samples.length).toBeLessThanOrEqual(1800);
    expect(samples[0]!.t).toBeGreaterThan(0);
    expect(samples[0]!.t).toBeLessThanOrEqual(engine.time - 60);
    expect(engine.time - samples.at(-1)!.t).toBeLessThanOrEqual(
      10 * DT + 1e-10,
    );
    const recent = samples.filter((sample) => sample.t >= engine.time - 60);
    expect(recent.length).toBeGreaterThanOrEqual(60 / (10 * DT));
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]!.t).toBeGreaterThanOrEqual(samples[i - 1]!.t);
      expect(samples[i]!.t - samples[i - 1]!.t).toBeLessThanOrEqual(
        10 * DT + 1e-10,
      );
    }
  });
});
