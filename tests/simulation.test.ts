import { openingForAngle, rimCapacity } from "../src/simulation/chamber";
import { describe, expect, it } from "vitest";
import { DynamicsEngine } from "../src/simulation/engine";
import { SimulationRunner } from "../src/simulation/runner";
import {
  CAPACITY,
  DEFAULT_SEED,
  DT,
  PULSE_VOLUME,
  PULSE_HEADROOM,
  TILT_ANGLE,
  TILT_DURATION,
  TAU,
} from "../src/simulation/types";
import type { TankIndex, TankState } from "../src/simulation/types";

function advance(engine: DynamicsEngine, seconds: number) {
  for (let tick = 0; tick < Math.round(seconds / DT); tick++) engine.step();
}

function startAt(engine: DynamicsEngine, index: TankIndex, h: number) {
  const tank = engine.tanks[index];
  tank.h = h;
  tank.ledger.initial = h;
  return tank;
}

function balance(tank: TankState) {
  const { initial, input, manual, slowLeak, fastDrain, overflow } = tank.ledger;
  return initial + input + manual - slowLeak - fastDrain - overflow - tank.h;
}

function snapshot(engine: DynamicsEngine) {
  return structuredClone({
    time: engine.time,
    z: engine.z,
    tanks: engine.tanks,
    events: engine.events,
    pulses: engine.pulses,
    background: engine.background,
  });
}

describe("同一套方程的循环与稳定状态", () => {
  it("A 的首次蓄水符合解析解，连续倾倒周期与细步长参考收敛", () => {
    const engine = new DynamicsEngine("A");
    const reference = new DynamicsEngine("A", DEFAULT_SEED, { integrationStep: DT / 8 });
    const tank = startAt(engine, 0, engine.tanks[0].params.hReset);
    startAt(reference, 0, tank.params.hReset);
    const { r, k, H, hReset } = tank.params;
    const fillTime = Math.log((r / k - hReset) / (r / k - H)) / k;
    advance(engine, 65);
    advance(reference, 65);
    const events = engine.events.filter((event) => event.tank === 0);
    const fineEvents = reference.events.filter((event) => event.tank === 0);
    expect(events.length).toBeGreaterThanOrEqual(5);
    expect(events).toHaveLength(fineEvents.length);
    expect(events[0]!.time).toBeCloseTo(fillTime, 9);
    const period = fineEvents[2]!.time - fineEvents[1]!.time;
    for (let i = 1; i < events.length; i++) {
      expect(events[i]!.time - events[i - 1]!.time).toBeCloseTo(period, 2);
      expect(events[i]!.time).toBeCloseTo(fineEvents[i]!.time, 2);
      expect(events[i]!.h).toBeCloseTo(H, 12);
    }
    const partlyFull = new DynamicsEngine("A");
    advance(partlyFull, 4);
    const first = partlyFull.events.find((event) => event.tank === 0)!;
    expect(first.time).toBeCloseTo(Math.log((r / k - 0.7) / (r / k - H)) / k, 9);
    expect(first.time).toBeCloseTo(1.79801295, 7);
    expect(first.time).toBeLessThan(fillTime);
  });

  it("B 无噪声从 0.20 蓄水 120 秒后趋于 0.90，始终不排水", () => {
    const engine = new DynamicsEngine("A");
    const tank = startAt(engine, 1, 0.2);
    advance(engine, 120);
    expect(tank.eventCount).toBe(0);
    expect(tank.phase).toBe("FILL");
    expect(tank.h).toBeCloseTo(0.9 + (0.2 - 0.9) * Math.exp(-0.16 * 120), 11);
    expect(Math.abs(balance(tank))).toBeLessThan(1e-10);
  });

  it.each([
    { param: "H" as const, value: 0.75 },
    { param: "r" as const, value: 0.2 },
  ])("B 无噪声调节 $param=$value 后能自行重复循环", ({ param, value }) => {
    const engine = new DynamicsEngine("A");
    engine.setParam(1, param, value);
    advance(engine, 80);
    expect(engine.tanks[1].eventCount).toBeGreaterThan(3);
  });

  it("A 快排中提高 H 至 1.65，先完成本次快排，随后趋于 0.90", () => {
    const engine = new DynamicsEngine("A");
    while (engine.tanks[0].eventCount === 0 && engine.time < 10) engine.step();
    expect(engine.tanks[0].eventCount).toBe(1);
    expect(engine.tanks[0].phase).toBe("DRAIN");
    engine.setParam(0, "H", 1.65);
    expect(engine.tanks[0].phase).toBe("DRAIN");
    engine.step();
    expect(engine.tanks[0].phase).toBe("DRAIN");
    advance(engine, 150);
    expect(engine.tanks[0].eventCount).toBe(1);
    expect(engine.tanks[0].phase).toBe("FILL");
    expect(engine.tanks[0].h).toBeCloseTo(0.9, 8);
    expect(engine.events.find((event) => event.tank === 0)!.params.H).toBe(0.75);
  });
});

describe("人工脉冲与阈值状态机", () => {
  it.each([
    { h: 0.88, triggered: true },
    { h: 0.4, triggered: false },
  ])(
    "在水位 $h 添加真实的 0.15 水量，是否越阈值由状态机判断",
    ({ h, triggered }) => {
      const engine = new DynamicsEngine("A");
      const tank = startAt(engine, 1, h);
      expect(engine.requestPulse(1)).toBe(true);
      expect(tank.h).toBe(h);
      expect(tank.ledger.manual).toBe(0);
      expect(tank.pulsePending).toBe(true);
      expect(engine.requestPulse(1)).toBe(false);
      engine.step();
      expect(tank.pulsePending).toBe(false);
      expect(tank.ledger.manual).toBe(PULSE_VOLUME);
      expect(engine.pulses).toHaveLength(1);
      expect(engine.pulses[0]).toMatchObject({
        tank: 1,
        time: 0,
        amount: PULSE_VOLUME,
      });
      expect(tank.eventCount).toBe(triggered ? 1 : 0);
      expect(tank.phase).toBe(triggered ? "DRAIN" : "FILL");
      expect(tank.params).toMatchObject({ r: 0.144, a: 0, H: 1 });
      expect(Math.abs(balance(tank))).toBeLessThan(1e-12);
    },
  );

  it("每桶独立排队最多一个脉冲，预留转动容量且不截断脉冲水量", () => {
    const engine = new DynamicsEngine("A");
    const tank = startAt(engine, 1, CAPACITY - PULSE_HEADROOM - PULSE_VOLUME + 0.01);
    expect(engine.requestPulse(1)).toBe(false);
    expect(tank.h).toBeCloseTo(1.76, 12);
    expect(tank.pulsePending).toBe(false);
    expect(tank.ledger.manual).toBe(0);
    startAt(engine, 1, CAPACITY - PULSE_HEADROOM - PULSE_VOLUME);
    expect(engine.requestPulse(1)).toBe(true);
    expect(engine.requestPulse(0)).toBe(true);
    expect(engine.requestPulse(0)).toBe(false);
    engine.step();
    expect(engine.pulses).toHaveLength(2);
    expect(tank.ledger.manual).toBe(PULSE_VOLUME);
    expect(tank.h).toBeLessThanOrEqual(CAPACITY);
    expect(Math.abs(balance(tank))).toBeLessThan(1e-12);
  });

  it("下调 H 到已有 FILL 水位以下，在下一物理步触发且仅登记一次", () => {
    const engine = new DynamicsEngine("A");
    engine.setParam(1, "H", 0.55);
    expect(engine.tanks[1].phase).toBe("FILL");
    expect(engine.tanks[1].h).toBe(0.7);
    engine.step();
    expect(engine.tanks[1].phase).toBe("DRAIN");
    expect(engine.tanks[1].eventCount).toBe(1);
    expect(engine.events.find((event) => event.tank === 1)!.time).toBe(0);
    advance(engine, 0.1);
    expect(engine.tanks[1].eventCount).toBe(1);
  });

  it("倾倒按低水量线开始回位，回位期间开度逐渐关闭且继续守恒", () => {
    const engine = new DynamicsEngine("A");
    const tank = startAt(engine, 1, 1);
    tank.phase = "DRAIN";
    tank.angle = TILT_ANGLE;
    tank.opening = 1;
    let steps = 0;
    let observedReturn = false;
    let priorPhase = tank.phase;
    while ((tank.phase as string) !== "FILL" && steps++ < 1000) {
      const prior = { angle: tank.angle, input: tank.ledger.input,
        slow: tank.ledger.slowLeak, fast: tank.ledger.fastDrain };
      engine.step();
      expect(tank.h).toBeGreaterThan(0);
      expect(tank.ledger.input).toBeGreaterThan(prior.input);
      expect(tank.ledger.slowLeak).toBeGreaterThan(prior.slow);
      expect(tank.ledger.fastDrain).toBeGreaterThanOrEqual(prior.fast);
      if ((tank.phase as string) === "RETURN") {
        observedReturn = true;
        expect(tank.angle).toBeLessThan(prior.angle);
        expect(tank.opening).toBeCloseTo(openingForAngle(tank.angle), 14);
        if (priorPhase === "DRAIN") expect(tank.h).toBeLessThanOrEqual(tank.params.hReset);
      }
      if ((tank.phase as string) === "DRAIN") expect(tank.h).toBeGreaterThan(tank.params.hReset);
      priorPhase = tank.phase;
      expect(Math.abs(balance(tank))).toBeLessThan(1e-11);
    }
    expect(observedReturn).toBe(true);
    expect(steps).toBeLessThan(1000);
    expect(tank.phase).toBe("FILL");
    expect(tank.h).toBeLessThan(tank.params.hReset);
    expect(tank.angle).toBe(0);
    expect(tank.opening).toBe(0);
    expect(tank.eventCount).toBe(0);
  });

});

describe("可复现的共享 OU 扰动与固定物理步", () => {
  it("精确遵守指定 PRNG、Box–Muller 和每物理步一次的全局 OU 更新", () => {
    let seed = DEFAULT_SEED;
    const uniform = () => {
      let t = (seed += 0x6d2b79f5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const normal = () =>
      Math.sqrt(-2 * Math.log(Math.max(uniform(), 1e-12))) *
      Math.cos(2 * Math.PI * uniform());
    const engine = new DynamicsEngine("B");
    let referenceZ = normal();
    expect(engine.z).toBe(referenceZ);
    const b = Math.exp(-DT / TAU);
    for (let i = 0; i < 500; i++) {
      referenceZ = b * referenceZ + Math.sqrt(1 - b * b) * normal();
      engine.step();
      expect(engine.z).toBe(referenceZ);
    }
  });

  it("两桶读取同一段相对波动，绝对流量按各自平均输入缩放", () => {
    const engine = new DynamicsEngine("B");
    engine.setParam(0, "a", 0.9);
    for (let i = 0; i < 1000; i++) {
      engine.step();
      const [a, b] = engine.tanks;
      expect(a.q / a.params.r).toBeCloseTo(b.q / b.params.r, 14);
      expect(a.q / a.params.r).toBeCloseTo(1 + 0.9 * Math.tanh(engine.z), 14);
      expect(a.q).toBeGreaterThan(0);
      expect(b.q).toBeGreaterThan(0);
    }
  });

  it("相同种子和模拟时刻操作，在 30 / 60 / 120 FPS 及额外观测下产生完全相同结果", () => {
    const simulate = (fps: number, observe: boolean) => {
      const engine = new DynamicsEngine("B");
      let tick = 0;
      const runner = new SimulationRunner(engine, () => {
        tick++;
        if (tick === 900) engine.disableNoise();
        if (tick === 1300) engine.setParam(1, "H", 0.8);
        if (tick === 1600) engine.requestPulse(1);
        if (tick === 1900) engine.setNoiseEnabled(1, true);
        if (observe && tick % 6 === 0) snapshot(engine);
      });
      for (let frame = 0; frame < fps * 40; frame++) runner.advance(1 / fps);
      expect(tick).toBe(4800);
      return snapshot(engine);
    };
    const result = simulate(30, false);
    expect(simulate(60, true)).toEqual(result);
    expect(simulate(120, false)).toEqual(result);
  });

  it.each([0.25, 0.5, 1, 2])(
    "播放速度 %s 只缩放推进时间，不改变相同时刻的轨迹",
    (speed) => {
      const reference = new DynamicsEngine("B");
      advance(reference, 10);
      const engine = new DynamicsEngine("B");
      const runner = new SimulationRunner(engine);
      runner.speed = speed;
      for (let frame = 0; frame < (60 * 10) / speed; frame++)
        runner.advance(1 / 60);
      expect(snapshot(engine)).toEqual(snapshot(reference));
    },
  );

  it("重置清空事件/脉冲并恢复初态，同 seed 重现轨迹，不同 seed 改变轨迹", () => {
    const engine = new DynamicsEngine("B");
    advance(engine, 25);
    const first = snapshot(engine);
    engine.requestPulse(1);
    engine.step();
    engine.reset("B", DEFAULT_SEED);
    expect(engine.time).toBe(0);
    expect(engine.tanks.map((tank) => tank.h)).toEqual([0.7, 0.7]);
    expect(engine.events).toHaveLength(0);
    expect(engine.pulses).toHaveLength(0);
    expect(engine.tanks.every((tank) => !tank.pulsePending)).toBe(true);
    advance(engine, 25);
    expect(snapshot(engine)).toEqual(first);
    engine.reset("B", DEFAULT_SEED + 1);
    advance(engine, 25);
    expect(engine.tanks[1].h).not.toBe(first.tanks[1].h);
  });

  it("默认 B 第一次自然事件在约 14 秒，日志记录真实跨阈值", () => {
    const engine = new DynamicsEngine("B", DEFAULT_SEED);
    advance(engine, 30);
    const first = engine.events.find((event) => event.tank === 1)!;
    expect(first).toBeDefined();
    expect(first.time).toBeGreaterThan(12);
    expect(first.time).toBeLessThan(16);
    expect(first.h).toBeCloseTo(first.params.H, 12);
  });
});

describe("临界边界及操作语义", () => {
  it("hEq 恰等于 H 时从下方仅渐近接近，长时间无浮点假事件", () => {
    const engine = new DynamicsEngine("A");
    engine.setParam(1, "r", 0.16);
    startAt(engine, 1, 0.2);
    expect(engine.tanks[1].params.r / engine.tanks[1].params.k).toBe(1);
    advance(engine, 1200);
    expect(engine.tanks[1].eventCount).toBe(0);
    expect(engine.tanks[1].h).toBeLessThanOrEqual(1);
    expect(engine.tanks[1].h).toBeCloseTo(1, 10);
  });

  it("有界进水即使饱和且 qMax/k=H，仍不能从下方越过门槛", () => {
    const engine = new DynamicsEngine("B");
    engine.setParam(1, "r", 0.08);
    engine.setParam(1, "a", 0.5);
    engine.setParam(1, "H", 0.75);
    startAt(engine, 1, 0.2);
    engine.z = 1e100;
    expect((0.08 * 1.5) / 0.16).toBe(0.75);
    advance(engine, 240);
    expect(engine.tanks[1].eventCount).toBe(0);
    expect(engine.tanks[1].h).toBeLessThanOrEqual(0.75);
    expect(engine.tanks[1].h).toBeCloseTo(0.75, 10);
  });

  it("关闭噪声保留水位、阀态、历史和参数，并记住可恢复的幅度", () => {
    const engine = new DynamicsEngine("B");
    while (engine.tanks[1].eventCount === 0 && engine.time < 30) engine.step();
    expect(engine.tanks[1].eventCount).toBe(1);
    const before = snapshot(engine);
    engine.disableNoise();
    expect(engine.time).toBe(before.time);
    expect(engine.z).toBe(before.z);
    expect(engine.events).toEqual(before.events);
    for (const index of [0, 1] as const) {
      expect(engine.tanks[index].h).toBe(before.tanks[index].h);
      expect(engine.tanks[index].phase).toBe(before.tanks[index].phase);
      expect(engine.tanks[index].ledger).toEqual(before.tanks[index].ledger);
      expect(engine.tanks[index].params).toEqual({
        ...before.tanks[index].params,
        a: 0,
      });
    }
    engine.step();
    expect(engine.z).not.toBe(before.z);
    expect(engine.tanks[1].phase).toBe("DRAIN");
    engine.setNoiseEnabled(1, true);
    expect(engine.tanks[1].params.a).toBe(0.9);
  });

  it("冻结渐变保留当时门槛，模拟和 OU 继续运行", () => {
    const engine = new DynamicsEngine("C");
    advance(engine, 6);
    const H = engine.tanks[1].params.H;
    const z = engine.z;
    expect(H).toBeLessThan(1);
    expect(H).toBeGreaterThan(0.75);
    engine.freezeBackground();
    advance(engine, 10);
    expect(engine.tanks[1].params.H).toBe(H);
    expect(engine.time).toBeCloseTo(16, 9);
    expect(engine.z).not.toBe(z);
  });

  it.each([
    {
      preset: "C" as const,
      param: "H" as const,
      initial: 1,
      final: 0.75,
      manual: 0.86,
    },
    {
      preset: "D" as const,
      param: "r" as const,
      initial: 0.144,
      final: 0.2,
      manual: 0.172,
    },
  ])(
    "实验 $preset 保持 3 秒再渐变 10 秒；手动改同参数后停止自动覆盖",
    ({ preset, param, initial, final, manual }) => {
      const engine = new DynamicsEngine(preset);
      advance(engine, 3);
      expect(engine.tanks[1].params[param]).toBeCloseTo(initial, 12);
      advance(engine, 10);
      expect(engine.tanks[1].params[param]).toBeCloseTo(final, 10);
      engine.reset(preset);
      advance(engine, 6);
      engine.setParam(1, param, manual);
      advance(engine, 10);
      expect(engine.tanks[1].params[param]).toBe(manual);
    },
  );

  it("暂停冻结模拟时钟、OU 和物理状态，暂停时的阈值操作等恢复后执行", () => {
    const engine = new DynamicsEngine("B");
    const runner = new SimulationRunner(engine);
    runner.advance(0.05);
    runner.setPaused(true);
    const before = snapshot(engine);
    for (let i = 0; i < 60; i++) expect(runner.advance(1 / 60)).toBe(0);
    expect(snapshot(engine)).toEqual(before);
    engine.setParam(1, "H", 0.55);
    expect(engine.tanks[1].phase).toBe("FILL");
    expect(engine.tanks[1].h).toBe(before.tanks[1].h);
    runner.setPaused(false);
    runner.advance(DT);
    expect(engine.tanks[1].phase).toBe("DRAIN");
    expect(engine.time).toBeCloseTo(before.time + DT, 12);
  });

  it("巨大墙钟间隔受限，清除 accumulator 后不会补算此前残余时间", () => {
    const engine = new DynamicsEngine("B");
    const runner = new SimulationRunner(engine);
    expect(runner.advance(300)).toBeLessThanOrEqual(12);
    expect(engine.time).toBeLessThanOrEqual(0.1 + 1e-12);
    runner.advance(DT / 2);
    runner.clearAccumulator();
    const time = engine.time;
    expect(runner.advance(DT / 2)).toBe(0);
    expect(engine.time).toBe(time);
  });
});

describe("物理可行性和长期水量收支", () => {
  it("控制极值下大阀仍能复位，长期运行非负、有界且守恒", () => {
    const engine = new DynamicsEngine("B");
    for (const index of [0, 1] as const) {
      engine.setParam(index, "r", 0.3);
      engine.setParam(index, "a", 0.95);
      engine.setParam(index, "H", index === 0 ? 0.55 : 1.65);
      const p = engine.tanks[index].params;
      expect((p.r * (1 + p.a)) / (p.k + p.kappa)).toBeLessThan(p.hReset);
    }
    let resets = 0;
    for (let tick = 0; tick < 120 * 1200; tick++) {
      if (tick % 6000 === 0) engine.requestPulse(1);
      const oldPhase = engine.tanks[0].phase;
      engine.step();
      if (oldPhase === "RETURN" && engine.tanks[0].phase === "FILL") resets++;
      for (const tank of engine.tanks) {
        if (tank.h < 0 || tank.h > CAPACITY || !Number.isFinite(tank.h)) {
          throw new Error(`非法水位 ${tank.h}，模拟时间 ${engine.time}`);
        }
      }
    }
    expect(resets).toBeGreaterThan(100);
    for (const tank of engine.tanks) {
      expect(Math.abs(balance(tank))).toBeLessThan(1e-8);
      expect(tank.ledger.input).toBeGreaterThan(250);
      expect(tank.ledger.slowLeak).toBeGreaterThan(0);
      expect(tank.ledger.fastDrain).toBeGreaterThan(0);
    }
  });
});
