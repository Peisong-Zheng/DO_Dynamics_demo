export type TankIndex = 0 | 1;
export type Phase = "FILL" | "DRAIN" | "RETURN";
export type StabilityMode = "monostable" | "bistable";
export type PresetId = "A" | "B" | "C" | "D";
export type AdjustableParam = "r" | "H" | "a" | "kappa";
export interface TankParams {
  r: number;
  k: number;
  kappa: number;
  H: number;
  hReset: number;
  a: number;
}
export interface WaterLedger {
  initial: number;
  input: number;
  slowLeak: number;
  fastDrain: number;
  overflow: number;
  manual: number;
}
export interface TankState {
  /** Normalized stored volume V, retained as h for the history data contract. */
  h: number;
  phase: Phase;
  /** Physics-clock angle: zero receiving, TILT_ANGLE fully tipped. */
  angle: number;
  /** Controlled front outlet opens only once the chamber points downwards. */
  opening: number;
  /** Explicit rim discharge averaged over the most recent physical step. */
  spillRate: number;
  params: TankParams;
  q: number;
  eventCount: number;
  ledger: WaterLedger;
  pulsePending: boolean;
  noiseMemory: number;
}
export interface DrainEvent {
  tank: TankIndex;
  time: number;
  h: number;
  params: TankParams;
}
export interface PulseEvent {
  tank: TankIndex;
  time: number;
  amount: number;
}
export interface BackgroundRamp {
  tank: TankIndex;
  param: "r" | "H";
  from: number;
  to: number;
  start: number;
  duration: number;
  active: boolean;
}
export interface SimulationView {
  time: number;
  z: number;
  tanks: [TankState, TankState];
}
export const DT = 1 / 120;
export const TAU = 1.2;
export const DEFAULT_SEED = 20260914;
export const CAPACITY = 2;
export const PULSE_VOLUME = 0.15;
/** Reserve exceeds maximum possible inflow during a full tipping rotation. */
export const PULSE_HEADROOM = 0.1;
export const REST_ANGLE = 0.40;
export const TILT_ANGLE = 0.65;
export const TILT_DURATION = 0.15;
