import type { BackgroundRamp, PresetId, TankState } from "./types";

export const PRESETS: Record<PresetId, { title: string; description: string }> =
  {
    A: {
      title: "Steady inflow",
      description: "Steady inflow may balance the slow leak before reaching the threshold.",
    },
    B: {
      title: "Variable inflow",
      description: "Turn noise off: which reservoir keeps tipping? Switch the right-hand reservoir between one and two resting states.",
    },
    C: {
      title: "Move the counterweight",
      description: "Changing the background can turn a stable system into a self-sustained cycle.",
    },
    D: {
      title: "Increase mean inflow",
      description: "Changing the inflow changes accumulation and whether the threshold can be reached without disturbances.",
    },
  };

export function createPresetTanks(preset: PresetId): [TankState, TankState] {
  const makeTank = (H: number, a: number): TankState => ({
    h: 0.7,
    phase: "FILL",
    angle: 0,
    opening: 0,
    spillRate: 0,
    params: { r: 0.144, k: 0.16, kappa: 8, H, hReset: 0.12, a },
    q: 0.144,
    eventCount: 0,
    ledger: { initial: 0.7, input: 0, slowLeak: 0, fastDrain: 0, overflow: 0, manual: 0 },
    pulsePending: false,
    noiseMemory: a || 0.9,
  });
  return [makeTank(0.75, 0), makeTank(1, preset === "B" ? 0.9 : 0)];
}

export function createBackground(preset: PresetId): BackgroundRamp | null {
  if (preset === "C") {
    return {
      tank: 1,
      param: "H",
      from: 1,
      to: 0.75,
      start: 3,
      duration: 10,
      active: true,
    };
  }
  if (preset === "D") {
    return {
      tank: 1,
      param: "r",
      from: 0.144,
      to: 0.2,
      start: 3,
      duration: 10,
      active: true,
    };
  }
  return null;
}
